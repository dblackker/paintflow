export interface PurchaseItem {
  description?: string;
  sku?: string;
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
  quantity?: number;
  unitCost?: number;
  total?: number;
  gallons?: number | null;
  pricePerGallon?: number | null;
  isFee?: boolean;
}

export interface MaterialPurchase {
  id: string;
  jobId?: string | null;
  supplier?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | string | null;
  parsedData?: PurchaseItem[] | null;
  fileUrl?: string | null;
  createdAt?: string | null;
  invoiceDate?: string | null;
}

export interface SupplierJob {
  id: string;
  name?: string | null;
  jobNumber?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  leadStreetAddress?: string | null;
  leadCity?: string | null;
  leadState?: string | null;
}

export interface InvoiceImport {
  id: string;
  jobId?: string | null;
  materialPurchaseId?: string | null;
  status: 'needs_review' | 'approved' | 'rejected' | 'duplicate';
  supplier?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  totalAmount?: number | string | null;
  extractedItems?: PurchaseItem[] | null;
  matchCandidates?: Array<{
    id: string;
    name: string;
    jobNumber?: string | null;
    streetAddress?: string | null;
    city?: string | null;
    state?: string | null;
    customerName?: string | null;
    confidence?: number;
    reasons?: string[];
  }> | null;
  matchConfidence?: number | string | null;
  extractionConfidence?: number | string | null;
  extractedData?: {
    fileKey?: string | null;
    fileName?: string | null;
    extractionMethod?: string | null;
    senderRuleMatched?: boolean;
    storedInR2?: boolean | null;
    fileRetentionStatus?: string | null;
    fileRetentionError?: string | null;
    possibleDuplicatePurchaseId?: string | null;
    documentReconciliation?: { required?: boolean; status?: string; lineTotal?: string; documentTotal?: string | null };
    warnings?: string[];
  } | null;
  sourceType?: string | null;
  senderEmail?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  createdAt?: string | null;
}

export function supplierDate(value?: string | null) {
  if (!value) return 'Date not detected';
  const civilDate = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const date = civilDate
    ? new Date(Number(civilDate[1]), Number(civilDate[2]) - 1, Number(civilDate[3]))
    : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date not detected' : date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

export function supplierJobLabel(job: SupplierJob) {
  const street = job.streetAddress || job.leadStreetAddress;
  const locality = [job.city || job.leadCity, job.state || job.leadState].filter(Boolean).join(', ');
  return [street, locality, job.jobNumber, job.name].filter(Boolean).join(' - ') || 'Unnamed job';
}

export function itemTitle(item: PurchaseItem) {
  return item.productName || item.description || item.sku || item.salesNumber || 'Material';
}

export function importFilePath(invoiceImport: InvoiceImport) {
  return invoiceImport.extractedData?.storedInR2 && invoiceImport.extractedData.fileKey
    ? `/v1/invoices/imports/${encodeURIComponent(invoiceImport.id)}/file`
    : '';
}
