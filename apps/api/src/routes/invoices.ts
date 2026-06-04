import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@crewmodo/db';
import {
  aiUsageEvents,
  auditLogs,
  customerInvoices,
  customerPayments,
  jobCosts,
  jobs,
  leads,
  materialPurchases,
  materials,
  organizations,
  saasPlans,
  subscriptions,
  supplierInvoiceImportFeedback,
  supplierInvoiceImports,
  supplierInvoiceLearningStats,
  supplierInvoiceSenderRules,
} from '@crewmodo/db/schema';
import { and, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';
import { createNotificationAndPush } from '../lib/web-push';
import { sendInvoiceEmail } from '../lib/invoice-emails';

const invoicesApp = new Hono<{ Bindings: Env; Variables: Variables }>();

type InvoiceItem = {
  description: string;
  sku?: string | null;
  salesNumber?: string | null;
  productCode?: string | null;
  productName?: string | null;
  size?: string | null;
  colorName?: string | null;
  colorCode?: string | null;
  sourceInvoiceNumber?: string | null;
  poNumber?: string | null;
  purchaseDate?: string | null;
  storeNumber?: string | null;
  quantity: number;
  unitCost: number;
  total: number;
  category?: string;
  gallons?: number | null;
  pricePerGallon?: number | null;
  isFee?: boolean;
};

type ParsedInvoicePayload = {
  items: InvoiceItem[];
  extracted: Record<string, unknown>;
  confidence: number;
  rawText: string;
  metadata?: Record<string, unknown>;
};

type AiUsageEstimate = {
  provider: 'openai';
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
};

type JobCandidate = {
  id: string;
  name: string;
  jobNumber?: string | null;
  status?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  customerName?: string | null;
  confidence: number;
  reasons: string[];
};

const importSchema = z.object({
  sourceType: z.enum(['upload', 'email_forward', 'manual_text']).default('upload'),
  supplier: z.string().trim().optional().nullable(),
  invoiceNumber: z.string().trim().optional().nullable(),
  invoiceDate: z.string().trim().optional().nullable(),
  senderEmail: z.string().trim().email().optional().nullable(),
  originalFilename: z.string().trim().optional().nullable(),
  rawText: z.string().optional().nullable(),
  csvData: z.string().optional().nullable(),
  jobId: z.string().uuid().optional().nullable(),
});

const MAX_INVOICE_FILE_BYTES = 15 * 1024 * 1024;
const OCR_FEATURE_KEY = 'supplier_invoice_ocr';
const DEFAULT_OCR_BURST_LIMIT_PER_MINUTE = 5;
const DEFAULT_OCR_DAILY_LIMIT = 25;
const DEFAULT_OCR_MONTHLY_ESTIMATED_COST_LIMIT_USD = 50;
const OPENAI_PRICE_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4.1': { input: 2, output: 8 },
};

const approveSchema = z.object({
  jobId: z.string().uuid().optional().nullable(),
  applyMaterialUpdates: z.boolean().default(true),
  reviewNotes: z.string().trim().optional().nullable(),
});

const rejectSchema = z.object({
  reviewNotes: z.string().trim().optional().nullable(),
});

const senderRuleSchema = z.object({
  supplier: z.string().trim().min(1),
  senderEmail: z.string().trim().email(),
  autoStage: z.boolean().default(true),
  isActive: z.boolean().default(true),
});

const customerInvoiceCreateSchema = z.object({
  leadId: z.string().uuid(),
  jobId: z.string().uuid().optional().nullable(),
  description: z.string().trim().min(1).max(255),
  amount: z.coerce.number().positive(),
  tax: z.coerce.number().min(0).default(0),
  dueDate: z.string().trim().optional().nullable(),
  dueLabel: z.string().trim().max(120).optional().nullable(),
  reminderCadence: z.string().trim().max(50).optional().nullable(),
  taxRate: z.coerce.number().min(0).max(100).optional().nullable(),
  taxOverride: z.boolean().default(false),
  note: z.string().trim().max(1000).optional().nullable(),
});

const inboundEmailSchema = z.object({
  from: z.string().trim().email(),
  to: z.union([z.string().trim(), z.array(z.string().trim())]).optional(),
  subject: z.string().trim().optional().nullable(),
  text: z.string().optional().nullable(),
  html: z.string().optional().nullable(),
  attachments: z.array(z.object({
    filename: z.string().trim().min(1),
    contentType: z.string().trim().optional().nullable(),
    contentBase64: z.string().min(1),
  })).default([]),
});

type InvoiceImportRecord = typeof supplierInvoiceImports.$inferSelect;

class DuplicateSupplierInvoiceError extends Error {
  invoiceImport?: InvoiceImportRecord;
  purchase?: typeof materialPurchases.$inferSelect;

  constructor(message: string, payload: { invoiceImport?: InvoiceImportRecord; purchase?: typeof materialPurchases.$inferSelect }) {
    super(message);
    this.name = 'DuplicateSupplierInvoiceError';
    this.invoiceImport = payload.invoiceImport;
    this.purchase = payload.purchase;
  }
}

function requireIdempotency(c: any) {
  const key = c.req.header('Idempotency-Key');
  if (!key) return c.json({ error: 'Idempotency-Key required' }, 400);
  return null;
}

function currencyValue(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateValue(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function envNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clampConfidence(value: number) {
  if (!Number.isFinite(value)) return 0.74;
  return Math.max(0, Math.min(0.99, Number(value.toFixed(2))));
}

function normalizeText(value: unknown) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function fieldKey(value: unknown) {
  return normalizeText(value).replace(/\s+/g, '_');
}

function supplierKey(value: unknown) {
  const normalized = normalizeText(value);
  return normalized ? normalized.replace(/\s+/g, '_').slice(0, 120) : 'unknown_supplier';
}

function extractionMethodFor(invoiceImport: InvoiceImportRecord) {
  const data = invoiceImport.extractedData as { extractionMethod?: string } | null;
  return data?.extractionMethod || 'deterministic_text';
}

function duplicateImportMessage(invoiceImport: InvoiceImportRecord) {
  if (invoiceImport.status === 'needs_review') return 'This supplier invoice is already waiting in Needs review.';
  if (invoiceImport.status === 'approved') return 'This supplier invoice was already approved and moved into Supplier purchases.';
  if (invoiceImport.status === 'duplicate') return 'This supplier invoice was already marked as a duplicate.';
  if (invoiceImport.status === 'rejected') return 'This supplier invoice was previously rejected.';
  return 'This supplier invoice was already uploaded.';
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'invoice';
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function sha256Hex(value: ArrayBuffer | string) {
  const data = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function normalizedDocumentText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function responseText(response: any) {
  if (typeof response?.output_text === 'string') return response.output_text;
  const chunks: string[] = [];
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') chunks.push(content.text);
      if (typeof content?.output_text === 'string') chunks.push(content.output_text);
    }
  }
  return chunks.join('\n');
}

function estimateOpenAiCost(model: string, inputTokens: number, outputTokens: number) {
  const pricing = OPENAI_PRICE_PER_MILLION_TOKENS[model] || OPENAI_PRICE_PER_MILLION_TOKENS['gpt-4.1-mini'];
  return (inputTokens / 1_000_000 * pricing.input) + (outputTokens / 1_000_000 * pricing.output);
}

function usageFromOpenAiResponse(response: any, model: string, fallbackInputTokens: number): AiUsageEstimate {
  const usage = response?.usage || {};
  const inputTokens = Number(usage.input_tokens || usage.prompt_tokens || fallbackInputTokens || 0);
  const outputTokens = Number(usage.output_tokens || usage.completion_tokens || 0);
  const totalTokens = Number(usage.total_tokens || inputTokens + outputTokens);
  return {
    provider: 'openai',
    model,
    inputTokens: Number.isFinite(inputTokens) ? Math.max(0, Math.round(inputTokens)) : 0,
    outputTokens: Number.isFinite(outputTokens) ? Math.max(0, Math.round(outputTokens)) : 0,
    totalTokens: Number.isFinite(totalTokens) ? Math.max(0, Math.round(totalTokens)) : 0,
    estimatedCostUsd: estimateOpenAiCost(model, inputTokens, outputTokens),
  };
}

function monthStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function dayStart() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function enforceOcrBudget(c: any, db: ReturnType<typeof createDb>, orgId: string) {
  const burstLimit = envNumber(c.env.OCR_BURST_LIMIT_PER_MINUTE, DEFAULT_OCR_BURST_LIMIT_PER_MINUTE);
  const dailyLimit = envNumber(c.env.OCR_DAILY_LIMIT, DEFAULT_OCR_DAILY_LIMIT);
  const monthlyCostLimit = envNumber(c.env.OCR_MONTHLY_ESTIMATED_COST_LIMIT_USD, DEFAULT_OCR_MONTHLY_ESTIMATED_COST_LIMIT_USD);

  const burstKey = `rate:${orgId}:${OCR_FEATURE_KEY}:${Math.floor(Date.now() / 60_000)}`;
  const burstCount = Number(await c.env.KV.get(burstKey) || '0');
  if (burstCount >= burstLimit) {
    throw new Error(`OCR is temporarily rate limited. Try again in a minute.`);
  }
  await c.env.KV.put(burstKey, String(burstCount + 1), { expirationTtl: 90 });

  const [daily] = await db.select({
    count: sql<number>`count(*)`,
  }).from(aiUsageEvents).where(and(
    eq(aiUsageEvents.orgId, orgId),
    eq(aiUsageEvents.feature, OCR_FEATURE_KEY),
    gte(aiUsageEvents.createdAt, dayStart()),
  ));
  if (Number(daily?.count || 0) >= dailyLimit) {
    throw new Error(`Daily OCR limit reached for this contractor. Try again tomorrow or increase the limit.`);
  }

  const [monthly] = await db.select({
    estimatedCostUsd: sql<number>`coalesce(sum(${aiUsageEvents.estimatedCostUsd}), 0)`,
  }).from(aiUsageEvents).where(and(
    eq(aiUsageEvents.orgId, orgId),
    eq(aiUsageEvents.feature, OCR_FEATURE_KEY),
    gte(aiUsageEvents.createdAt, monthStart()),
  ));
  if (Number(monthly?.estimatedCostUsd || 0) >= monthlyCostLimit) {
    throw new Error(`Monthly OCR budget reached for this contractor. Increase the limit before running more OCR.`);
  }
}

function parseJsonObject(text: string) {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error('OCR returned unreadable JSON.');
  }
}

function splitCsvLine(line: string) {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function parseCSV(csvText: string): InvoiceItem[] {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((header) => fieldKey(header));
  const items: InvoiceItem[] = [];

  for (const line of lines.slice(1)) {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = values[idx] || '';
    });

    const description = row.description || row.item || row.item_description || row.product || row.product_name || row.name;
    const sku = row.sku || row.item_number || row.product_code || row.product_id || row.upc;
    const quantity = currencyValue(row.quantity || row.qty || row.units || 1);
    const unitCost = currencyValue(row.unit_cost || row.cost || row.unit_price || row.price);
    const total = currencyValue(row.total || row.amount || quantity * unitCost);

    if (description && quantity > 0 && (unitCost > 0 || total > 0)) {
      items.push({
        description,
        sku: sku || null,
        quantity,
        unitCost: unitCost || total / quantity,
        total: total || quantity * unitCost,
        category: inferCostCategory(description),
      });
    }
  }

  return items;
}

function parseTextInvoice(rawText: string): { items: InvoiceItem[]; extracted: Record<string, unknown>; confidence: number } {
  const lines = rawText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const items: InvoiceItem[] = [];
  const supplier = lines.slice(0, 4).find((line) => /sherwin|benjamin|home depot|lowe|ppg|dunn|kelly/i.test(line));
  const invoiceNumber = rawText.match(/(?:invoice|receipt|order)\s*(?:#|number|no\.?)?\s*[:\-]?\s*([a-z0-9-]{4,})/i)?.[1];
  const invoiceDate = rawText.match(/\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/)?.[1];

  for (const line of lines) {
    const values = line.match(/(.+?)\s+(?:sku[:#]?\s*)?([A-Z0-9-]{3,})?\s+(\d+(?:\.\d+)?)\s+\$?(\d+(?:\.\d{2})?)\s+\$?(\d+(?:\.\d{2})?)$/i);
    if (!values) continue;
    const [, descriptionRaw, skuRaw, quantityRaw, unitRaw, totalRaw] = values;
    const description = descriptionRaw.replace(/\s{2,}/g, ' ').trim();
    const quantity = currencyValue(quantityRaw);
    const unitCost = currencyValue(unitRaw);
    const total = currencyValue(totalRaw);
    if (description && quantity > 0 && total > 0) {
      items.push({
        description,
        sku: skuRaw || null,
        quantity,
        unitCost: unitCost || total / quantity,
        total,
        category: inferCostCategory(description),
      });
    }
  }

  const total = rawText.match(/(?:total|amount paid|balance)\s*[:\-]?\s*\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/i)?.[1];
  if (!items.length && total) {
    items.push({
      description: 'Supplier invoice',
      quantity: 1,
      unitCost: currencyValue(total),
      total: currencyValue(total),
      category: 'materials',
    });
  }

  return {
    items,
    extracted: { supplier, invoiceNumber, invoiceDate },
    confidence: items.length > 1 ? 0.78 : items.length ? 0.52 : 0.2,
  };
}

function normalizeOcrItems(items: unknown): InvoiceItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item: any) => {
      const productName = String(item.productName || item.product_name || item.product || item.name || '').trim();
      const description = String(item.description || item.item || productName || '').trim();
      const size = String(item.size || item.unitSize || item.unit_size || '').trim() || null;
      const rawGallons = currencyValue(item.gallons || item.gallonQuantity || item.gallon_quantity);
      const quantity = currencyValue(item.quantity || item.qty || rawGallons || 1) || 1;
      const isGallonSized = /\b(gallon|gallons|gal)\b/i.test(size || '');
      const gallonMultiplier = isGallonSized ? currencyValue(String(size).match(/(\d+(?:\.\d+)?)\s*(?:gal|gallon)/i)?.[1]) || 1 : 0;
      const gallons = rawGallons || (isGallonSized ? quantity * gallonMultiplier : 0);
      const pricePerGallon = currencyValue(item.pricePerGallon || item.price_per_gallon || item.gallonPrice || item.gallon_price);
      const unitCost = currencyValue(item.unitCost || item.unit_cost || item.unitPrice || item.unit_price || item.cost || pricePerGallon);
      const total = currencyValue(item.total || item.amount || item.value || quantity * unitCost);
      if (!description || total <= 0) return null;
      const isFee = Boolean(item.isFee || item.is_fee || /\b(fee|paint care|paintcare|environmental|disposal)\b/i.test(description));
      return {
        description,
        sku: item.sku || item.itemNumber || item.item_number || item.salesNumber || item.sales_number || null,
        salesNumber: item.salesNumber || item.sales_number || item.saleNumber || item.sale_number || null,
        productCode: item.productCode || item.product_code || null,
        productName: productName || null,
        size,
        colorName: String(item.colorName || item.color_name || item.color || '').trim() || null,
        colorCode: String(item.colorCode || item.color_code || '').trim() || null,
        sourceInvoiceNumber: item.sourceInvoiceNumber || item.source_invoice_number || item.invoiceNumber || item.invoice_number || null,
        poNumber: item.poNumber || item.po_number || item.po || null,
        purchaseDate: item.purchaseDate || item.purchase_date || item.invoiceDate || item.invoice_date || null,
        storeNumber: item.storeNumber || item.store_number || item.store || null,
        quantity,
        unitCost: unitCost || total / quantity,
        total,
        category: item.category || (isFee ? 'fees' : inferCostCategory(description)),
        gallons: gallons || null,
        pricePerGallon: pricePerGallon || (gallons ? total / gallons : null),
        isFee,
      };
    })
    .filter(Boolean) as InvoiceItem[];
}

function parseInvoicePayload(input: z.infer<typeof importSchema>): ParsedInvoicePayload {
  if (input.csvData?.trim()) {
    const items = parseCSV(input.csvData);
    if (items.length) {
      return {
        items,
        extracted: {},
        confidence: 0.82,
        rawText: input.csvData,
      };
    }
  }

  const rawText = input.rawText?.trim() || input.csvData?.trim() || '';
  const parsed = parseTextInvoice(rawText);
  return { ...parsed, rawText };
}

async function extractInvoiceWithOpenAI(env: Env, file: File, buffer: ArrayBuffer): Promise<ParsedInvoicePayload> {
  if (!env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for OCR on PDF or image invoices.');
  }
  const mimeType = file.type || 'application/octet-stream';
  const base64 = arrayBufferToBase64(buffer);
  const isPdf = mimeType.includes('pdf') || file.name.toLowerCase().endsWith('.pdf');
  const model = env.OPENAI_OCR_MODEL || 'gpt-4.1-mini';
  const fallbackInputTokens = Math.ceil(base64.length / 4) + 600;
  const fileContent = isPdf
    ? { type: 'input_file', filename: file.name || 'invoice.pdf', file_data: `data:${mimeType};base64,${base64}` }
    : { type: 'input_image', image_url: `data:${mimeType};base64,${base64}`, detail: 'high' };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [{
        role: 'user',
        content: [
          fileContent,
          {
            type: 'input_text',
            text: [
              'Extract this painting supplier invoice or statement for job-cost review.',
              'Return JSON only with keys: supplier, invoiceNumber, invoiceDate, totalAmount, rawText, confidence, items.',
              'items must be an array of {description, sku, salesNumber, productCode, productName, size, colorName, colorCode, sourceInvoiceNumber, poNumber, purchaseDate, storeNumber, quantity, unitCost, gallons, pricePerGallon, total, category, isFee}.',
              'Sherwin-Williams PDFs may contain multiple CHARGE INVOICE sections in one file. Extract each merchandise or fee row as its own item and preserve the item sourceInvoiceNumber, purchaseDate, storeNumber, and PO# as poNumber.',
              'For Sherwin-Williams rows, map SALES NUMBER to salesNumber, PRODUCT to productCode, DESCRIPTION to description, QTY to quantity, PRICE to unitCost and pricePerGallon when SIZE is GALLON, and VALUE to total.',
              'If SIZE is GALLON or 5 GAL, quantity is the number of gallons or buckets shown and gallons must reflect the actual gallon count when clear. For example, 5 GAL with QTY 1 is 5 gallons; GALLON with QTY 4 is 4 gallons.',
              'Preserve paint colors such as SWISS COFFEE, HALE NAVY, WHITE DOVE, GRAY DECK, or CEILING MATCH and color codes such as Custom, B010, OC-17, HC-154, or Color Cast values when visible.',
              'Separate fees such as paint care, environmental, disposal, tax, or government imposed paint fees as category "fees" with isFee true.',
              'Prefer line-item detail for paint products, primer, sundries, rentals, supplies, colors, gallons, and price per gallon.',
              'Use null for unknown values; do not invent values.',
            ].join(' '),
          },
        ],
      }],
      max_output_tokens: 3000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OCR request failed: ${errorText.slice(0, 240)}`);
  }

  const payload = await response.json();
  const usage = usageFromOpenAiResponse(payload, model, fallbackInputTokens);
  const parsed = parseJsonObject(responseText(payload));
  const items = normalizeOcrItems(parsed.items);
  const rawText = String(parsed.rawText || parsed.raw_text || [
    parsed.supplier,
    parsed.invoiceNumber,
    parsed.invoiceDate,
    ...(items.map((item) => `${item.description} ${item.productCode || ''} ${item.colorName || ''} ${item.sku || ''} ${item.quantity} ${item.unitCost} ${item.total}`)),
  ].filter(Boolean).join('\n'));

  return {
    items: items.length ? items : parseTextInvoice(rawText).items,
    extracted: {
      supplier: parsed.supplier || null,
      invoiceNumber: parsed.invoiceNumber || parsed.invoice_number || null,
      invoiceDate: parsed.invoiceDate || parsed.invoice_date || null,
      totalAmount: parsed.totalAmount || parsed.total_amount || null,
    },
    confidence: clampConfidence(Number(parsed.confidence || 0.74)),
    rawText,
    metadata: {
      extractionMethod: isPdf ? 'openai_pdf_ocr' : 'openai_image_ocr',
      openaiModel: model,
      aiUsage: usage,
      contentType: mimeType,
      fileName: file.name,
    },
  };
}

async function parseMultipartInvoice(c: any, db: ReturnType<typeof createDb>, orgId: string): Promise<{ input: z.infer<typeof importSchema>; parsed: ParsedInvoicePayload; fileMetadata?: Record<string, unknown> }> {
  const formData = await c.req.formData();
  const file = formData.get('file') as File | null;
  const input = importSchema.parse({
    sourceType: 'upload',
    supplier: formData.get('supplier') || null,
    invoiceNumber: formData.get('invoiceNumber') || null,
    invoiceDate: formData.get('invoiceDate') || null,
    senderEmail: formData.get('senderEmail') || null,
    originalFilename: file?.name || null,
    rawText: formData.get('rawText') || null,
    csvData: formData.get('csvData') || null,
    jobId: formData.get('jobId') || null,
  });

  if (!file || file.size === 0) {
    return { input, parsed: parseInvoicePayload(input) };
  }
  return parseInvoiceFile(c, db, orgId, input, file);
}

async function parseInvoiceFile(
  c: any,
  db: ReturnType<typeof createDb>,
  orgId: string,
  input: z.infer<typeof importSchema>,
  file: File,
): Promise<{ input: z.infer<typeof importSchema>; parsed: ParsedInvoicePayload; fileMetadata?: Record<string, unknown> }> {
  if (file.size > MAX_INVOICE_FILE_BYTES) {
    throw new Error('Invoice file must be 15 MB or smaller.');
  }

  const buffer = await file.arrayBuffer();
  const documentHash = await sha256Hex(buffer);
  const duplicateImport = await db.query.supplierInvoiceImports.findFirst({
    where: and(eq(supplierInvoiceImports.orgId, orgId), eq(supplierInvoiceImports.documentHash, documentHash)),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });
  if (duplicateImport) {
    throw new DuplicateSupplierInvoiceError(duplicateImportMessage(duplicateImport), { invoiceImport: duplicateImport });
  }
  const fileName = safeFileName(file.name || `invoice-${Date.now()}`);
  let fileKey: string | null = null;
  let fileRetentionStatus: 'stored' | 'not_configured' | 'failed' = c.env.R2 ? 'stored' : 'not_configured';
  let fileRetentionError: string | null = null;
  if (c.env.R2) {
    const candidateKey = `supplier-invoices/${orgId}/${Date.now()}-${fileName}`;
    try {
      await c.env.R2.put(candidateKey, buffer, {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
        customMetadata: { originalName: file.name || fileName },
      });
      fileKey = candidateKey;
    } catch (error) {
      fileRetentionStatus = 'failed';
      fileRetentionError = error instanceof Error ? error.message : 'R2 file retention failed';
      console.warn('Supplier invoice file retention failed', {
        orgId,
        fileName: file.name || fileName,
        error: fileRetentionError,
      });
    }
  }

  const textLike = /text|csv|json/i.test(file.type) || /\.(csv|txt|json)$/i.test(file.name || '');
  const fileText = textLike ? new TextDecoder().decode(buffer) : '';
  if (!textLike) {
    await enforceOcrBudget(c, db, orgId);
  }
  const parsed = textLike
    ? parseInvoicePayload({ ...input, rawText: fileText, csvData: /\.(csv)$/i.test(file.name || '') ? fileText : input.csvData })
    : await extractInvoiceWithOpenAI(c.env, file, buffer);

  return {
    input,
    parsed: {
      ...parsed,
      rawText: [input.rawText, parsed.rawText].filter(Boolean).join('\n').trim(),
      metadata: {
        ...parsed.metadata,
        fileKey,
        documentHash,
        fileName: file.name || fileName,
        fileSize: file.size,
        contentType: file.type || 'application/octet-stream',
        storedInR2: Boolean(fileKey),
        fileRetentionStatus,
        fileRetentionError: fileRetentionError || undefined,
      },
    },
    fileMetadata: {
      fileKey,
      documentHash,
      fileName: file.name || fileName,
      fileSize: file.size,
      contentType: file.type || 'application/octet-stream',
      storedInR2: Boolean(fileKey),
      fileRetentionStatus,
      fileRetentionError: fileRetentionError || undefined,
    },
  };
}

function inferCostCategory(description: string) {
  const text = normalizeText(description);
  if (/\b(labor|hours|crew)\b/.test(text)) return 'labor';
  if (/\b(ladder|sprayer|rental|equipment)\b/.test(text)) return 'equipment';
  if (/\b(fee|paint care|paintcare|environmental|disposal|tax)\b/.test(text)) return 'fees';
  if (/\b(caulk|tape|plastic|mask|roller|brush|tray|sandpaper|drop cloth)\b/.test(text)) return 'supplies';
  return 'materials';
}

function inferMaterialCategory(description: string) {
  const text = normalizeText(description);
  if (/\bprimer|prime\b/.test(text)) return 'primer';
  if (/\bpaint|eggshell|satin|semi gloss|flat|gallon|superpaint|duration|regal|aura\b/.test(text)) return 'paint';
  return 'supplies';
}

function inferUnit(description: string) {
  const text = normalizeText(description);
  if (/\bquart\b/.test(text)) return 'quart';
  if (/\bgallon|gal\b/.test(text)) return 'gallon';
  return 'each';
}

function scoreJob(job: {
  id: string;
  name: string;
  jobNumber?: string | null;
  status?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  customerName?: string | null;
}, searchText: string): JobCandidate {
  const reasons: string[] = [];
  let score = 0;
  const normalized = normalizeText(searchText);

  if (job.jobNumber && normalized.includes(normalizeText(job.jobNumber))) {
    score += 0.5;
    reasons.push('Job number found');
  }

  const address = normalizeText([job.streetAddress, job.city, job.state, job.postalCode].filter(Boolean).join(' '));
  const streetNumber = String(job.streetAddress || '').match(/\d+/)?.[0];
  if (streetNumber && normalized.includes(streetNumber)) {
    score += 0.18;
    reasons.push('Street number found');
  }
  const addressTokens = address.split(' ').filter((token) => token.length > 3);
  const addressHits = addressTokens.filter((token) => normalized.includes(token)).length;
  if (addressHits) {
    score += Math.min(0.36, addressHits * 0.09);
    reasons.push('Address text matched');
  }

  const nameTokens = normalizeText(job.customerName || job.name).split(' ').filter((token) => token.length > 2);
  const nameHits = nameTokens.filter((token) => normalized.includes(token)).length;
  if (nameHits) {
    score += Math.min(0.22, nameHits * 0.08);
    reasons.push('Customer/project name matched');
  }

  if (['in_progress', 'scheduled'].includes(String(job.status))) {
    score += 0.12;
    reasons.push('Active job');
  }

  return { ...job, confidence: clampConfidence(score), reasons };
}

async function getJobCandidates(db: ReturnType<typeof createDb>, orgId: string, searchText: string) {
  const rows = await db
    .select({
      id: jobs.id,
      name: jobs.name,
      jobNumber: jobs.jobNumber,
      status: jobs.status,
      streetAddress: jobs.streetAddress,
      city: jobs.city,
      state: jobs.state,
      postalCode: jobs.postalCode,
      customerName: leads.name,
    })
    .from(jobs)
    .leftJoin(leads, eq(jobs.leadId, leads.id))
    .where(eq(jobs.orgId, orgId))
    .orderBy(desc(jobs.updatedAt))
    .limit(80);

  return rows
    .map((job) => scoreJob(job, searchText))
    .filter((candidate) => candidate.confidence > 0.08)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 5);
}

async function ensurePremiumAccess(db: ReturnType<typeof createDb>, orgId: string, env: Env) {
  if (env.INVOICE_AUTOMATION_ENABLED === 'true' || env.ENVIRONMENT !== 'production') return true;
  const [subscription] = await db
    .select({ planName: saasPlans.name, status: subscriptions.status })
    .from(subscriptions)
    .leftJoin(saasPlans, eq(subscriptions.planId, saasPlans.id))
    .where(eq(subscriptions.orgId, orgId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return ['trial', 'active'].includes(String(subscription?.status || ''))
    && ['pro', 'enterprise'].includes(String(subscription?.planName || '').toLowerCase());
}

async function applyInvoiceImport(
  db: ReturnType<typeof createDb>,
  orgId: string,
  invoiceImport: InvoiceImportRecord,
  jobId: string | null | undefined,
  applyMaterialUpdates: boolean,
) {
  const items = Array.isArray(invoiceImport.extractedItems) ? invoiceImport.extractedItems as InvoiceItem[] : [];
  const supplier = invoiceImport.supplier || 'Unknown supplier';
  const totalAmount = items.reduce((sum, item) => sum + currencyValue(item.total), 0) || currencyValue(invoiceImport.totalAmount);
  const extractedData = invoiceImport.extractedData as { fileKey?: string; storedInR2?: boolean; documentHash?: string } | null;
  const invoiceCostDate = dateValue(invoiceImport.invoiceDate) || dateValue(invoiceImport.createdAt) || new Date();
  const documentHash = invoiceImport.documentHash || extractedData?.documentHash || null;

  const duplicatePurchase = documentHash
    ? await db.query.materialPurchases.findFirst({
      where: and(eq(materialPurchases.orgId, orgId), eq(materialPurchases.documentHash, documentHash)),
    })
    : invoiceImport.invoiceNumber
      ? await db.query.materialPurchases.findFirst({
        where: and(
          eq(materialPurchases.orgId, orgId),
          eq(materialPurchases.supplier, supplier),
          eq(materialPurchases.invoiceNumber, invoiceImport.invoiceNumber),
        ),
      })
      : null;
  if (duplicatePurchase) {
    throw new DuplicateSupplierInvoiceError('This supplier invoice has already been approved.', { purchase: duplicatePurchase });
  }

  const [purchase] = await db.insert(materialPurchases).values({
    orgId,
    jobId: jobId || null,
    supplier,
    invoiceNumber: invoiceImport.invoiceNumber || null,
    invoiceDate: invoiceImport.invoiceDate || null,
    documentHash,
    totalAmount: totalAmount.toFixed(2),
    fileUrl: extractedData?.storedInR2 && extractedData?.fileKey ? `/v1/invoices/imports/${invoiceImport.id}/file` : null,
    parsedData: items,
  }).returning();

  const existingMaterials = applyMaterialUpdates
    ? await db.query.materials.findMany({ where: eq(materials.orgId, orgId) })
    : [];

  for (const item of items) {
    const description = String(item.description || item.productName || 'Supplier invoice item').slice(0, 255);
    const materialName = String(item.productName || item.description || 'Supplier invoice item').slice(0, 255);
    const unitCost = currencyValue(item.pricePerGallon || item.unitCost);
    if (applyMaterialUpdates && !item.isFee) {
      const sku = String(item.sku || '').trim();
      const normalizedName = normalizeText(materialName);
      const material = existingMaterials.find((candidate) => (
        (sku && candidate.sku === sku)
        || (normalizeText(candidate.name) === normalizedName && normalizeText(candidate.supplier) === normalizeText(supplier))
      ));
      if (material) {
        await db.update(materials)
          .set({
            costPerUnit: unitCost.toFixed(2),
            supplier,
            sku: sku || material.sku,
            updatedAt: new Date(),
          })
          .where(and(eq(materials.id, material.id), eq(materials.orgId, orgId)));
      } else {
        await db.insert(materials).values({
          orgId,
          name: materialName,
          category: inferMaterialCategory(description),
          unit: inferUnit(description),
          costPerUnit: unitCost.toFixed(2),
          supplier,
          sku: sku || null,
        });
      }
    }

    if (jobId) {
      await db.insert(jobCosts).values({
        orgId,
        jobId,
        category: item.category || inferCostCategory(description),
        description,
        quantity: currencyValue(item.quantity || 1).toFixed(2),
        unitCost: unitCost.toFixed(2),
        totalCost: currencyValue(item.total || currencyValue(item.quantity || 1) * unitCost).toFixed(2),
        materialPurchaseId: purchase.id,
        costDate: dateValue(item.purchaseDate) || invoiceCostDate,
      });
    }
  }

  return purchase;
}

function buildLearningHints(args: {
  invoiceImport: InvoiceImportRecord;
  outcome: 'approved' | 'rejected';
  finalJobId?: string | null;
  suggestedJobId?: string | null;
  matchWasCorrect: boolean;
}) {
  const candidates = Array.isArray(args.invoiceImport.matchCandidates) ? args.invoiceImport.matchCandidates as JobCandidate[] : [];
  return {
    trustedMatchThreshold: args.outcome === 'approved' && args.matchWasCorrect ? Number(args.invoiceImport.matchConfidence || 0) : null,
    lastRejectedConfidence: args.outcome === 'rejected' ? Number(args.invoiceImport.matchConfidence || 0) : null,
    lastCorrection: args.finalJobId && args.suggestedJobId !== args.finalJobId ? {
      suggestedJobId: args.suggestedJobId,
      finalJobId: args.finalJobId,
    } : null,
    strongestReasons: candidates[0]?.reasons || [],
  };
}

async function upsertSupplierLearningStats(
  db: ReturnType<typeof createDb>,
  invoiceImport: InvoiceImportRecord,
  outcome: 'approved' | 'rejected',
  finalJobId?: string | null,
) {
  const key = supplierKey(invoiceImport.supplier);
  const extractionMethod = extractionMethodFor(invoiceImport);
  const sourceType = invoiceImport.sourceType || 'upload';
  const suggestedJobId = invoiceImport.jobId || null;
  const matchWasCorrect = Boolean(suggestedJobId && finalJobId && suggestedJobId === finalJobId);
  const matchConfidence = currencyValue(invoiceImport.matchConfidence);
  const extractionConfidence = currencyValue(invoiceImport.extractionConfidence);
  const existing = await db.query.supplierInvoiceLearningStats.findFirst({
    where: and(
      isNull(supplierInvoiceLearningStats.orgId),
      eq(supplierInvoiceLearningStats.supplierKey, key),
      eq(supplierInvoiceLearningStats.sourceType, sourceType),
      eq(supplierInvoiceLearningStats.extractionMethod, extractionMethod),
    ),
  });
  const hints = buildLearningHints({ invoiceImport, outcome, finalJobId, suggestedJobId, matchWasCorrect });

  if (!existing) {
    await db.insert(supplierInvoiceLearningStats).values({
      orgId: null,
      supplierKey: key,
      supplierName: invoiceImport.supplier,
      sourceType,
      extractionMethod,
      approvedCount: outcome === 'approved' ? 1 : 0,
      rejectedCount: outcome === 'rejected' ? 1 : 0,
      correctedJobCount: finalJobId && suggestedJobId !== finalJobId ? 1 : 0,
      noJobApprovalCount: outcome === 'approved' && !finalJobId ? 1 : 0,
      avgMatchConfidence: matchConfidence.toFixed(2),
      avgExtractionConfidence: extractionConfidence.toFixed(2),
      hints,
      lastApprovedAt: outcome === 'approved' ? new Date() : null,
      lastRejectedAt: outcome === 'rejected' ? new Date() : null,
    });
    return;
  }

  const oldTotal = Number(existing.approvedCount || 0) + Number(existing.rejectedCount || 0);
  const nextTotal = oldTotal + 1;
  const avgMatch = ((currencyValue(existing.avgMatchConfidence) * oldTotal) + matchConfidence) / nextTotal;
  const avgExtraction = ((currencyValue(existing.avgExtractionConfidence) * oldTotal) + extractionConfidence) / nextTotal;

  await db.update(supplierInvoiceLearningStats)
    .set({
      supplierName: invoiceImport.supplier || existing.supplierName,
      approvedCount: Number(existing.approvedCount || 0) + (outcome === 'approved' ? 1 : 0),
      rejectedCount: Number(existing.rejectedCount || 0) + (outcome === 'rejected' ? 1 : 0),
      correctedJobCount: Number(existing.correctedJobCount || 0) + (finalJobId && suggestedJobId !== finalJobId ? 1 : 0),
      noJobApprovalCount: Number(existing.noJobApprovalCount || 0) + (outcome === 'approved' && !finalJobId ? 1 : 0),
      avgMatchConfidence: avgMatch.toFixed(2),
      avgExtractionConfidence: avgExtraction.toFixed(2),
      hints: { ...(existing.hints as Record<string, unknown> || {}), latest: hints },
      lastApprovedAt: outcome === 'approved' ? new Date() : existing.lastApprovedAt,
      lastRejectedAt: outcome === 'rejected' ? new Date() : existing.lastRejectedAt,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(supplierInvoiceLearningStats.id, existing.id));
}

async function recordInvoiceImportFeedback(
  db: ReturnType<typeof createDb>,
  orgId: string,
  invoiceImport: InvoiceImportRecord,
  outcome: 'approved' | 'rejected',
  finalJobId?: string | null,
  reviewNotes?: string | null,
) {
  const items = Array.isArray(invoiceImport.extractedItems) ? invoiceImport.extractedItems as InvoiceItem[] : [];
  const suggestedJobId = invoiceImport.jobId || null;
  await db.insert(supplierInvoiceImportFeedback).values({
    orgId,
    importId: invoiceImport.id,
    supplierKey: supplierKey(invoiceImport.supplier),
    supplierName: invoiceImport.supplier,
    sourceType: invoiceImport.sourceType || 'upload',
    extractionMethod: extractionMethodFor(invoiceImport),
    outcome,
    suggestedJobId,
    finalJobId: finalJobId || null,
    matchWasCorrect: Boolean(suggestedJobId && finalJobId && suggestedJobId === finalJobId),
    hadJobSuggestion: Boolean(suggestedJobId),
    matchConfidence: currencyValue(invoiceImport.matchConfidence).toFixed(2),
    extractionConfidence: currencyValue(invoiceImport.extractionConfidence).toFixed(2),
    itemCount: items.length,
    totalAmount: currencyValue(invoiceImport.totalAmount).toFixed(2),
    reviewNotes: reviewNotes || null,
  });
  await upsertSupplierLearningStats(db, invoiceImport, outcome, finalJobId);
}

async function stageSupplierInvoiceImport(
  c: any,
  db: ReturnType<typeof createDb>,
  orgId: string,
  input: z.infer<typeof importSchema>,
  parsed: ParsedInvoicePayload,
  userId?: string | null,
) {
  if (!parsed.rawText?.trim()) throw new Error('Paste supplier invoice text or upload a supplier invoice file.');
  if (!parsed.items.length) throw new Error('No invoice line items could be extracted.');

  const matchCandidates = input.jobId
    ? []
    : await getJobCandidates(db, orgId, [parsed.rawText, input.supplier, input.invoiceNumber].filter(Boolean).join(' '));
  const bestMatch = input.jobId ? { id: input.jobId, confidence: 0.99 } : matchCandidates[0];
  const suggestedJobId = bestMatch && bestMatch.confidence >= 0.65 ? bestMatch.id : null;
  const extractedSupplier = input.supplier || String(parsed.extracted.supplier || '').trim() || null;
  const invoiceNumber = input.invoiceNumber || String(parsed.extracted.invoiceNumber || '').trim() || null;
  const invoiceDate = dateValue(input.invoiceDate) || dateValue(parsed.extracted.invoiceDate);
  const totalAmount = parsed.items.reduce((sum, item) => sum + currencyValue(item.total), 0);
  const documentHash = String(parsed.metadata?.documentHash || '').trim()
    || await sha256Hex(normalizedDocumentText(parsed.rawText));
  const duplicateImport = await db.query.supplierInvoiceImports.findFirst({
    where: and(eq(supplierInvoiceImports.orgId, orgId), eq(supplierInvoiceImports.documentHash, documentHash)),
    orderBy: (table, { desc }) => [desc(table.createdAt)],
  });
  if (duplicateImport) {
    throw new DuplicateSupplierInvoiceError(duplicateImportMessage(duplicateImport), { invoiceImport: duplicateImport });
  }
  const duplicatePurchase = documentHash
    ? await db.query.materialPurchases.findFirst({
      where: and(eq(materialPurchases.orgId, orgId), eq(materialPurchases.documentHash, documentHash)),
    })
    : null;
  if (duplicatePurchase) {
    throw new DuplicateSupplierInvoiceError('This supplier invoice has already been approved.', { purchase: duplicatePurchase });
  }
  if (extractedSupplier && invoiceNumber) {
    const invoiceNumberPurchase = await db.query.materialPurchases.findFirst({
      where: and(
        eq(materialPurchases.orgId, orgId),
        eq(materialPurchases.supplier, extractedSupplier),
        eq(materialPurchases.invoiceNumber, invoiceNumber),
      ),
    });
    if (invoiceNumberPurchase) {
      throw new DuplicateSupplierInvoiceError('This supplier invoice number has already been approved.', { purchase: invoiceNumberPurchase });
    }
  }
  const senderRule = input.senderEmail
    ? await db.query.supplierInvoiceSenderRules.findFirst({
      where: and(
        eq(supplierInvoiceSenderRules.orgId, orgId),
        eq(supplierInvoiceSenderRules.senderEmail, input.senderEmail.toLowerCase()),
        eq(supplierInvoiceSenderRules.supplierKey, supplierKey(extractedSupplier)),
        eq(supplierInvoiceSenderRules.isActive, true),
      ),
    })
    : null;

  const [invoiceImport] = await db.insert(supplierInvoiceImports).values({
    orgId,
    jobId: suggestedJobId,
    sourceType: input.sourceType,
    status: 'needs_review',
    supplier: extractedSupplier,
    invoiceNumber,
    invoiceDate,
    senderEmail: input.senderEmail || null,
    originalFilename: input.originalFilename || null,
    documentHash,
    rawText: parsed.rawText,
    extractedData: {
      extractionMethod: parsed.metadata?.extractionMethod || (input.csvData ? 'csv' : 'deterministic_text'),
      extractedSupplier,
      invoiceNumber,
      source: input.sourceType,
      senderRuleMatched: Boolean(senderRule),
      trustedSenderRuleId: senderRule?.id || null,
      ...parsed.metadata,
    },
    extractedItems: parsed.items,
    totalAmount: totalAmount.toFixed(2),
    matchCandidates,
    matchConfidence: clampConfidence(bestMatch?.confidence || 0).toFixed(2),
    extractionConfidence: clampConfidence(parsed.confidence).toFixed(2),
  }).returning();

  const aiUsage = parsed.metadata?.aiUsage as AiUsageEstimate | undefined;
  if (aiUsage) {
    await db.insert(aiUsageEvents).values({
      orgId,
      userId: userId || null,
      feature: OCR_FEATURE_KEY,
      provider: aiUsage.provider,
      model: aiUsage.model,
      entityType: 'supplier_invoice_import',
      entityId: invoiceImport.id,
      inputTokens: aiUsage.inputTokens,
      outputTokens: aiUsage.outputTokens,
      totalTokens: aiUsage.totalTokens,
      estimatedCostUsd: aiUsage.estimatedCostUsd.toFixed(6),
      metadata: {
        sourceType: input.sourceType,
        contentType: parsed.metadata?.contentType,
        fileName: parsed.metadata?.fileName,
        extractionMethod: parsed.metadata?.extractionMethod,
      },
    });
  }

  return invoiceImport;
}

function emailAddress(value: string) {
  return value.match(/<([^>]+)>/)?.[1]?.trim().toLowerCase() || value.trim().toLowerCase();
}

function inboundOrgSlug(value: unknown) {
  const addresses = Array.isArray(value) ? value : value ? [String(value)] : [];
  for (const raw of addresses) {
    const address = emailAddress(raw);
    const local = address.split('@')[0] || '';
    const domain = address.split('@')[1] || '';
    const plusMatch = local.match(/^(?:receipts|invoices)[+-]([a-z0-9-]+)$/i);
    if (plusMatch?.[1]) return plusMatch[1].toLowerCase();
    const dotMatch = local.match(/^([a-z0-9-]+)[._-](?:receipts|invoices)$/i);
    if (dotMatch?.[1]) return dotMatch[1].toLowerCase();
    const inboundSubdomainMatch = domain.match(/^(?:receipts|invoices)\./i);
    if (inboundSubdomainMatch && /^[a-z0-9-]+$/i.test(local)) return local.toLowerCase();
  }
  return null;
}

function inboundEmailDomain(env: Env) {
  return (env.INBOUND_INVOICE_EMAIL_DOMAIN || 'receipts.crewmodo.com').replace(/^@+/, '').trim();
}

function fileFromBase64(attachment: z.infer<typeof inboundEmailSchema>['attachments'][number]) {
  const binary = atob(attachment.contentBase64.replace(/^data:[^;]+;base64,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new File([bytes], attachment.filename, {
    type: attachment.contentType || 'application/octet-stream',
  });
}

async function requireInboundSecret(c: any) {
  const expected = c.env.INBOUND_INVOICE_EMAIL_SECRET;
  const provided = c.req.header('x-crewmodo-inbound-secret')
    || c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  return Boolean(expected && provided && provided === expected);
}

invoicesApp.post('/imports/email-forward', async (c) => {
  if (!await requireInboundSecret(c)) {
    return c.json({ error: 'Inbound invoice email is not configured or the request is unauthorized.' }, 401);
  }

  const parsedBody = inboundEmailSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsedBody.success) {
    return c.json({ error: 'Invalid inbound email payload', details: parsedBody.error.flatten() }, 400);
  }

  const payload = parsedBody.data;
  const slug = inboundOrgSlug(payload.to);
  if (!slug) {
    return c.json({ error: 'Forward to receipts+workspace-slug@your-domain so Crewmodo can route the invoice.' }, 400);
  }

  const db = createDb(c.env.DATABASE_URL);
  const org = await db.query.organizations.findFirst({ where: eq(organizations.slug, slug) });
  if (!org) return c.json({ error: 'No contractor workspace matched the forwarding address.' }, 404);
  if (!await ensurePremiumAccess(db, org.id, c.env)) {
    return c.json({ error: 'Supplier invoice automation is a premium feature.' }, 402);
  }

  const sender = emailAddress(payload.from);
  const trustedRule = await db.query.supplierInvoiceSenderRules.findFirst({
    where: and(
      eq(supplierInvoiceSenderRules.orgId, org.id),
      eq(supplierInvoiceSenderRules.senderEmail, sender),
      eq(supplierInvoiceSenderRules.isActive, true),
    ),
  });
  if (!trustedRule) {
    return c.json({ error: 'Sender is not whitelisted for supplier invoice forwarding.' }, 403);
  }

  const supportedAttachments = payload.attachments.filter((attachment) => (
    /pdf|image|text|csv|json/i.test(attachment.contentType || '')
    || /\.(pdf|png|jpe?g|webp|csv|txt|json)$/i.test(attachment.filename)
  ));
  if (!supportedAttachments.length && !payload.text?.trim()) {
    return c.json({ error: 'No supported invoice attachment or plain text body was found.' }, 400);
  }

  const imports = [];
  const duplicates = [];
  for (const attachment of supportedAttachments.slice(0, 5)) {
    try {
      const file = fileFromBase64(attachment);
      const input = importSchema.parse({
        sourceType: 'email_forward',
        supplier: trustedRule.supplierName || trustedRule.supplierKey,
        senderEmail: sender,
        originalFilename: attachment.filename,
        rawText: [payload.subject, payload.text].filter(Boolean).join('\n'),
      });
      const { parsed } = await parseInvoiceFile(c, db, org.id, input, file);
      imports.push(await stageSupplierInvoiceImport(c, db, org.id, input, parsed, null));
    } catch (err) {
      if (err instanceof DuplicateSupplierInvoiceError) {
        duplicates.push({ filename: attachment.filename, id: err.invoiceImport?.id || err.purchase?.id || null, type: err.invoiceImport ? 'import' : 'purchase' });
        continue;
      }
      throw err;
    }
  }

  if (!imports.length && payload.text?.trim()) {
    const input = importSchema.parse({
      sourceType: 'email_forward',
      supplier: trustedRule.supplierName || trustedRule.supplierKey,
      senderEmail: sender,
      rawText: [payload.subject, payload.text].filter(Boolean).join('\n'),
    });
    try {
      imports.push(await stageSupplierInvoiceImport(c, db, org.id, input, parseInvoicePayload(input), null));
    } catch (err) {
      if (err instanceof DuplicateSupplierInvoiceError) {
        duplicates.push({ filename: null, id: err.invoiceImport?.id || err.purchase?.id || null, type: err.invoiceImport ? 'import' : 'purchase' });
      } else {
        throw err;
      }
    }
  }

  if (imports.length) {
    await Promise.all(imports.map((invoiceImport) => createNotificationAndPush(c.env, {
      orgId: org.id,
      type: 'supplier_invoice.imported',
      title: 'Supplier invoice ready for review',
      body: `${invoiceImport.supplier || trustedRule.supplierName || 'Supplier invoice'} from ${sender} was staged for review.`,
      href: '/invoices?mode=supplier',
      sourceType: 'supplier_invoice_import',
      sourceId: invoiceImport.id,
      metadata: {
        sourceType: 'email_forward',
        sender,
        subject: payload.subject,
        originalFilename: invoiceImport.originalFilename,
        invoiceNumber: invoiceImport.invoiceNumber,
      },
    }))).catch((err) => console.error('Supplier invoice notification failed:', err));
  }

  return c.json({ data: { imports, duplicates, ignoredAttachments: payload.attachments.length - supportedAttachments.length } }, 202);
});

invoicesApp.use('*', authMiddleware);

invoicesApp.get('/inbound-email-config', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const org = await db.query.organizations.findFirst({ where: eq(organizations.id, orgId) });
  const slug = org?.slug || 'workspace-slug';
  const domain = inboundEmailDomain(c.env);
  return c.json({
    data: {
      enabled: Boolean(c.env.INBOUND_INVOICE_EMAIL_SECRET),
      domain,
      workspaceSlug: slug,
      forwardingAddress: `receipts+${slug}@${domain}`,
      alternateAddress: `${slug}@${domain}`,
      requiresTrustedSender: true,
    },
  });
});

invoicesApp.get('/customer', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const rows = await db
    .select({
      invoice: {
        id: customerInvoices.id,
        orgId: customerInvoices.orgId,
        leadId: customerInvoices.leadId,
        jobId: customerInvoices.jobId,
        invoiceNumber: customerInvoices.invoiceNumber,
        description: customerInvoices.description,
        lineItems: customerInvoices.lineItems,
        subtotal: customerInvoices.subtotal,
        tax: customerInvoices.tax,
        total: customerInvoices.total,
        status: customerInvoices.status,
        dueDate: customerInvoices.dueDate,
        dueLabel: customerInvoices.dueLabel,
        reminderCadence: customerInvoices.reminderCadence,
        taxRate: customerInvoices.taxRate,
        taxOverride: customerInvoices.taxOverride,
        note: customerInvoices.note,
        sentAt: customerInvoices.sentAt,
        paidAt: customerInvoices.paidAt,
        voidedAt: customerInvoices.voidedAt,
        voidReason: customerInvoices.voidReason,
        createdBy: customerInvoices.createdBy,
        createdAt: customerInvoices.createdAt,
        updatedAt: customerInvoices.updatedAt,
      },
      leadName: leads.name,
      leadEmail: leads.email,
      leadPhone: leads.phone,
      leadStreetAddress: leads.streetAddress,
      leadCity: leads.city,
      leadState: leads.state,
      leadPostalCode: leads.postalCode,
      jobName: jobs.name,
      jobNumber: jobs.jobNumber,
      jobStreetAddress: jobs.streetAddress,
      jobCity: jobs.city,
      jobState: jobs.state,
      jobPostalCode: jobs.postalCode,
    })
    .from(customerInvoices)
    .leftJoin(leads, eq(customerInvoices.leadId, leads.id))
    .leftJoin(jobs, eq(customerInvoices.jobId, jobs.id))
    .where(eq(customerInvoices.orgId, orgId))
    .orderBy(desc(customerInvoices.createdAt))
    .limit(100);

  const payments = await db.query.customerPayments.findMany({
    where: and(eq(customerPayments.orgId, orgId), isNotNull(customerPayments.invoiceId)),
    orderBy: (table, { desc }) => [desc(table.receivedAt)],
    limit: 500,
  });
  const paymentsByInvoice = new Map<string, typeof payments>();
  payments.forEach((payment) => {
    if (!payment.invoiceId) return;
    const list = paymentsByInvoice.get(payment.invoiceId) || [];
    list.push(payment);
    paymentsByInvoice.set(payment.invoiceId, list);
  });

  return c.json({
    data: rows.map((row) => ({
      ...row.invoice,
      leadName: row.leadName,
      leadEmail: row.leadEmail,
      leadPhone: row.leadPhone,
      leadStreetAddress: row.leadStreetAddress,
      leadCity: row.leadCity,
      leadState: row.leadState,
      leadPostalCode: row.leadPostalCode,
      jobName: row.jobName,
      jobNumber: row.jobNumber,
      jobStreetAddress: row.jobStreetAddress,
      jobCity: row.jobCity,
      jobState: row.jobState,
      jobPostalCode: row.jobPostalCode,
      payments: paymentsByInvoice.get(row.invoice.id) || [],
    })),
  });
});

invoicesApp.get('/customer/:id', async (c) => {
  const orgId = c.get('orgId');
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);
  const invoice = await db.query.customerInvoices.findFirst({
    where: and(eq(customerInvoices.id, id), eq(customerInvoices.orgId, orgId)),
  });
  if (!invoice) return c.json({ error: 'Invoice not found' }, 404);

  const [lead, job, payments] = await Promise.all([
    db.query.leads.findFirst({ where: and(eq(leads.id, invoice.leadId), eq(leads.orgId, orgId)) }),
    invoice.jobId ? db.query.jobs.findFirst({ where: and(eq(jobs.id, invoice.jobId), eq(jobs.orgId, orgId)) }) : Promise.resolve(null),
    db.query.customerPayments.findMany({
      where: and(eq(customerPayments.orgId, orgId), eq(customerPayments.invoiceId, invoice.id)),
      orderBy: (table, { desc }) => [desc(table.receivedAt)],
      limit: 100,
    }),
  ]);

  return c.json({
    data: {
      ...invoice,
      leadName: lead?.name || null,
      leadEmail: lead?.email || null,
      leadPhone: lead?.phone || null,
      leadStreetAddress: lead?.streetAddress || null,
      leadCity: lead?.city || null,
      leadState: lead?.state || null,
      leadPostalCode: lead?.postalCode || null,
      jobName: job?.name || null,
      jobNumber: job?.jobNumber || null,
      jobStreetAddress: job?.streetAddress || null,
      jobCity: job?.city || null,
      jobState: job?.state || null,
      jobPostalCode: job?.postalCode || null,
      payments,
    },
  });
});

invoicesApp.post('/customer', async (c) => {
  const idempotencyError = requireIdempotency(c);
  if (idempotencyError) return idempotencyError;
  const idempotencyKey = c.req.header('Idempotency-Key')!.trim();
  const orgId = c.get('orgId');
  const userId = c.get('userId') || null;
  const input = customerInvoiceCreateSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);

  const lead = await db.query.leads.findFirst({
    where: and(eq(leads.id, input.leadId), eq(leads.orgId, orgId)),
  });
  if (!lead) return c.json({ error: 'Customer not found' }, 404);

  if (input.jobId) {
    const job = await db.query.jobs.findFirst({
      where: and(eq(jobs.id, input.jobId), eq(jobs.orgId, orgId)),
    });
    if (!job) return c.json({ error: 'Job not found' }, 404);
  }

  const token = idempotencyKey.replace(/[^a-z0-9]/gi, '').slice(0, 8).toUpperCase() || crypto.randomUUID().slice(0, 8).toUpperCase();
  const invoiceNumber = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${token}`;
  const existing = await db.query.customerInvoices.findFirst({
    where: and(eq(customerInvoices.orgId, orgId), eq(customerInvoices.invoiceNumber, invoiceNumber)),
  });
  if (existing) return c.json({ data: existing, duplicate: true });

  const subtotal = Math.round(Number(input.amount) * 100) / 100;
  const tax = Math.round(Number(input.tax || 0) * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  const lineItems = [{
    description: input.description,
    quantity: 1,
    unitPrice: subtotal,
    total: subtotal,
    category: 'service',
  }];

  const [invoice] = await db.insert(customerInvoices).values({
    orgId,
    leadId: lead.id,
    jobId: input.jobId || null,
    invoiceNumber,
    description: input.description,
    lineItems,
    subtotal: subtotal.toFixed(2),
    tax: tax.toFixed(2),
    total: total.toFixed(2),
    status: 'sent',
    dueDate: dateValue(input.dueDate),
    dueLabel: input.dueLabel || (input.dueDate ? `Due ${dateValue(input.dueDate)?.toLocaleDateString('en-US')}` : 'Due on receipt'),
    reminderCadence: input.reminderCadence || 'due_date',
    taxRate: input.taxRate == null ? null : (Number(input.taxRate) > 1 ? Number(input.taxRate) / 100 : Number(input.taxRate)).toFixed(4),
    taxOverride: Boolean(input.taxOverride),
    note: input.note || null,
    createdBy: userId,
  }).returning();

  await db.insert(auditLogs).values({
    orgId,
    userId,
    action: 'invoice.created',
    entityType: 'invoice',
    entityId: invoice.id,
    metadata: {
      leadId: lead.id,
      jobId: input.jobId || null,
      invoiceNumber,
      total,
      idempotencyKey,
    },
  });

  let emailSendId: string | null = null;
  let emailSent = false;
  try {
    const result = await sendInvoiceEmail(c.env, db, {
      orgId,
      invoice,
      templateKey: 'invoice.quick.created',
      balanceDue: total,
      sentBy: userId,
    });
    emailSent = result.sent;
    emailSendId = result.emailSendId || null;
  } catch (error) {
    console.error('Failed to send customer invoice email:', error);
  }

  if (emailSent) {
    await db.insert(auditLogs).values({
      orgId,
      userId,
      action: 'invoice.sent',
      entityType: 'invoice',
      entityId: invoice.id,
      metadata: {
        leadId: lead.id,
        jobId: input.jobId || null,
        invoiceNumber,
        total,
        emailSendId,
      },
    });
  }

  return c.json({ data: { ...invoice, emailSent, emailSendId } }, 201);
});

invoicesApp.post('/customer/:id/send-reminder', async (c) => {
  const idempotencyError = requireIdempotency(c);
  if (idempotencyError) return idempotencyError;
  const orgId = c.get('orgId');
  const userId = c.get('userId') || null;
  const id = c.req.param('id');
  const db = createDb(c.env.DATABASE_URL);

  const invoice = await db.query.customerInvoices.findFirst({
    where: and(eq(customerInvoices.id, id), eq(customerInvoices.orgId, orgId)),
  });
  if (!invoice) return c.json({ error: 'Invoice not found' }, 404);
  if (['canceled', 'voided', 'paid'].includes(invoice.status)) {
    return c.json({ error: 'This invoice is not open for reminders.' }, 409);
  }

  const payments = await db.query.customerPayments.findMany({
    where: and(eq(customerPayments.orgId, orgId), eq(customerPayments.invoiceId, invoice.id)),
    orderBy: (table, { desc }) => [desc(table.receivedAt)],
    limit: 100,
  });
  const paid = payments
    .filter((payment) => ['succeeded', 'paid', 'partially_refunded', 'refunded'].includes(payment.status))
    .reduce((sum, payment) => sum + Number(payment.amount || 0) - Number(payment.refundedAmount || 0), 0);
  const balanceDue = Math.round(Math.max(Number(invoice.total || 0) - paid, 0) * 100) / 100;
  if (balanceDue <= 0.005) {
    return c.json({ error: 'This invoice is already paid in full.' }, 409);
  }

  try {
    const result = await sendInvoiceEmail(c.env, db, {
      orgId,
      invoice,
      templateKey: 'invoice.payment.reminder',
      balanceDue,
      sentBy: userId,
    });
    if (!result.sent) {
      return c.json({ error: 'Customer email is required before sending a reminder.' }, 409);
    }
    await db.insert(auditLogs).values({
      orgId,
      userId,
      action: 'invoice.reminder_sent',
      entityType: 'invoice',
      entityId: invoice.id,
      metadata: {
        leadId: invoice.leadId,
        jobId: invoice.jobId || null,
        balanceDue,
        emailSendId: result.emailSendId || null,
      },
    });
    return c.json({ data: { sent: true, emailSendId: result.emailSendId || null } });
  } catch (error) {
    console.error('Failed to send invoice reminder:', error);
    return c.json({ error: 'Failed to send invoice reminder.' }, 500);
  }
});

invoicesApp.post('/imports', async (c) => {
  const idempotencyError = requireIdempotency(c);
  if (idempotencyError) return idempotencyError;
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  if (!await ensurePremiumAccess(db, orgId, c.env)) {
    return c.json({ error: 'Supplier invoice automation is a premium feature.' }, 402);
  }
  let input: z.infer<typeof importSchema>;
  let parsed: ParsedInvoicePayload;
  try {
    if ((c.req.header('content-type') || '').includes('multipart/form-data')) {
      const multipart = await parseMultipartInvoice(c, db, orgId);
      input = multipart.input;
      parsed = multipart.parsed;
    } else {
      input = importSchema.parse(await c.req.json());
      parsed = parseInvoicePayload(input);
    }
  } catch (err) {
    if (err instanceof DuplicateSupplierInvoiceError) {
      return c.json({
        error: err.message,
        duplicate: true,
        data: err.invoiceImport || err.purchase,
        duplicateType: err.invoiceImport ? 'import' : 'purchase',
      }, 409);
    }
    return c.json({ error: err instanceof Error ? err.message : 'Failed to process supplier invoice.' }, 400);
  }
  if (!parsed.rawText?.trim()) return c.json({ error: 'Paste supplier invoice text or CSV data.' }, 400);
  if (!parsed.items.length) return c.json({ error: 'No invoice line items could be extracted.' }, 400);

  let invoiceImport: InvoiceImportRecord;
  try {
    invoiceImport = await stageSupplierInvoiceImport(c, db, orgId, input, parsed, c.get('userId') || null);
  } catch (err) {
    if (err instanceof DuplicateSupplierInvoiceError) {
      return c.json({
        error: err.message,
        duplicate: true,
        data: err.invoiceImport || err.purchase,
        duplicateType: err.invoiceImport ? 'import' : 'purchase',
      }, 409);
    }
    throw err;
  }

  return c.json({ data: invoiceImport }, 201);
});

invoicesApp.get('/imports', async (c) => {
  const orgId = c.get('orgId');
  const status = c.req.query('status');
  const db = createDb(c.env.DATABASE_URL);
  const where = status
    ? and(eq(supplierInvoiceImports.orgId, orgId), eq(supplierInvoiceImports.status, status))
    : eq(supplierInvoiceImports.orgId, orgId);
  const imports = await db.query.supplierInvoiceImports.findMany({
    where,
    orderBy: (table, { desc }) => [desc(table.createdAt)],
    limit: 50,
  });
  return c.json({ data: imports });
});

invoicesApp.get('/imports/learning', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const [stats, feedback] = await Promise.all([
    db.query.supplierInvoiceLearningStats.findMany({
      where: isNull(supplierInvoiceLearningStats.orgId),
      orderBy: (table, { desc }) => [desc(table.lastSeenAt)],
      limit: 25,
    }),
    db.query.supplierInvoiceImportFeedback.findMany({
      where: eq(supplierInvoiceImportFeedback.orgId, orgId),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      limit: 25,
    }),
  ]);
  return c.json({ data: { stats, feedback } });
});

invoicesApp.get('/imports/ai-usage', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const [today, month, recent] = await Promise.all([
    db.select({
      requests: sql<number>`count(*)`,
      totalTokens: sql<number>`coalesce(sum(${aiUsageEvents.totalTokens}), 0)`,
      estimatedCostUsd: sql<number>`coalesce(sum(${aiUsageEvents.estimatedCostUsd}), 0)`,
    }).from(aiUsageEvents).where(and(
      eq(aiUsageEvents.orgId, orgId),
      eq(aiUsageEvents.feature, OCR_FEATURE_KEY),
      gte(aiUsageEvents.createdAt, dayStart()),
    )),
    db.select({
      requests: sql<number>`count(*)`,
      inputTokens: sql<number>`coalesce(sum(${aiUsageEvents.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${aiUsageEvents.outputTokens}), 0)`,
      totalTokens: sql<number>`coalesce(sum(${aiUsageEvents.totalTokens}), 0)`,
      estimatedCostUsd: sql<number>`coalesce(sum(${aiUsageEvents.estimatedCostUsd}), 0)`,
    }).from(aiUsageEvents).where(and(
      eq(aiUsageEvents.orgId, orgId),
      eq(aiUsageEvents.feature, OCR_FEATURE_KEY),
      gte(aiUsageEvents.createdAt, monthStart()),
    )),
    db.query.aiUsageEvents.findMany({
      where: and(eq(aiUsageEvents.orgId, orgId), eq(aiUsageEvents.feature, OCR_FEATURE_KEY)),
      orderBy: (table, { desc }) => [desc(table.createdAt)],
      limit: 10,
    }),
  ]);
  return c.json({
    data: {
      feature: OCR_FEATURE_KEY,
      limits: {
        burstPerMinute: envNumber(c.env.OCR_BURST_LIMIT_PER_MINUTE, DEFAULT_OCR_BURST_LIMIT_PER_MINUTE),
        dailyRequests: envNumber(c.env.OCR_DAILY_LIMIT, DEFAULT_OCR_DAILY_LIMIT),
        monthlyEstimatedCostUsd: envNumber(c.env.OCR_MONTHLY_ESTIMATED_COST_LIMIT_USD, DEFAULT_OCR_MONTHLY_ESTIMATED_COST_LIMIT_USD),
      },
      today: today[0] || { requests: 0, totalTokens: 0, estimatedCostUsd: 0 },
      month: month[0] || { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCostUsd: 0 },
      recent,
    },
  });
});

invoicesApp.get('/imports/sender-rules', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const rules = await db.query.supplierInvoiceSenderRules.findMany({
    where: eq(supplierInvoiceSenderRules.orgId, orgId),
    orderBy: (table, { desc }) => [desc(table.updatedAt)],
    limit: 100,
  });
  return c.json({ data: rules });
});

invoicesApp.post('/imports/sender-rules', async (c) => {
  const idempotencyError = requireIdempotency(c);
  if (idempotencyError) return idempotencyError;
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const input = senderRuleSchema.parse(await c.req.json());
  const key = supplierKey(input.supplier);
  const email = input.senderEmail.toLowerCase();
  const existing = await db.query.supplierInvoiceSenderRules.findFirst({
    where: and(
      eq(supplierInvoiceSenderRules.orgId, orgId),
      eq(supplierInvoiceSenderRules.senderEmail, email),
      eq(supplierInvoiceSenderRules.supplierKey, key),
    ),
  });
  if (existing) {
    const [updated] = await db.update(supplierInvoiceSenderRules)
      .set({
        supplierName: input.supplier,
        autoStage: input.autoStage,
        isActive: input.isActive,
        updatedAt: new Date(),
      })
      .where(eq(supplierInvoiceSenderRules.id, existing.id))
      .returning();
    return c.json({ data: updated });
  }
  const [rule] = await db.insert(supplierInvoiceSenderRules).values({
    orgId,
    supplierKey: key,
    supplierName: input.supplier,
    senderEmail: email,
    autoStage: input.autoStage,
    isActive: input.isActive,
  }).returning();
  return c.json({ data: rule }, 201);
});

invoicesApp.get('/imports/:id/file', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const invoiceImport = await db.query.supplierInvoiceImports.findFirst({
    where: and(eq(supplierInvoiceImports.id, c.req.param('id')), eq(supplierInvoiceImports.orgId, orgId)),
  });
  if (!invoiceImport) return c.json({ error: 'Invoice import not found' }, 404);
  const data = invoiceImport.extractedData as { fileKey?: string; contentType?: string; fileName?: string } | null;
  if (!data?.fileKey || !c.env.R2) return c.json({ error: 'Original invoice file was not retained for this import' }, 404);
  const object = await c.env.R2.get(data.fileKey);
  if (!object) return c.json({ error: 'Invoice file is not available' }, 404);
  const headers = new Headers();
  headers.set('Content-Type', data.contentType || object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Content-Disposition', `inline; filename="${safeFileName(data.fileName || 'invoice')}"`);
  return new Response(object.body, { headers });
});

invoicesApp.post('/imports/:id/approve', async (c) => {
  const idempotencyError = requireIdempotency(c);
  if (idempotencyError) return idempotencyError;
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  if (!await ensurePremiumAccess(db, orgId, c.env)) {
    return c.json({ error: 'Supplier invoice automation is a premium feature.' }, 402);
  }
  const input = approveSchema.parse(await c.req.json());
  const invoiceImport = await db.query.supplierInvoiceImports.findFirst({
    where: and(eq(supplierInvoiceImports.id, c.req.param('id')), eq(supplierInvoiceImports.orgId, orgId)),
  });
  if (!invoiceImport) return c.json({ error: 'Invoice import not found' }, 404);
  if (invoiceImport.status !== 'needs_review') {
    const reviewedCopy: Record<string, string> = {
      approved: 'This supplier invoice was already approved and moved into Supplier purchases.',
      rejected: 'This supplier invoice was already rejected and removed from Needs review.',
      duplicate: 'This supplier invoice was marked as a duplicate and removed from Needs review.',
    };
    return c.json({
      error: reviewedCopy[invoiceImport.status] || 'This supplier invoice has already left Needs review. Refresh the page to see the latest status.',
      status: invoiceImport.status,
    }, 409);
  }

  const jobId = input.jobId || invoiceImport.jobId;
  if (!jobId) return c.json({ error: 'Select a job before approving this supplier invoice.' }, 400);
  const job = await db.query.jobs.findFirst({ where: and(eq(jobs.id, jobId), eq(jobs.orgId, orgId)) });
  if (!job) return c.json({ error: 'Selected job was not found' }, 404);

  let purchase: typeof materialPurchases.$inferSelect;
  try {
    purchase = await applyInvoiceImport(db, orgId, invoiceImport, jobId, input.applyMaterialUpdates);
  } catch (err) {
    if (err instanceof DuplicateSupplierInvoiceError) {
      const [updated] = await db.update(supplierInvoiceImports)
        .set({
          status: 'duplicate',
          reviewNotes: input.reviewNotes || err.message,
          duplicateOfImportId: err.invoiceImport?.id || null,
          materialPurchaseId: err.purchase?.id || null,
          updatedAt: new Date(),
        })
        .where(and(eq(supplierInvoiceImports.id, invoiceImport.id), eq(supplierInvoiceImports.orgId, orgId)))
        .returning();
      return c.json({
        error: err.message,
        duplicate: true,
        data: { import: updated, purchase: err.purchase || null, duplicateImport: err.invoiceImport || null },
      }, 409);
    }
    throw err;
  }
  const [updated] = await db.update(supplierInvoiceImports)
    .set({
      status: 'approved',
      jobId: jobId || null,
      materialPurchaseId: purchase.id,
      reviewNotes: input.reviewNotes || invoiceImport.reviewNotes,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(supplierInvoiceImports.id, invoiceImport.id), eq(supplierInvoiceImports.orgId, orgId)))
    .returning();

  await recordInvoiceImportFeedback(db, orgId, invoiceImport, 'approved', jobId || null, input.reviewNotes);

  return c.json({ data: { import: updated, purchase } });
});

invoicesApp.post('/imports/:id/reject', async (c) => {
  const idempotencyError = requireIdempotency(c);
  if (idempotencyError) return idempotencyError;
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  const input = rejectSchema.parse(await c.req.json());
  const invoiceImport = await db.query.supplierInvoiceImports.findFirst({
    where: and(eq(supplierInvoiceImports.id, c.req.param('id')), eq(supplierInvoiceImports.orgId, orgId)),
  });
  if (!invoiceImport || invoiceImport.status !== 'needs_review') return c.json({ error: 'Invoice import not found or already reviewed' }, 404);
  const [updated] = await db.update(supplierInvoiceImports)
    .set({
      status: 'rejected',
      reviewNotes: input.reviewNotes || null,
      rejectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(supplierInvoiceImports.id, c.req.param('id')),
      eq(supplierInvoiceImports.orgId, orgId),
      eq(supplierInvoiceImports.status, 'needs_review'),
    ))
    .returning();
  if (!updated) return c.json({ error: 'Invoice import not found or already reviewed' }, 404);
  await recordInvoiceImportFeedback(db, orgId, invoiceImport, 'rejected', null, input.reviewNotes);
  return c.json({ data: updated });
});

invoicesApp.post('/upload', async (c) => {
  const idempotencyError = requireIdempotency(c);
  if (idempotencyError) return idempotencyError;
  const orgId = c.get('orgId');
  const input = importSchema.parse(await c.req.json());
  const db = createDb(c.env.DATABASE_URL);
  const parsed = parseInvoicePayload(input);
  if (!parsed.items.length || !input.supplier) {
    return c.json({ error: 'CSV data and supplier required' }, 400);
  }

  const totalAmount = parsed.items.reduce((sum, item) => sum + item.total, 0);
  const invoiceCostDate = dateValue(input.invoiceDate) || new Date();
  const documentHash = await sha256Hex(normalizedDocumentText(input.csvData || input.rawText || JSON.stringify(parsed.items)));
  const existingPurchase = await db.query.materialPurchases.findFirst({
    where: input.invoiceNumber
      ? and(eq(materialPurchases.orgId, orgId), eq(materialPurchases.supplier, input.supplier), eq(materialPurchases.invoiceNumber, input.invoiceNumber))
      : and(eq(materialPurchases.orgId, orgId), eq(materialPurchases.documentHash, documentHash)),
  });
  if (existingPurchase) {
    return c.json({ error: 'This supplier invoice has already been imported.', duplicate: true, data: existingPurchase }, 409);
  }
  const [purchase] = await db.insert(materialPurchases).values({
    orgId,
    jobId: input.jobId || null,
    supplier: input.supplier,
    invoiceNumber: input.invoiceNumber || null,
    invoiceDate: invoiceCostDate,
    documentHash,
    totalAmount: totalAmount.toFixed(2),
    parsedData: parsed.items,
  }).returning();

  for (const item of parsed.items) {
    const material = await db.query.materials.findFirst({
      where: and(eq(materials.orgId, orgId), eq(materials.sku, item.sku || '')),
    });
    const unitCost = currencyValue(item.pricePerGallon || item.unitCost);
    if (material && Math.abs(currencyValue(material.costPerUnit) - unitCost) > 0.01) {
      await db.update(materials)
        .set({ costPerUnit: unitCost.toFixed(2), updatedAt: new Date() })
        .where(eq(materials.id, material.id));
    }

    if (input.jobId) {
      await db.insert(jobCosts).values({
        jobId: input.jobId,
        orgId,
        category: 'materials',
        description: item.description,
        quantity: item.quantity.toFixed(2),
        unitCost: unitCost.toFixed(2),
        totalCost: item.total.toFixed(2),
        materialPurchaseId: purchase.id,
        costDate: dateValue(item.purchaseDate) || invoiceCostDate,
      });
    }
  }

  return c.json({
    data: {
      purchaseId: purchase.id,
      itemsProcessed: parsed.items.length,
      totalAmount,
      items: parsed.items,
    },
  }, 201);
});

invoicesApp.get('/purchases', async (c) => {
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);

  const purchases = await db.query.materialPurchases.findMany({
    where: eq(materialPurchases.orgId, orgId),
    orderBy: (purchases, { desc }) => [desc(purchases.createdAt)],
    limit: 50,
  });

  return c.json({ data: purchases });
});

export default invoicesApp;
