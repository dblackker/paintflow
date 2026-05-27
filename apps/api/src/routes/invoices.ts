import { Hono } from 'hono';
import { z } from 'zod';
import { createDb } from '@paintflow/db';
import {
  jobCosts,
  jobs,
  leads,
  materialPurchases,
  materials,
  saasPlans,
  subscriptions,
  supplierInvoiceImportFeedback,
  supplierInvoiceImports,
  supplierInvoiceLearningStats,
} from '@paintflow/db/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Env, Variables } from '../types';
import { authMiddleware } from '../middleware/tenant';

const invoicesApp = new Hono<{ Bindings: Env; Variables: Variables }>();
invoicesApp.use('*', authMiddleware);

type InvoiceItem = {
  description: string;
  sku?: string | null;
  quantity: number;
  unitCost: number;
  total: number;
  category?: string;
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

const approveSchema = z.object({
  jobId: z.string().uuid().optional().nullable(),
  applyMaterialUpdates: z.boolean().default(true),
  reviewNotes: z.string().trim().optional().nullable(),
});

const rejectSchema = z.object({
  reviewNotes: z.string().trim().optional().nullable(),
});

type InvoiceImportRecord = typeof supplierInvoiceImports.$inferSelect;

function requireIdempotency(c: any) {
  const key = c.req.header('Idempotency-Key');
  if (!key) return c.json({ error: 'Idempotency-Key required' }, 400);
  return null;
}

function currencyValue(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampConfidence(value: number) {
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

function parseInvoicePayload(input: z.infer<typeof importSchema>) {
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

function inferCostCategory(description: string) {
  const text = normalizeText(description);
  if (/\b(labor|hours|crew)\b/.test(text)) return 'labor';
  if (/\b(ladder|sprayer|rental|equipment)\b/.test(text)) return 'equipment';
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

  const [purchase] = await db.insert(materialPurchases).values({
    orgId,
    jobId: jobId || null,
    supplier,
    invoiceNumber: invoiceImport.invoiceNumber || null,
    invoiceDate: invoiceImport.invoiceDate || null,
    totalAmount: totalAmount.toFixed(2),
    parsedData: items,
  }).returning();

  const existingMaterials = applyMaterialUpdates
    ? await db.query.materials.findMany({ where: eq(materials.orgId, orgId) })
    : [];

  for (const item of items) {
    const description = String(item.description || 'Supplier invoice item').slice(0, 255);
    if (applyMaterialUpdates) {
      const sku = String(item.sku || '').trim();
      const normalizedName = normalizeText(description);
      const material = existingMaterials.find((candidate) => (
        (sku && candidate.sku === sku)
        || (normalizeText(candidate.name) === normalizedName && normalizeText(candidate.supplier) === normalizeText(supplier))
      ));
      if (material) {
        await db.update(materials)
          .set({
            costPerUnit: currencyValue(item.unitCost).toFixed(2),
            supplier,
            sku: sku || material.sku,
            updatedAt: new Date(),
          })
          .where(and(eq(materials.id, material.id), eq(materials.orgId, orgId)));
      } else {
        await db.insert(materials).values({
          orgId,
          name: description,
          category: inferMaterialCategory(description),
          unit: inferUnit(description),
          costPerUnit: currencyValue(item.unitCost).toFixed(2),
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
        unitCost: currencyValue(item.unitCost).toFixed(2),
        totalCost: currencyValue(item.total || currencyValue(item.quantity || 1) * currencyValue(item.unitCost)).toFixed(2),
        materialPurchaseId: purchase.id,
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

invoicesApp.post('/imports', async (c) => {
  const idempotencyError = requireIdempotency(c);
  if (idempotencyError) return idempotencyError;
  const orgId = c.get('orgId');
  const db = createDb(c.env.DATABASE_URL);
  if (!await ensurePremiumAccess(db, orgId, c.env)) {
    return c.json({ error: 'Supplier invoice automation is a premium feature.' }, 402);
  }
  const input = importSchema.parse(await c.req.json());
  const parsed = parseInvoicePayload(input);
  if (!parsed.rawText?.trim()) return c.json({ error: 'Paste supplier invoice text or CSV data.' }, 400);
  if (!parsed.items.length) return c.json({ error: 'No invoice line items could be extracted.' }, 400);

  const matchCandidates = input.jobId
    ? []
    : await getJobCandidates(db, orgId, [parsed.rawText, input.supplier, input.invoiceNumber].filter(Boolean).join(' '));
  const bestMatch = input.jobId ? { id: input.jobId, confidence: 0.99 } : matchCandidates[0];
  const suggestedJobId = bestMatch && bestMatch.confidence >= 0.65 ? bestMatch.id : null;
  const extractedSupplier = input.supplier || String(parsed.extracted.supplier || '').trim() || null;
  const invoiceNumber = input.invoiceNumber || String(parsed.extracted.invoiceNumber || '').trim() || null;
  const totalAmount = parsed.items.reduce((sum, item) => sum + currencyValue(item.total), 0);

  const [invoiceImport] = await db.insert(supplierInvoiceImports).values({
    orgId,
    jobId: suggestedJobId,
    sourceType: input.sourceType,
    status: 'needs_review',
    supplier: extractedSupplier,
    invoiceNumber,
    invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : null,
    senderEmail: input.senderEmail || null,
    originalFilename: input.originalFilename || null,
    rawText: parsed.rawText,
    extractedData: {
      extractionMethod: input.csvData ? 'csv' : 'deterministic_text',
      extractedSupplier,
      invoiceNumber,
      source: input.sourceType,
    },
    extractedItems: parsed.items,
    totalAmount: totalAmount.toFixed(2),
    matchCandidates,
    matchConfidence: clampConfidence(bestMatch?.confidence || 0).toFixed(2),
    extractionConfidence: clampConfidence(parsed.confidence).toFixed(2),
  }).returning();

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
  if (invoiceImport.status !== 'needs_review') return c.json({ error: 'Invoice import has already been reviewed' }, 409);

  const jobId = input.jobId || invoiceImport.jobId;
  if (jobId) {
    const job = await db.query.jobs.findFirst({ where: and(eq(jobs.id, jobId), eq(jobs.orgId, orgId)) });
    if (!job) return c.json({ error: 'Selected job was not found' }, 404);
  }

  const purchase = await applyInvoiceImport(db, orgId, invoiceImport, jobId, input.applyMaterialUpdates);
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
  const [purchase] = await db.insert(materialPurchases).values({
    orgId,
    jobId: input.jobId || null,
    supplier: input.supplier,
    invoiceNumber: input.invoiceNumber || null,
    totalAmount: totalAmount.toFixed(2),
    parsedData: parsed.items,
  }).returning();

  for (const item of parsed.items) {
    const material = await db.query.materials.findFirst({
      where: and(eq(materials.orgId, orgId), eq(materials.sku, item.sku || '')),
    });
    if (material && Math.abs(currencyValue(material.costPerUnit) - item.unitCost) > 0.01) {
      await db.update(materials)
        .set({ costPerUnit: item.unitCost.toFixed(2), updatedAt: new Date() })
        .where(eq(materials.id, material.id));
    }

    if (input.jobId) {
      await db.insert(jobCosts).values({
        jobId: input.jobId,
        orgId,
        category: 'materials',
        description: item.description,
        quantity: item.quantity.toFixed(2),
        unitCost: item.unitCost.toFixed(2),
        totalCost: item.total.toFixed(2),
        materialPurchaseId: purchase.id,
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
