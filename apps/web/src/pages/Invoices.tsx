import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Input, Select, Textarea } from '@/components/Input';
import { API_URL, apiJson, formatAddress, formatMoney } from '@/lib/api';

interface PurchaseItem {
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

interface MaterialPurchase {
  id: string;
  supplier?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | string | null;
  parsedData?: PurchaseItem[] | null;
  fileUrl?: string | null;
  createdAt?: string | null;
  invoiceDate?: string | null;
}

type InvoiceImportStatus = 'needs_review' | 'approved' | 'rejected' | 'duplicate';

interface InvoiceImport {
  id: string;
  jobId?: string | null;
  status: InvoiceImportStatus;
  supplier?: string | null;
  invoiceNumber?: string | null;
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
    fileRetentionStatus?: 'stored' | 'not_configured' | 'failed' | string | null;
    fileRetentionError?: string | null;
  } | null;
  sourceType?: string | null;
  senderEmail?: string | null;
  createdAt?: string | null;
}

interface InvoiceSenderRule {
  id: string;
  supplierKey: string;
  supplierName?: string | null;
  senderEmail: string;
  autoStage?: boolean | null;
  isActive?: boolean | null;
}

interface InboundEmailConfig {
  enabled: boolean;
  domain: string;
  workspaceSlug: string;
  forwardingAddress: string;
  alternateAddress?: string | null;
  requiresTrustedSender: boolean;
}

interface InvoiceLearningStat {
  id: string;
  supplierKey: string;
  supplierName?: string | null;
  sourceType?: string | null;
  extractionMethod?: string | null;
  approvedCount?: number | string | null;
  rejectedCount?: number | string | null;
  correctedJobCount?: number | string | null;
  noJobApprovalCount?: number | string | null;
  avgMatchConfidence?: number | string | null;
  avgExtractionConfidence?: number | string | null;
  lastSeenAt?: string | null;
}

interface AiUsageSummary {
  limits?: {
    burstPerMinute?: number | string;
    dailyRequests?: number | string;
    monthlyEstimatedCostUsd?: number | string;
  };
  today?: {
    requests?: number | string;
    totalTokens?: number | string;
    estimatedCostUsd?: number | string;
  };
  month?: {
    requests?: number | string;
    inputTokens?: number | string;
    outputTokens?: number | string;
    totalTokens?: number | string;
    estimatedCostUsd?: number | string;
  };
  recent?: Array<{
    id: string;
    model?: string | null;
    totalTokens?: number | string | null;
    estimatedCostUsd?: number | string | null;
    createdAt?: string | null;
  }>;
}

interface Lead {
  id: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

interface Estimate {
  id: string;
  leadId: string;
  status?: string | null;
  total?: string | number | null;
  packages?: Array<{ name?: string; total?: string | number | null; subtotal?: string | number | null; tax?: string | number | null; items?: Array<{ qty?: number; rate?: number }>; lineItems?: Array<{ qty?: number; rate?: number }> }>;
  payments?: Payment[];
  signedAt?: string | null;
  sentAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  leadName?: string | null;
  leadEmail?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  customerPreviewUrl?: string | null;
}

interface Job {
  id: string;
  estimateId?: string | null;
  jobNumber?: string | null;
  name?: string | null;
  leadName?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  leadStreetAddress?: string | null;
  leadCity?: string | null;
  leadState?: string | null;
  leadPostalCode?: string | null;
}

interface ChangeOrder {
  id: string;
  estimateId?: string | null;
  jobId?: string | null;
  description?: string | null;
  amount?: string | number | null;
  paymentDueAmount?: string | number | null;
  paymentRequired?: boolean | null;
  paymentStatus?: string | null;
  status?: string | null;
  createdAt?: string | null;
  portalUrl?: string | null;
}

interface Payment {
  id: string;
  estimateId?: string | null;
  changeOrderId?: string | null;
  amount?: string | number | null;
  refundedAmount?: string | number | null;
  source?: string | null;
  status?: string | null;
  description?: string | null;
  receivedAt?: string | null;
}

interface PaymentMilestone {
  key?: string;
  label?: string;
  due?: string;
  percent?: number | string;
  payable?: boolean;
}

interface UploadFormState {
  supplier: string;
  invoiceNumber: string;
  jobId: string;
  senderEmail: string;
}

interface QuickInvoiceFormState {
  leadId: string;
  description: string;
  amount: string;
  tax: string;
  dueLabel: string;
  note: string;
}

interface PaymentFormState {
  amount: string;
  source: 'cash' | 'check' | 'ach' | 'other';
  reference: string;
  description: string;
}

type ReceivableKind = 'estimate' | 'change_order';

interface Receivable {
  id: string;
  kind: ReceivableKind;
  title: string;
  customerName: string;
  customerEmail?: string | null;
  status?: string | null;
  amount: number;
  paid: number;
  balance: number;
  createdAt?: string | null;
  dueLabel: string;
  href: string;
  previewHref?: string | null;
  jobHref?: string | null;
  address?: string;
  estimate?: Estimate;
  changeOrder?: ChangeOrder;
  usesPaymentSchedule?: boolean;
}

const emptyUploadForm: UploadFormState = {
  supplier: '',
  invoiceNumber: '',
  jobId: '',
  senderEmail: '',
};

const emptyQuickInvoiceForm: QuickInvoiceFormState = {
  leadId: '',
  description: '',
  amount: '',
  tax: '0',
  dueLabel: 'Due on receipt',
  note: '',
};

const emptyPaymentForm: PaymentFormState = {
  amount: '',
  source: 'check',
  reference: '',
  description: '',
};

const supplierOptions = [
  { value: '', label: 'Select supplier...' },
  { value: 'Sherwin-Williams', label: 'Sherwin-Williams' },
  { value: 'Benjamin Moore', label: 'Benjamin Moore' },
  { value: 'Home Depot', label: 'Home Depot' },
  { value: 'Lowes', label: 'Lowes' },
  { value: 'Other', label: 'Other' },
];

function formatDate(value?: string | null) {
  if (!value) return 'Not set';
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentValue(value: unknown) {
  const percent = Math.round(numberValue(value) * 100);
  return Number.isFinite(percent) ? percent : 0;
}

function formatAiCost(value: unknown) {
  const cost = numberValue(value);
  if (cost > 0 && cost < 0.01) return `$${cost.toFixed(4)}`;
  return formatMoney(cost);
}

function invoiceItemTitle(item: PurchaseItem) {
  return item.productName || item.description || item.sku || item.salesNumber || 'Material';
}

function invoiceItemDetails(item: PurchaseItem) {
  const details = [
    item.salesNumber ? `Sales ${item.salesNumber}` : '',
    item.productCode ? `Product ${item.productCode}` : '',
    item.sourceInvoiceNumber ? `Invoice ${item.sourceInvoiceNumber}` : '',
    item.poNumber ? `PO ${item.poNumber}` : '',
    item.colorName || '',
    item.colorCode ? `Color ${item.colorCode}` : '',
    item.gallons ? `${numberValue(item.gallons).toLocaleString()} gal` : '',
    item.pricePerGallon ? `${formatMoney(item.pricePerGallon)}/gal` : '',
  ].filter(Boolean);
  return details.join(' | ');
}

function netPayment(payment: Payment) {
  if (!['succeeded', 'paid', 'partially_refunded', 'refunded'].includes(String(payment.status || 'succeeded'))) return 0;
  return numberValue(payment.amount) - numberValue(payment.refundedAmount);
}

function estimateTotal(estimate: Estimate) {
  const packages = Array.isArray(estimate.packages) ? estimate.packages : [];
  const proposal = packages.find((pkg) => pkg.name === 'proposal') || packages.find((pkg) => /better|recommended|quick invoice/i.test(String(pkg.name))) || packages[0];
  if (proposal?.total) return numberValue(proposal.total);
  if (estimate.total) return numberValue(estimate.total);
  const items = proposal?.items || proposal?.lineItems || [];
  return items.reduce((sum, item) => sum + numberValue(item.qty || 1) * numberValue(item.rate), 0);
}

function paymentScheduleFor(total: number, paid: number, milestones: PaymentMilestone[]) {
  const source = milestones.length ? milestones : [
    { key: 'deposit', label: 'Deposit', due: 'Due after approval', percent: 40, payable: true },
    { key: 'progress', label: 'Progress payment', due: 'Due before production starts', percent: 30, payable: true },
    { key: 'final', label: 'Final balance', due: 'Due on completion', percent: 30, payable: true },
  ];
  let paidRemaining = paid;
  return source
    .filter((milestone) => numberValue(milestone.percent) > 0)
    .map((milestone) => {
      const amount = Math.round(total * (numberValue(milestone.percent) / 100) * 100) / 100;
      const paidAmount = Math.min(amount, Math.max(paidRemaining, 0));
      paidRemaining -= paidAmount;
      return {
        ...milestone,
        amount,
        paidAmount,
        balance: Math.max(amount - paidAmount, 0),
      };
    });
}

function jobAddress(job?: Job) {
  if (!job) return '';
  return formatAddress({
    streetAddress: job.streetAddress,
    city: job.city,
    state: job.state,
    postalCode: job.postalCode,
    leadStreetAddress: job.leadStreetAddress,
    leadCity: job.leadCity,
    leadState: job.leadState,
    leadPostalCode: job.leadPostalCode,
  });
}

function ReminderLink({ receivable }: { receivable: Receivable }) {
  const subject = encodeURIComponent(`Payment reminder for ${receivable.title}`);
  const body = encodeURIComponent(`Hi ${receivable.customerName},\n\nThis is a quick reminder that ${formatMoney(receivable.balance)} remains due for ${receivable.title}.${receivable.previewHref ? `\n\nYou can review the details here: ${window.location.origin}${receivable.previewHref}` : ''}\n\nThank you.`);
  return (
    <Button
      as="a"
      href={`mailto:${receivable.customerEmail || ''}?subject=${subject}&body=${body}`}
      variant="secondary"
      size="sm"
      leftIcon={<Icon name="mail" className="h-4 w-4" />}
      onClick={() => window.showToast?.('Reminder opened in your email client', 'success')}
    >
      Send reminder
    </Button>
  );
}

function PurchaseSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((item) => (
        <Card key={item} padding="sm" className="shadow-none">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="h-10 w-24 animate-pulse rounded bg-gray-100" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function PurchaseCard({ purchase }: { purchase: MaterialPurchase }) {
  const items = Array.isArray(purchase.parsedData) ? purchase.parsedData : [];
  const retainedFileHref = purchase.fileUrl ? `${API_URL}${purchase.fileUrl}` : '';
  return (
    <Card padding="sm">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <p className="pf-row-title">{purchase.supplier || 'Supplier invoice'}</p>
          <p className="pf-copy mt-1">
            Invoice {purchase.invoiceNumber || 'not set'} · {formatDate(purchase.invoiceDate || purchase.createdAt)}
          </p>
          {items.length > 0 && (
            <div className="mt-3 rounded-lg bg-gray-50 p-3">
              <p className="pf-meta">Parsed items</p>
              <div className="mt-2 space-y-1">
                {items.slice(0, 3).map((item, index) => (
                  <div key={`${item.description}-${index}`} className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate text-gray-700">{invoiceItemTitle(item)}</span>
                      {invoiceItemDetails(item) && <span className="block truncate text-xs text-gray-500">{invoiceItemDetails(item)}</span>}
                    </span>
                    <span className="shrink-0 font-medium text-gray-900">{formatMoney(item.total)}</span>
                  </div>
                ))}
                {items.length > 3 && <p className="pf-helper">+{items.length - 3} more items</p>}
              </div>
            </div>
          )}
          {retainedFileHref && (
            <div className="mt-3">
              <Button as="a" href={retainedFileHref} target="_blank" rel="noreferrer" variant="secondary" size="sm" leftIcon={<Icon name="file-text" className="h-4 w-4" />}>
                View source file
              </Button>
            </div>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-right">
          <p className="pf-section-title">{formatMoney(purchase.totalAmount)}</p>
          <p className="pf-meta">{items.length} item{items.length === 1 ? '' : 's'}</p>
        </div>
      </div>
    </Card>
  );
}

function LearningStatCard({ stat }: { stat: InvoiceLearningStat }) {
  const approved = numberValue(stat.approvedCount);
  const rejected = numberValue(stat.rejectedCount);
  const reviewed = approved + rejected;
  const approvalRate = reviewed ? Math.round((approved / reviewed) * 100) : 0;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="pf-row-title truncate">{stat.supplierName || stat.supplierKey}</p>
          <p className="pf-helper mt-1">{stat.extractionMethod || 'deterministic_text'} · {formatDate(stat.lastSeenAt)}</p>
        </div>
        <Badge variant={approvalRate >= 80 ? 'success' : approvalRate >= 50 ? 'warning' : 'default'} size="sm">
          {approvalRate}% approved
        </Badge>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded bg-gray-50 px-2 py-2">
          <p className="pf-metric-label">Reviews</p>
          <p className="pf-row-title">{reviewed}</p>
        </div>
        <div className="rounded bg-gray-50 px-2 py-2">
          <p className="pf-metric-label">Corrected</p>
          <p className="pf-row-title">{numberValue(stat.correctedJobCount)}</p>
        </div>
        <div className="rounded bg-gray-50 px-2 py-2">
          <p className="pf-metric-label">Match avg</p>
          <p className="pf-row-title">{percentValue(stat.avgMatchConfidence)}%</p>
        </div>
      </div>
    </div>
  );
}

function AiUsageCard({ usage }: { usage: AiUsageSummary }) {
  const monthRequests = numberValue(usage.month?.requests);
  const dailyLimit = numberValue(usage.limits?.dailyRequests);
  const monthlyCostLimit = numberValue(usage.limits?.monthlyEstimatedCostUsd);
  const monthlyCost = numberValue(usage.month?.estimatedCostUsd);
  const dailyRequests = numberValue(usage.today?.requests);
  const dailyPercent = dailyLimit ? Math.min(100, Math.round((dailyRequests / dailyLimit) * 100)) : 0;
  const costPercent = monthlyCostLimit ? Math.min(100, Math.round((monthlyCost / monthlyCostLimit) * 100)) : 0;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="pf-section-title">AI usage guardrails</p>
          <p className="pf-helper mt-1">OCR calls are throttled per contractor and tracked for estimated OpenAI spend.</p>
        </div>
        <Badge variant="info" size="sm">Cost controls</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="pf-metric-label">Today</p>
          <p className="pf-row-title">{dailyRequests} / {dailyLimit || '-'}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full rounded-full bg-blue-600" style={{ width: `${dailyPercent}%` }} />
          </div>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="pf-metric-label">This month</p>
          <p className="pf-row-title">{monthRequests} OCR run{monthRequests === 1 ? '' : 's'}</p>
          <p className="pf-helper mt-1">{numberValue(usage.month?.totalTokens).toLocaleString()} tokens</p>
        </div>
        <div className="rounded-lg bg-gray-50 p-3">
          <p className="pf-metric-label">Estimated cost</p>
          <p className="pf-row-title">{formatAiCost(monthlyCost)} / {formatAiCost(monthlyCostLimit)}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full rounded-full bg-emerald-600" style={{ width: `${costPercent}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function jobOptionLabel(job?: Job) {
  if (!job) return 'Select job...';
  const address = jobAddress(job);
  return [job.jobNumber, job.name, address].filter(Boolean).join(' - ');
}

function supplierRuleKey(value?: string | null) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '_') || 'unknown_supplier';
}

function ImportReviewCard({
  invoiceImport,
  jobs,
  senderRules,
  selectedJobId,
  onSelectJob,
  onApprove,
  onReject,
  onTrustSender,
  isBusy,
}: {
  invoiceImport: InvoiceImport;
  jobs: Job[];
  senderRules: InvoiceSenderRule[];
  selectedJobId: string;
  onSelectJob: (jobId: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onTrustSender: () => void;
  isBusy: boolean;
}) {
  const items = Array.isArray(invoiceImport.extractedItems) ? invoiceImport.extractedItems : [];
  const selectedJob = jobs.find((job) => job.id === selectedJobId);
  const candidate = invoiceImport.matchCandidates?.[0];
  const canApprove = Boolean(selectedJobId);
  const matchConfidence = percentValue(invoiceImport.matchConfidence);
  const extractionConfidence = percentValue(invoiceImport.extractionConfidence);
  const fileRetained = Boolean(invoiceImport.extractedData?.storedInR2 && invoiceImport.extractedData?.fileKey);
  const fileRetentionStatus = invoiceImport.extractedData?.fileRetentionStatus;
  const fileHref = fileRetained ? `${API_URL}/v1/invoices/imports/${invoiceImport.id}/file` : '';
  const trustedSender = Boolean(invoiceImport.extractedData?.senderRuleMatched)
    || senderRules.some((rule) => (
      rule.isActive !== false
      && rule.senderEmail.toLowerCase() === String(invoiceImport.senderEmail || '').toLowerCase()
      && rule.supplierKey === supplierRuleKey(invoiceImport.supplier)
    ));
  return (
    <Card padding="sm" className="border-amber-200 bg-amber-50/40 shadow-none">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="warning" size="sm">Needs review</Badge>
            <Badge variant="purple" size="sm">Premium</Badge>
            <span className="pf-meta">{formatDate(invoiceImport.createdAt)}</span>
          </div>
          <p className="pf-row-title mt-2">{invoiceImport.supplier || 'Supplier invoice'}</p>
          <p className="pf-copy mt-1">
            Invoice {invoiceImport.invoiceNumber || 'not detected'} · {items.length} item{items.length === 1 ? '' : 's'} · {formatMoney(invoiceImport.totalAmount)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {invoiceImport.extractedData?.extractionMethod && (
              <Badge variant="info" size="sm">{invoiceImport.extractedData.extractionMethod.replace(/_/g, ' ')}</Badge>
            )}
            {fileRetained && <Badge variant="success" size="sm">File retained</Badge>}
            {!fileRetained && fileRetentionStatus === 'failed' && (
              <Badge variant="warning" size="sm">File not retained</Badge>
            )}
            {!fileRetained && fileRetentionStatus === 'not_configured' && (
              <Badge variant="default" size="sm">OCR only</Badge>
            )}
            {invoiceImport.senderEmail && (
              <Badge variant={trustedSender ? 'success' : 'default'} size="sm">
                {trustedSender ? 'Trusted sender' : invoiceImport.senderEmail}
              </Badge>
            )}
            {fileHref && (
              <Button as="a" href={fileHref} target="_blank" rel="noreferrer" variant="ghost" size="sm" leftIcon={<Icon name="file-text" className="h-4 w-4" />}>
                View file
              </Button>
            )}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg bg-white p-3">
              <p className="pf-meta">Extraction confidence</p>
              <p className="pf-row-title">{extractionConfidence}%</p>
            </div>
            <div className="rounded-lg bg-white p-3">
              <p className="pf-meta">Job match</p>
              <p className="pf-row-title">{selectedJob ? jobOptionLabel(selectedJob) : candidate ? `${candidate.name} (${matchConfidence}%)` : 'Needs assignment'}</p>
            </div>
          </div>
          {items.length > 0 && (
            <div className="mt-3 rounded-lg bg-white p-3">
              <p className="pf-meta">Extracted lines</p>
              <div className="mt-2 space-y-1">
                {items.slice(0, 4).map((item, index) => (
                  <div key={`${invoiceImport.id}-${index}`} className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate text-gray-700">{invoiceItemTitle(item)}</span>
                      {invoiceItemDetails(item) && <span className="block truncate text-xs text-gray-500">{invoiceItemDetails(item)}</span>}
                    </span>
                    <span className="shrink-0 font-medium text-gray-900">{formatMoney(item.total)}</span>
                  </div>
                ))}
                {items.length > 4 && <p className="pf-helper">+{items.length - 4} more lines</p>}
              </div>
            </div>
          )}
        </div>
        <div className="space-y-3">
          <Select label="Assign job" value={selectedJobId} onChange={(event) => onSelectJob(event.target.value)}>
            <option value="">Select job...</option>
            {jobs.map((job) => <option key={job.id} value={job.id}>{jobOptionLabel(job)}</option>)}
          </Select>
          {!canApprove && (
            <p className="pf-helper rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
              A job is required so approved supplier costs are posted to the right project.
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row lg:flex-col">
            {invoiceImport.senderEmail && invoiceImport.supplier && !trustedSender && (
              <Button type="button" variant="secondary" size="sm" fullWidth onClick={onTrustSender} disabled={isBusy}>
                Trust sender
              </Button>
            )}
            <Button type="button" size="sm" fullWidth onClick={onApprove} isLoading={isBusy} disabled={!canApprove || isBusy}>
              Approve import
            </Button>
            <Button type="button" variant="dangerSubtle" size="sm" fullWidth onClick={onReject} disabled={isBusy}>
              Reject
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ReceivableCard({ receivable, milestones, onRecordPayment }: { receivable: Receivable; milestones: PaymentMilestone[]; onRecordPayment: (receivable: Receivable) => void }) {
  const schedule = receivable.usesPaymentSchedule
    ? paymentScheduleFor(receivable.amount, receivable.paid, milestones)
    : [];
  const nextMilestone = schedule.find((item) => item.balance > 0.005 && item.payable !== false);
  return (
    <Card padding="sm">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={receivable.kind === 'estimate' ? 'info' : 'purple'} size="sm">
              {receivable.kind === 'estimate' ? 'Estimate' : 'Change order'}
            </Badge>
            <StatusBadge status={receivable.status || 'pending'} />
          </div>
          <Link to={receivable.href} className="mt-2 block truncate pf-row-title hover:text-blue-700">
            {receivable.title}
          </Link>
          <p className="pf-copy mt-1">{receivable.customerName}</p>
          {receivable.address && <p className="pf-helper mt-1">{receivable.address}</p>}
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="pf-metric-label">Total</p>
              <p className="pf-row-title">{formatMoney(receivable.amount)}</p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2">
              <p className="pf-metric-label">Paid</p>
              <p className="pf-row-title">{formatMoney(receivable.paid)}</p>
            </div>
            <div className="rounded-lg bg-amber-50 px-3 py-2">
              <p className="pf-metric-label text-amber-800">Balance</p>
              <p className="pf-row-title text-amber-950">{formatMoney(receivable.balance)}</p>
            </div>
          </div>
          {schedule.length > 0 && (
            <div className="mt-3 rounded-lg border border-gray-200 p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="pf-meta">Payment schedule</p>
                {nextMilestone && <Badge variant="warning" size="sm">{nextMilestone.label || 'Next payment'} due</Badge>}
              </div>
              <div className="space-y-2">
                {schedule.map((item) => (
                  <div key={item.key || item.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-900">{item.label || 'Payment'}</p>
                      <p className="pf-helper">{item.due || 'Due per agreement'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-950">{formatMoney(item.amount)}</p>
                      <p className={item.balance > 0.005 ? 'text-xs text-amber-700' : 'text-xs text-green-700'}>
                        {item.balance > 0.005 ? `${formatMoney(item.balance)} open` : 'Paid'}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row lg:w-44 lg:flex-col">
          <Button as="a" href={receivable.previewHref || receivable.href} variant="secondary" size="sm" fullWidth>
            View details
          </Button>
          {receivable.kind === 'estimate' && (
            <Button type="button" variant="secondary" size="sm" fullWidth onClick={() => onRecordPayment(receivable)}>
              Record payment
            </Button>
          )}
          <ReminderLink receivable={receivable} />
        </div>
      </div>
    </Card>
  );
}

export function Invoices() {
  const navigate = useNavigate();
  const [purchases, setPurchases] = useState<MaterialPurchase[]>([]);
  const [invoiceImports, setInvoiceImports] = useState<InvoiceImport[]>([]);
  const [learningStats, setLearningStats] = useState<InvoiceLearningStat[]>([]);
  const [aiUsage, setAiUsage] = useState<AiUsageSummary | null>(null);
  const [inboundEmailConfig, setInboundEmailConfig] = useState<InboundEmailConfig | null>(null);
  const [senderRules, setSenderRules] = useState<InvoiceSenderRule[]>([]);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [milestones, setMilestones] = useState<PaymentMilestone[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [mode, setMode] = useState<'receivables' | 'supplier'>('receivables');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [quickInvoiceOpen, setQuickInvoiceOpen] = useState(false);
  const [paymentReceivable, setPaymentReceivable] = useState<Receivable | null>(null);
  const [form, setForm] = useState<UploadFormState>(emptyUploadForm);
  const [quickInvoiceForm, setQuickInvoiceForm] = useState<QuickInvoiceFormState>(emptyQuickInvoiceForm);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>(emptyPaymentForm);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);
  const [reviewJobByImport, setReviewJobByImport] = useState<Record<string, string>>({});
  const [busyImportId, setBusyImportId] = useState('');
  const [selectedInvoiceFile, setSelectedInvoiceFile] = useState<File | null>(null);

  const jobsByEstimateId = useMemo(() => new Map(jobs.filter((job) => job.estimateId).map((job) => [job.estimateId as string, job])), [jobs]);
  const jobsById = useMemo(() => new Map(jobs.map((job) => [job.id, job])), [jobs]);
  const paymentsByChangeOrder = useMemo(() => {
    const map = new Map<string, Payment[]>();
    payments.forEach((payment) => {
      if (!payment.changeOrderId) return;
      const rows = map.get(payment.changeOrderId) || [];
      rows.push(payment);
      map.set(payment.changeOrderId, rows);
    });
    return map;
  }, [payments]);

  const receivables = useMemo(() => {
    const estimateReceivables = estimates
      .filter((estimate) => {
        const isQuickInvoice = estimate.packages?.some((pkg) => /quick invoice/i.test(String(pkg.name)));
        const isSignedAgreement = estimate.status === 'accepted' || Boolean(estimate.signedAt);
        return (isQuickInvoice || isSignedAgreement) && !['draft', 'declined', 'canceled', 'voided', 'superseded'].includes(String(estimate.status || ''));
      })
      .map((estimate) => {
        const amount = estimateTotal(estimate);
        const paid = (estimate.payments || []).reduce((sum, payment) => sum + netPayment(payment), 0);
        const balance = Math.max(amount - paid, 0);
        const job = jobsByEstimateId.get(estimate.id);
        const isQuickInvoice = estimate.packages?.some((pkg) => /quick invoice/i.test(String(pkg.name)));
        return {
          id: estimate.id,
          kind: 'estimate' as ReceivableKind,
          title: isQuickInvoice ? 'Quick invoice' : `Estimate ${estimate.id.slice(0, 8)}`,
          customerName: estimate.leadName || 'Customer',
          customerEmail: estimate.leadEmail,
          status: estimate.status,
          amount,
          paid,
          balance,
          createdAt: estimate.sentAt || estimate.createdAt,
          dueLabel: isQuickInvoice ? 'Due on receipt' : 'Per payment schedule',
          href: `/estimates/${estimate.id}/details`,
          previewHref: estimate.customerPreviewUrl || `/estimates/${estimate.id}`,
          jobHref: job ? `/jobs/${job.id}` : null,
          address: formatAddress(estimate).replace(/\s+\d{5}$/, ''),
          estimate,
          usesPaymentSchedule: !isQuickInvoice,
        };
      })
      .filter((item) => item.balance > 0.005);

    const changeOrderReceivables = changeOrders
      .filter((order) => order.paymentRequired && !['paid', 'waived'].includes(String(order.paymentStatus || '')) && !['canceled', 'rejected'].includes(String(order.status || '')))
      .map((order) => {
        const amount = numberValue(order.paymentDueAmount || order.amount);
        const paid = (paymentsByChangeOrder.get(order.id) || []).reduce((sum, payment) => sum + netPayment(payment), 0);
        const balance = Math.max(amount - paid, 0);
        const job = order.jobId ? jobsById.get(order.jobId) : undefined;
        return {
          id: order.id,
          kind: 'change_order' as ReceivableKind,
          title: `Change order ${order.id.slice(0, 8)}`,
          customerName: job?.leadName || 'Customer',
          customerEmail: null,
          status: order.paymentStatus || order.status,
          amount,
          paid,
          balance,
          createdAt: order.createdAt,
          dueLabel: 'Due after approval',
          href: job ? `/jobs/${job.id}` : '/jobs',
          previewHref: order.portalUrl || (job ? `/jobs/${job.id}` : null),
          jobHref: job ? `/jobs/${job.id}` : null,
          address: jobAddress(job),
          changeOrder: order,
          usesPaymentSchedule: true,
        };
      })
      .filter((item) => item.balance > 0.005);

    return [...estimateReceivables, ...changeOrderReceivables]
      .sort((a, b) => b.balance - a.balance);
  }, [changeOrders, estimates, jobsByEstimateId, jobsById, paymentsByChangeOrder]);

  const totalReceivable = useMemo(() => receivables.reduce((sum, item) => sum + item.balance, 0), [receivables]);
  const totalSpend = useMemo(
    () => purchases.reduce((sum, purchase) => sum + numberValue(purchase.totalAmount), 0),
    [purchases],
  );
  useEffect(() => {
    loadInvoices();
  }, []);

  useEffect(() => {
    document.body.classList.toggle('pf-modal-open', uploadModalOpen || quickInvoiceOpen || Boolean(paymentReceivable));
    return () => document.body.classList.remove('pf-modal-open');
  }, [paymentReceivable, uploadModalOpen, quickInvoiceOpen]);

  async function loadInvoices() {
    setIsLoading(true);
    setError('');
    try {
      const [purchasePayload, importPayload, learningPayload, usagePayload, inboundEmailPayload, senderRulesPayload, estimatesPayload, jobsPayload, changeOrdersPayload, paymentsPayload, leadsPayload, schedulePayload] = await Promise.all([
        apiJson<{ data?: MaterialPurchase[] }>('/v1/invoices/purchases').catch(() => ({ data: [] })),
        apiJson<{ data?: InvoiceImport[] }>('/v1/invoices/imports?status=needs_review').catch(() => ({ data: [] })),
        apiJson<{ data?: { stats?: InvoiceLearningStat[] } }>('/v1/invoices/imports/learning').catch(() => ({ data: { stats: [] } })),
        apiJson<{ data?: AiUsageSummary }>('/v1/invoices/imports/ai-usage').catch(() => ({ data: null })),
        apiJson<{ data?: InboundEmailConfig }>('/v1/invoices/inbound-email-config').catch(() => ({ data: null })),
        apiJson<{ data?: InvoiceSenderRule[] }>('/v1/invoices/imports/sender-rules').catch(() => ({ data: [] })),
        apiJson<{ data?: Estimate[] }>('/v1/estimates?limit=100'),
        apiJson<{ data?: Job[] }>('/v1/jobs').catch(() => ({ data: [] })),
        apiJson<{ data?: ChangeOrder[] }>('/v1/change-orders').catch(() => ({ data: [] })),
        apiJson<{ data?: Payment[] }>('/v1/payments/history').catch(() => ({ data: [] })),
        apiJson<{ data?: Lead[] }>('/v1/leads?limit=200').catch(() => ({ data: [] })),
        apiJson<{ data?: { milestones?: PaymentMilestone[] } }>('/v1/settings/payment-schedule').catch(() => ({ data: { milestones: [] } })),
      ]);
      setPurchases(purchasePayload.data || []);
      setInvoiceImports(importPayload.data || []);
      setLearningStats(learningPayload.data?.stats || []);
      setAiUsage(usagePayload.data || null);
      setInboundEmailConfig(inboundEmailPayload.data || null);
      setSenderRules(senderRulesPayload.data || []);
      setReviewJobByImport(Object.fromEntries((importPayload.data || []).map((item) => [item.id, item.jobId || item.matchCandidates?.[0]?.id || ''])));
      setEstimates(estimatesPayload.data || []);
      setJobs(jobsPayload.data || []);
      setChangeOrders(changeOrdersPayload.data || []);
      setPayments(paymentsPayload.data || []);
      setLeads(leadsPayload.data || []);
      setMilestones(schedulePayload.data?.milestones || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoices');
    } finally {
      setIsLoading(false);
    }
  }

  function openUploadModal() {
    setForm(emptyUploadForm);
    setSelectedInvoiceFile(null);
    setUploadModalOpen(true);
  }

  function closeUploadModal() {
    if (isUploading) return;
    setUploadModalOpen(false);
  }

  function openQuickInvoiceModal() {
    setQuickInvoiceForm(emptyQuickInvoiceForm);
    setQuickInvoiceOpen(true);
  }

  function closeQuickInvoiceModal() {
    if (isCreatingInvoice) return;
    setQuickInvoiceOpen(false);
  }

  function openPaymentModal(receivable: Receivable) {
    setPaymentReceivable(receivable);
    setPaymentForm({
      ...emptyPaymentForm,
      amount: receivable.balance.toFixed(2),
      description: `${receivable.title} payment`,
    });
  }

  function closePaymentModal() {
    if (isRecordingPayment) return;
    setPaymentReceivable(null);
  }

  async function uploadInvoice(event: FormEvent) {
    event.preventDefault();
    const fileToUpload = selectedInvoiceFile;
    if (!fileToUpload) {
      window.showToast?.('Upload a supplier invoice first.', 'error');
      return;
    }
    setIsUploading(true);
    try {
      const body = new FormData();
      body.set('file', fileToUpload);
      body.set('supplier', form.supplier || '');
      body.set('invoiceNumber', form.invoiceNumber || '');
      body.set('senderEmail', form.senderEmail || '');
      body.set('jobId', form.jobId || '');
      const payload = await apiJson<{ data?: InvoiceImport }>('/v1/invoices/imports', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
        body,
      });
      window.showToast?.(
        `Invoice ready for review: ${formatMoney(payload.data?.totalAmount)}`,
        'success',
      );
      setUploadModalOpen(false);
      await loadInvoices();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Import failed', 'error');
      await loadInvoices();
    } finally {
      setIsUploading(false);
    }
  }

  async function approveImport(invoiceImport: InvoiceImport) {
    const jobId = reviewJobByImport[invoiceImport.id] || invoiceImport.jobId || '';
    if (!jobId) {
      window.showToast?.('Select a job before approving this supplier invoice.', 'error');
      return;
    }
    setBusyImportId(invoiceImport.id);
    try {
      await apiJson(`/v1/invoices/imports/${invoiceImport.id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          jobId,
          applyMaterialUpdates: true,
        }),
      });
      window.showToast?.('Supplier invoice approved', 'success');
      await loadInvoices();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to approve import', 'error');
      await loadInvoices();
    } finally {
      setBusyImportId('');
    }
  }

  async function rejectImport(invoiceImport: InvoiceImport) {
    setBusyImportId(invoiceImport.id);
    try {
      await apiJson(`/v1/invoices/imports/${invoiceImport.id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ reviewNotes: 'Rejected from invoice review queue.' }),
      });
      window.showToast?.('Supplier invoice rejected', 'success');
      await loadInvoices();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to reject import', 'error');
    } finally {
      setBusyImportId('');
    }
  }

  async function trustInvoiceSender(invoiceImport: InvoiceImport) {
    if (!invoiceImport.senderEmail || !invoiceImport.supplier) return;
    setBusyImportId(invoiceImport.id);
    try {
      await apiJson('/v1/invoices/imports/sender-rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          supplier: invoiceImport.supplier,
          senderEmail: invoiceImport.senderEmail,
          autoStage: true,
          isActive: true,
        }),
      });
      window.showToast?.('Supplier sender trusted', 'success');
      await loadInvoices();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to trust sender', 'error');
    } finally {
      setBusyImportId('');
    }
  }

  async function createQuickInvoice(event: FormEvent) {
    event.preventDefault();
    const amount = numberValue(quickInvoiceForm.amount);
    const tax = numberValue(quickInvoiceForm.tax);
    if (!quickInvoiceForm.leadId || amount <= 0) {
      window.showToast?.('Select a customer and enter a positive amount.', 'error');
      return;
    }
    const lead = leads.find((item) => item.id === quickInvoiceForm.leadId);
    setIsCreatingInvoice(true);
    try {
      const response = await apiJson<{ data?: Estimate }>('/v1/estimates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          leadId: quickInvoiceForm.leadId,
          status: 'sent',
          streetAddress: lead?.streetAddress || undefined,
          city: lead?.city || undefined,
          state: lead?.state || undefined,
          postalCode: lead?.postalCode || undefined,
          packages: [{
            name: 'Quick invoice',
            subtotal: amount,
            tax,
            total: amount + tax,
            items: [{
              desc: quickInvoiceForm.description || 'Painting services',
              qty: 1,
              rate: amount,
              category: 'invoice',
              notes: [quickInvoiceForm.dueLabel, quickInvoiceForm.note].filter(Boolean).join(' - '),
              customerVisible: true,
            }],
          }],
        }),
      });
      window.showToast?.('Quick invoice created', 'success');
      setQuickInvoiceOpen(false);
      await loadInvoices();
      if (response.data?.id) navigate(`/estimates/${response.data.id}/details`);
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to create invoice', 'error');
    } finally {
      setIsCreatingInvoice(false);
    }
  }

  async function recordPayment(event: FormEvent) {
    event.preventDefault();
    if (!paymentReceivable?.estimate?.id) return;
    const amount = numberValue(paymentForm.amount);
    if (amount <= 0 || amount > paymentReceivable.balance + 0.005) {
      window.showToast?.(`Payment must be between $0.01 and ${formatMoney(paymentReceivable.balance)}.`, 'error');
      return;
    }
    const confirmAdditionalPayment = paymentReceivable.paid > 0.005;
    if (confirmAdditionalPayment && !window.confirm(`This customer already has ${formatMoney(paymentReceivable.paid)} recorded. Confirm this is an additional payment and not a duplicate.`)) return;
    setIsRecordingPayment(true);
    try {
      await apiJson('/v1/payments/manual', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          estimateId: paymentReceivable.estimate.id,
          amount,
          source: paymentForm.source,
          reference: paymentForm.reference || null,
          description: paymentForm.description || null,
          confirmAdditionalPayment,
        }),
      });
      window.showToast?.('Payment recorded', 'success');
      setPaymentReceivable(null);
      await loadInvoices();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to record payment', 'error');
    } finally {
      setIsRecordingPayment(false);
    }
  }

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-1 pb-24 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="pf-page-copy max-w-3xl">
            Collect deposits, progress payments, final balances, and simple one-off invoices without creating a second billing workflow.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button type="button" size="sm" leftIcon={<Icon name="plus" className="h-4 w-4" />} onClick={openQuickInvoiceModal}>
            Create invoice
          </Button>
          <Button type="button" size="sm" variant="secondary" leftIcon={<Icon name="file-text" className="h-4 w-4" />} onClick={openUploadModal}>
            Supplier invoice
          </Button>
        </div>
      </div>

      <Card padding="sm" className="border-blue-200 bg-blue-50">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div>
            <p className="pf-row-title text-blue-950">Recommended workflow</p>
            <p className="pf-copy mt-1 text-blue-900">
              Use estimates and change orders as the source of truth. Quick invoices are for one-off work, legacy jobs, or emergency billing when the full estimate flow was skipped.
            </p>
          </div>
          <Link to="/settings#business-settings" className="btn-tonal btn-sm justify-center">Review payment schedule</Link>
        </div>
      </Card>

      <div className="pf-segmented-group w-full sm:w-fit" aria-label="Invoice view">
        <button type="button" aria-pressed={mode === 'receivables'} onClick={() => setMode('receivables')}>Customer balances</button>
        <button type="button" aria-pressed={mode === 'supplier'} onClick={() => setMode('supplier')}>Supplier purchases</button>
      </div>

      {mode === 'receivables' ? (
        <>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Card padding="sm" className="shadow-none">
              <p className="pf-meta">Open items</p>
              <p className="pf-metric mt-1">{receivables.length}</p>
            </Card>
            <Card padding="sm" className="shadow-none">
              <p className="pf-meta">Receivable</p>
              <p className="pf-metric mt-1">{formatMoney(totalReceivable)}</p>
            </Card>
            <Card padding="sm" className="shadow-none">
              <p className="pf-meta">Customers</p>
              <p className="pf-metric mt-1">{new Set(receivables.map((item) => item.customerName)).size}</p>
            </Card>
          </div>

          <Card padding="none">
            <CardHeader
              className="mb-0 border-b border-gray-200 px-4 py-3 sm:px-5"
              title="Payment collection"
              description="Accepted estimates, payment schedules, quick invoices, and payable change orders with an open balance."
            />
            <CardContent className="p-4">
              {isLoading && <PurchaseSkeleton />}
              {!isLoading && error && (
                <div className="p-8 text-center">
                  <Icon name="warning" className="mx-auto h-6 w-6 text-red-600" />
                  <p className="pf-copy mt-2 text-red-700">{error}</p>
                  <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={loadInvoices}>Retry</Button>
                </div>
              )}
              {!isLoading && !error && !receivables.length && (
                <EmptyState
                  icon={<Icon name="credit-card" className="h-5 w-5" />}
                  title="No customer balances right now."
                  description="Accepted estimates, change orders, and quick invoices with unpaid balances will appear here."
                  action={{ label: 'Create invoice', onClick: openQuickInvoiceModal }}
                />
              )}
              {!isLoading && !error && receivables.length > 0 && (
                <div className="space-y-3">
                  {receivables.map((receivable) => (
                    <ReceivableCard key={`${receivable.kind}-${receivable.id}`} receivable={receivable} milestones={milestones} onRecordPayment={openPaymentModal} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <Card padding="sm" className="shadow-none">
              <p className="pf-meta">Invoices</p>
              <p className="pf-metric mt-1">{purchases.length}</p>
            </Card>
            <Card padding="sm" className="shadow-none">
              <p className="pf-meta">Pending</p>
              <p className="pf-metric mt-1">{invoiceImports.length}</p>
            </Card>
            <Card padding="sm" className="shadow-none">
              <p className="pf-meta">Spend</p>
              <p className="pf-metric mt-1">{formatMoney(totalSpend)}</p>
            </Card>
          </div>

          {!isLoading && !error && aiUsage && <AiUsageCard usage={aiUsage} />}

          <Card padding="sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="pf-section-title">Forward supplier receipts</p>
                  <Badge variant="purple" size="sm">Premium</Badge>
                  <Badge variant={inboundEmailConfig?.enabled ? 'success' : 'warning'} size="sm">
                    {inboundEmailConfig?.enabled ? 'Configured' : 'Needs Worker secret'}
                  </Badge>
                </div>
                <p className="pf-helper mt-1">
                  Forwarded supplier emails are accepted only from trusted sender addresses, then staged here for review before they update job costs.
                </p>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={openUploadModal}>
                Manage sender
              </Button>
            </div>
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <p className="pf-meta">Forwarding address</p>
              <p className="pf-copy mt-1 break-all font-mono text-xs">
                {inboundEmailConfig?.forwardingAddress || 'receipts+workspace-slug@receipts.paintflow.app'}
              </p>
              {inboundEmailConfig?.alternateAddress && (
                <p className="pf-helper mt-1 break-all">
                  Alternate catch-all route: <span className="font-mono text-xs">{inboundEmailConfig.alternateAddress}</span>
                </p>
              )}
            </div>
          </Card>

          <Card padding="none">
            <CardHeader
              className="mb-0 border-b border-gray-200 px-4 py-3 sm:px-5"
              title="Supplier purchases"
              description="Review supplier invoices before they update material pricing or job costs."
            />
            <CardContent className="p-4">
              {isLoading && <PurchaseSkeleton />}
              {!isLoading && error && (
                <div className="p-8 text-center">
                  <Icon name="warning" className="mx-auto h-6 w-6 text-red-600" />
                  <p className="pf-copy mt-2 text-red-700">{error}</p>
                  <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={loadInvoices}>Retry</Button>
                </div>
              )}
              {!isLoading && !error && invoiceImports.length > 0 && (
                <div className="mb-5 space-y-3">
                  <div>
                    <p className="pf-section-title">Needs review</p>
                    <p className="pf-helper mt-1">Approve only after the job match and extracted lines look right.</p>
                  </div>
                  {invoiceImports.map((invoiceImport) => (
                    <ImportReviewCard
                      key={invoiceImport.id}
                      invoiceImport={invoiceImport}
                      jobs={jobs}
                      senderRules={senderRules}
                      selectedJobId={reviewJobByImport[invoiceImport.id] || invoiceImport.jobId || ''}
                      onSelectJob={(jobId) => setReviewJobByImport({ ...reviewJobByImport, [invoiceImport.id]: jobId })}
                      onApprove={() => approveImport(invoiceImport)}
                      onReject={() => rejectImport(invoiceImport)}
                      onTrustSender={() => trustInvoiceSender(invoiceImport)}
                      isBusy={busyImportId === invoiceImport.id}
                    />
                  ))}
                </div>
              )}
              {!isLoading && !error && !purchases.length && (
                <EmptyState
                  icon={<Icon name="file-text" className="h-5 w-5" />}
                  title="No supplier invoices uploaded yet."
                  description="Upload a supplier invoice and PaintFlow will stage extracted material costs for review before they hit a job."
                  action={{ label: 'Review invoice', onClick: openUploadModal }}
                />
              )}
              {!isLoading && !error && purchases.length > 0 && (
                <div className="space-y-3">
                  {purchases.map((purchase) => (
                    <PurchaseCard key={purchase.id} purchase={purchase} />
                  ))}
                </div>
              )}
              {!isLoading && !error && learningStats.length > 0 && (
                <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="pf-section-title">Automation learning</p>
                      <p className="pf-helper mt-1">Supplier-specific approval trends help tune future matching without storing receipt text globally.</p>
                    </div>
                    <Badge variant="purple" size="sm">Premium</Badge>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {learningStats.slice(0, 4).map((stat) => <LearningStatCard key={stat.id} stat={stat} />)}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Card padding="sm">
        <CardHeader title="Feature direction" description="This keeps billing simple today while leaving room for QuickBooks/Square-style invoice workflows." />
        <CardContent className="grid gap-3 p-0 sm:grid-cols-3">
          {[
            ['Now', 'One receivables queue for estimates, change orders, quick invoices, manual payments, and reminders.'],
            ['Next', 'Dedicated invoice records with number sequencing, due dates, reminders, receipts, and customer portal payment links.'],
            ['Integrations', 'QuickBooks should remain the accounting ledger. PaintFlow should sync invoices and payments rather than replace bookkeeping.'],
          ].map(([label, copy]) => (
            <div key={label} className="rounded-lg border border-gray-200 p-3">
              <p className="pf-meta">{label}</p>
              <p className="pf-copy mt-1">{copy}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {quickInvoiceOpen && (
        <div className="mobile-sheet fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="quick-invoice-title" onMouseDown={(event) => { if (event.target === event.currentTarget) closeQuickInvoiceModal(); }}>
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="quick-invoice-title" className="pf-section-title">Create quick invoice</h2>
                <p className="pf-copy mt-1">For one-off billing when no estimate or change order exists.</p>
              </div>
              <button type="button" className="btn-icon" aria-label="Close quick invoice" onClick={closeQuickInvoiceModal}>
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            <form className="space-y-4" onSubmit={createQuickInvoice}>
              <Select label="Customer" required value={quickInvoiceForm.leadId} onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, leadId: event.target.value })}>
                <option value="">Select customer...</option>
                {leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name || lead.email || 'Customer'}</option>)}
              </Select>
              <Input label="Description" required autoComplete="off" placeholder="Touch-up work, final balance, extra room" value={quickInvoiceForm.description} onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, description: event.target.value })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Amount" required type="number" min="0.01" step="0.01" inputMode="decimal" value={quickInvoiceForm.amount} onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, amount: event.target.value })} />
                <Input label="Tax" type="number" min="0" step="0.01" inputMode="decimal" value={quickInvoiceForm.tax} onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, tax: event.target.value })} />
              </div>
              <Input label="Payment terms" autoComplete="off" value={quickInvoiceForm.dueLabel} onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, dueLabel: event.target.value })} />
              <Textarea label="Internal note" rows={3} value={quickInvoiceForm.note} onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, note: event.target.value })} />
              <div className="mobile-sticky-actions flex flex-col gap-3 pt-2 sm:static sm:m-0 sm:flex-row sm:border-0 sm:bg-transparent sm:p-0">
                <Button type="button" variant="secondary" fullWidth onClick={closeQuickInvoiceModal}>Cancel</Button>
                <Button type="submit" fullWidth isLoading={isCreatingInvoice}>Create invoice</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {paymentReceivable && (
        <div className="mobile-sheet fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="record-payment-title" onMouseDown={(event) => { if (event.target === event.currentTarget) closePaymentModal(); }}>
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="record-payment-title" className="pf-section-title">Record payment</h2>
                <p className="pf-copy mt-1">{paymentReceivable.customerName} · {formatMoney(paymentReceivable.balance)} open</p>
              </div>
              <button type="button" className="btn-icon" aria-label="Close payment entry" onClick={closePaymentModal}>
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            <form className="space-y-4" onSubmit={recordPayment}>
              <Input label="Amount" required type="number" min="0.01" max={paymentReceivable.balance.toFixed(2)} step="0.01" inputMode="decimal" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} />
              <Select label="Payment method" value={paymentForm.source} onChange={(event) => setPaymentForm({ ...paymentForm, source: event.target.value as PaymentFormState['source'] })}>
                <option value="check">Check</option>
                <option value="cash">Cash</option>
                <option value="ach">ACH</option>
                <option value="other">Other</option>
              </Select>
              <Input label="Reference" autoComplete="off" placeholder="Check #, ACH confirmation, note" value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} />
              <Input label="Description" autoComplete="off" value={paymentForm.description} onChange={(event) => setPaymentForm({ ...paymentForm, description: event.target.value })} />
              {paymentReceivable.paid > 0.005 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  This invoice already has {formatMoney(paymentReceivable.paid)} recorded. You will be asked to confirm this is not a duplicate.
                </div>
              )}
              <div className="mobile-sticky-actions flex flex-col gap-3 pt-2 sm:static sm:m-0 sm:flex-row sm:border-0 sm:bg-transparent sm:p-0">
                <Button type="button" variant="secondary" fullWidth onClick={closePaymentModal}>Cancel</Button>
                <Button type="submit" fullWidth isLoading={isRecordingPayment}>Record payment</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {uploadModalOpen && (
        <div
          className="mobile-sheet fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invoice-upload-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeUploadModal();
          }}
        >
          <div className="max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="invoice-upload-title" className="pf-section-title">Review supplier invoice</h2>
                <p className="pf-copy mt-1">Upload a supplier invoice. PaintFlow will extract the lines, suggest a job match, and stage it for approval.</p>
              </div>
              <button type="button" className="btn-icon" aria-label="Close invoice upload" onClick={closeUploadModal}>
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>

            <form className="space-y-4" onSubmit={uploadInvoice}>
              <label className="block">
                <span className="form-label">Supplier invoice</span>
                <input
                  className="input mt-1 py-3"
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  onChange={(event) => setSelectedInvoiceFile(event.target.files?.[0] || null)}
                />
                <span className="pf-helper mt-1 block">
                  Use a PDF or photo of the supplier receipt. The imported costs will wait for approval before affecting the job.
                </span>
              </label>

              <details className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <summary className="cursor-pointer text-sm font-medium text-gray-700">Optional matching details</summary>
                <div className="mt-3 space-y-3">
                  <Select
                    label="Supplier"
                    value={form.supplier}
                    onChange={(event) => setForm({ ...form, supplier: event.target.value })}
                    options={supplierOptions}
                  />
                  <Input
                    label="Invoice #"
                    autoComplete="off"
                    enterKeyHint="next"
                    placeholder="Optional"
                    value={form.invoiceNumber}
                    onChange={(event) => setForm({ ...form, invoiceNumber: event.target.value })}
                  />
                  <Select label="Suggested job" value={form.jobId} onChange={(event) => setForm({ ...form, jobId: event.target.value })}>
                    <option value="">Let PaintFlow match it</option>
                    {jobs.map((job) => <option key={job.id} value={job.id}>{jobOptionLabel(job)}</option>)}
                  </Select>
                  <Input
                    label="Supplier sender email"
                    type="email"
                    autoComplete="email"
                    enterKeyHint="next"
                    placeholder="Optional"
                    value={form.senderEmail}
                    onChange={(event) => setForm({ ...form, senderEmail: event.target.value })}
                  />
                </div>
              </details>
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="purple" size="sm">Premium</Badge>
                  <p className="pf-row-title">OCR and receipt automation</p>
                </div>
                <p className="pf-copy mt-1">
                  OCR requires the Worker secret <code className="rounded bg-white px-1">OPENAI_API_KEY</code>. R2 is optional; without it, PaintFlow can stage the invoice for review but will not retain the original file.
                </p>
              </div>
              <div className="mobile-sticky-actions flex flex-col gap-3 pt-2 sm:static sm:m-0 sm:flex-row sm:border-0 sm:bg-transparent sm:p-0">
                <Button type="button" variant="secondary" fullWidth onClick={closeUploadModal}>Cancel</Button>
                <Button type="submit" fullWidth isLoading={isUploading}>Stage for review</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
