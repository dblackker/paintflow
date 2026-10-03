import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { invoiceCollectionPosition, type InvoiceBalance } from '@crewmodo/core';
import { useOperationKey } from '@/lib/useOperationKey';
import { manualPaymentFeedback, type ManualPaymentReceiptResult } from '@/lib/paymentReceipt';
import { Badge, StatusBadge } from '@/components/Badge';
import { AddressFields } from '@/components/AddressFields';
import { Button } from '@/components/Button';
import { Modal, ModalFooter } from '@/components/Modal';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Input, Select, Textarea } from '@/components/Input';
import { apiJson, formatAddress, formatMoney } from '@/lib/api';
import { cleanZip } from '@/lib/locations';
import { SupplierInvoiceReview, SupplierReviewCard } from '@/components/supplier-invoices/SupplierInvoiceReview';
import type { SupplierReviewChoices } from '@/components/supplier-invoices/SupplierInvoiceReview';
import { SupplierUploadModal } from '@/components/supplier-invoices/SupplierUploadModal';
import type { DuplicateInvoiceContext } from '@/components/supplier-invoices/SupplierUploadModal';
import { SupplierFileLink } from '@/components/supplier-invoices/SupplierFileLink';
import { SupplierRequestError, supplierErrorMessage, supplierJson } from '@/components/supplier-invoices/client';
import { importFilePath, supplierDate } from '@/components/supplier-invoices/types';

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
  jobId?: string | null;
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
  materialPurchaseId?: string | null;
  status: InvoiceImportStatus;
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
    fileRetentionStatus?: 'stored' | 'not_configured' | 'failed' | string | null;
    fileRetentionError?: string | null;
    possibleDuplicatePurchaseId?: string | null;
    documentReconciliation?: { required?: boolean; status?: string; lineTotal?: string; documentTotal?: string | null };
  } | null;
  sourceType?: string | null;
  senderEmail?: string | null;
  approvedAt?: string | null;
  rejectedAt?: string | null;
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

interface OrgSettings {
  salesTaxRate?: string | number | null;
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
  packages?: Array<{
    name?: string;
    total?: string | number | null;
    subtotal?: string | number | null;
    tax?: string | number | null;
    dueDate?: string | null;
    dueLabel?: string | null;
    reminderCadence?: string | null;
    taxRate?: string | number | null;
    taxOverride?: boolean | null;
    items?: Array<{ qty?: number; rate?: number }>;
    lineItems?: Array<{ qty?: number; rate?: number }>;
  }>;
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

interface CustomerInvoice {
  balance?: InvoiceBalance;
  id: string;
  leadId: string;
  jobId?: string | null;
  invoiceNumber?: string | null;
  description?: string | null;
  subtotal?: string | number | null;
  tax?: string | number | null;
  total?: string | number | null;
  status?: string | null;
  dueDate?: string | null;
  dueLabel?: string | null;
  reminderCadence?: string | null;
  createdAt?: string | null;
  sentAt?: string | null;
  paidAt?: string | null;
  payments?: Payment[];
  leadName?: string | null;
  leadEmail?: string | null;
  leadStreetAddress?: string | null;
  leadCity?: string | null;
  leadState?: string | null;
  leadPostalCode?: string | null;
  jobName?: string | null;
  jobNumber?: string | null;
  jobStreetAddress?: string | null;
  jobCity?: string | null;
  jobState?: string | null;
  jobPostalCode?: string | null;
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
  invoiceId?: string | null;
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
  customerMode: 'existing' | 'new';
  leadId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  streetAddress: string;
  city: string;
  state: string;
  postalCode: string;
  description: string;
  amount: string;
  taxMode: 'auto' | 'manual';
  taxRate: string;
  tax: string;
  dueLabel: string;
  dueDate: string;
  reminderCadence: 'none' | 'due_date' | 'three_days_before' | 'weekly';
  note: string;
}

interface PaymentFormState {
  amount: string;
  source: 'cash' | 'check' | 'ach' | 'other';
  reference: string;
  description: string;
  sendReceipt: boolean;
}

type ReceivableKind = 'estimate' | 'change_order' | 'invoice';

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
  leadHref?: string | null;
  jobHref?: string | null;
  address?: string;
  estimate?: Estimate;
  invoice?: CustomerInvoice;
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
  customerMode: 'existing',
  leadId: '',
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  streetAddress: '',
  city: '',
  state: '',
  postalCode: '',
  description: '',
  amount: '',
  taxMode: 'auto',
  taxRate: '0',
  tax: '0',
  dueLabel: 'Due on receipt',
  dueDate: '',
  reminderCadence: 'due_date',
  note: '',
};

const emptyPaymentForm: PaymentFormState = {
  amount: '',
  source: 'check',
  reference: '',
  description: '',
  sendReceipt: true,
};

function formatDate(value?: string | null) {
  if (!value) return 'Not set';
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function phoneDigits(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.slice(0, 10);
}

function maskPhone(value: string) {
  const digits = phoneDigits(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
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

function primaryPackage(estimate: Estimate) {
  const packages = Array.isArray(estimate.packages) ? estimate.packages : [];
  return packages.find((pkg) => pkg.name === 'proposal') || packages.find((pkg) => /better|recommended|quick invoice/i.test(String(pkg.name))) || packages[0];
}

function formatDateOnly(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function isoDateOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function taxRateDisplay(value: unknown) {
  const numeric = numberValue(value);
  if (numeric > 0 && numeric <= 1) return String(Number((numeric * 100).toFixed(4)));
  return numeric ? String(numeric) : '0';
}

function reminderLabel(value?: string | null) {
  if (value === 'none') return 'No automatic reminder';
  if (value === 'three_days_before') return 'Reminder 3 days before due date';
  if (value === 'weekly') return 'Weekly reminder until paid';
  return 'Reminder on due date';
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

function ReminderButton({ receivable, isSending, onSend }: { receivable: Receivable; isSending: boolean; onSend: (receivable: Receivable) => void }) {
  const canSend = Boolean(receivable.invoice?.id);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      leftIcon={<Icon name="mail" className="h-4 w-4" />}
      onClick={() => onSend(receivable)}
      isLoading={isSending}
      disabled={!canSend || isSending}
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
  return (
    <article id={`supplier-purchase-${purchase.id}`} tabIndex={-1} className="min-w-0 border-b border-gray-200 py-4">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <p className="pf-row-title">{purchase.supplier || 'Supplier invoice'}</p>
          <p className="pf-copy mt-1">
            Invoice {purchase.invoiceNumber || 'not set'} · {supplierDate(purchase.invoiceDate || purchase.createdAt)}
          </p>
          {items.length > 0 && (
            <details className="mt-2">
              <summary className="pf-copy min-h-12 cursor-pointer py-3">View {items.length} line{items.length === 1 ? '' : 's'}</summary>
              <div className="space-y-3">
                {items.map((item, index) => (
                  <div key={`${item.description}-${index}`} className="flex justify-between gap-3">
                    <span className="min-w-0">
                      <span className="pf-copy block break-words">{invoiceItemTitle(item)}</span>
                      {invoiceItemDetails(item) && <span className="pf-meta block break-words">{invoiceItemDetails(item)}</span>}
                    </span>
                    <span className="pf-value shrink-0">{formatMoney(item.total)}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
          {purchase.fileUrl && (
            <div className="mt-3">
              <SupplierFileLink path={purchase.fileUrl} label="View source file" />
            </div>
          )}
        </div>
        <div className="text-left sm:text-right">
          <p className="pf-section-title">{formatMoney(purchase.totalAmount)}</p>
          <p className="pf-meta">{items.length} item{items.length === 1 ? '' : 's'}</p>
        </div>
      </div>
    </article>
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

function supplierRuleKey(value?: string | null) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '_') || 'unknown_supplier';
}


function ReceivableCard({
  receivable,
  milestones,
  onRecordPayment,
  onSendReminder,
  onCancelInvoice,
  sendingReminderId,
}: {
  receivable: Receivable;
  milestones: PaymentMilestone[];
  onRecordPayment: (receivable: Receivable) => void;
  onSendReminder: (receivable: Receivable) => void;
  onCancelInvoice: (receivable: Receivable) => void;
  sendingReminderId: string;
}) {
  const schedule = receivable.usesPaymentSchedule
    ? paymentScheduleFor(receivable.amount, receivable.paid, milestones)
    : [];
  const nextMilestone = schedule.find((item) => item.balance > 0.005 && item.payable !== false);
  return (
    <Card padding="sm">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={receivable.kind === 'estimate' ? 'info' : receivable.kind === 'invoice' ? 'success' : 'purple'} size="sm">
              {receivable.kind === 'estimate' ? 'Estimate' : receivable.kind === 'invoice' ? 'Invoice' : 'Change order'}
            </Badge>
            <StatusBadge status={receivable.status || 'pending'} />
          </div>
          <Link to={receivable.href} className="mt-2 block truncate pf-row-title hover:text-blue-700">
            {receivable.title}
          </Link>
          {receivable.leadHref ? (
            <Link to={receivable.leadHref} className="pf-copy mt-1 block w-fit hover:text-blue-700 hover:underline">
              {receivable.customerName}
            </Link>
          ) : (
            <p className="pf-copy mt-1">{receivable.customerName}</p>
          )}
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
          <Button as="a" href={receivable.href} variant="secondary" size="sm" fullWidth>
            {receivable.kind === 'invoice' ? 'View invoice' : 'View details'}
          </Button>
          {(receivable.kind === 'estimate' || receivable.kind === 'invoice') && (
            <Button type="button" variant="secondary" size="sm" fullWidth onClick={() => onRecordPayment(receivable)}>
              Record payment
            </Button>
          )}
          <ReminderButton receivable={receivable} isSending={sendingReminderId === receivable.id} onSend={onSendReminder} />
          {receivable.kind === 'invoice' && (
            <Button type="button" variant="dangerSubtle" size="sm" fullWidth onClick={() => onCancelInvoice(receivable)}>
              Cancel invoice
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export function Invoices() {
  const operations = useOperationKey();
  const navigate = useNavigate();
  const [purchases, setPurchases] = useState<MaterialPurchase[]>([]);
  const [invoiceImports, setInvoiceImports] = useState<InvoiceImport[]>([]);
  const [learningStats, setLearningStats] = useState<InvoiceLearningStat[]>([]);
  const [aiUsage, setAiUsage] = useState<AiUsageSummary | null>(null);
  const [inboundEmailConfig, setInboundEmailConfig] = useState<InboundEmailConfig | null>(null);
  const [senderRules, setSenderRules] = useState<InvoiceSenderRule[]>([]);
  const [customerInvoices, setCustomerInvoices] = useState<CustomerInvoice[]>([]);
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [changeOrders, setChangeOrders] = useState<ChangeOrder[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [milestones, setMilestones] = useState<PaymentMilestone[]>([]);
  const [settings, setSettings] = useState<OrgSettings>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadWarning, setLoadWarning] = useState('');
  const [mode, setMode] = useState<'receivables' | 'supplier'>('receivables');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [quickInvoiceOpen, setQuickInvoiceOpen] = useState(false);
  const [paymentReceivable, setPaymentReceivable] = useState<Receivable | null>(null);
  const [cancelInvoiceTarget, setCancelInvoiceTarget] = useState<Receivable | null>(null);
  const [cancelInvoiceReason, setCancelInvoiceReason] = useState('');
  const [form, setForm] = useState<UploadFormState>(emptyUploadForm);
  const [quickInvoiceForm, setQuickInvoiceForm] = useState<QuickInvoiceFormState>(emptyQuickInvoiceForm);
  const [paymentForm, setPaymentForm] = useState<PaymentFormState>(emptyPaymentForm);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);
  const [isCancelingInvoice, setIsCancelingInvoice] = useState(false);
  const [sendingReminderId, setSendingReminderId] = useState('');
  const [reviewJobByImport, setReviewJobByImport] = useState<Record<string, string>>({});
  const [busyImportId, setBusyImportId] = useState('');
  const [busyImportAction, setBusyImportAction] = useState<'' | 'approve' | 'reject' | 'trust'>('');
  const [reviewingImport, setReviewingImport] = useState<InvoiceImport | null>(null);
  const [reviewError, setReviewError] = useState('');
  const [supplierError, setSupplierError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploadDuplicate, setUploadDuplicate] = useState<DuplicateInvoiceContext | null>(null);
  const [purchaseToView, setPurchaseToView] = useState('');
  const [selectedInvoiceFile, setSelectedInvoiceFile] = useState<File | null>(null);
  const supplierBusy = useRef(false);
  const uploadBusy = useRef(false);
  const uploadFileIdentity = useRef('');
  const supplierOperations = useRef(new Map<string, { fingerprint: string; key: string }>());

  function supplierOperationKey(operation: string, fingerprint: string) {
    const previous = supplierOperations.current.get(operation);
    if (previous?.fingerprint === fingerprint) return previous.key;
    const key = crypto.randomUUID();
    supplierOperations.current.set(operation, { fingerprint, key });
    return key;
  }

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
    const invoiceReceivables = customerInvoices
      .filter((invoice) => !['canceled', 'voided', 'paid', 'refunded'].includes(String(invoice.status || '')))
      .map((invoice) => {
        const amount = numberValue(invoice.total);
        const paid = (invoice.payments || []).reduce((sum, payment) => sum + netPayment(payment), 0);
        const balance = invoiceCollectionPosition(invoice, invoice.payments || []).remaining;
        const address = formatAddress({
          streetAddress: invoice.jobStreetAddress || invoice.leadStreetAddress,
          city: invoice.jobCity || invoice.leadCity,
          state: invoice.jobState || invoice.leadState,
          postalCode: invoice.jobPostalCode || invoice.leadPostalCode,
        }).replace(/\s+\d{5}$/, '');
        return {
          id: invoice.id,
          kind: 'invoice' as ReceivableKind,
          title: invoice.invoiceNumber ? `Invoice ${invoice.invoiceNumber}` : 'Invoice',
          customerName: invoice.leadName || 'Customer',
          customerEmail: invoice.leadEmail,
          status: invoice.status || 'sent',
          amount,
          paid,
          balance,
          createdAt: invoice.sentAt || invoice.createdAt,
          dueLabel: invoice.dueLabel || (invoice.dueDate ? `Due ${formatDateOnly(invoice.dueDate)}` : 'Due on receipt'),
          href: `/invoices/${invoice.id}`,
          previewHref: null,
          leadHref: `/leads/${invoice.leadId}`,
          jobHref: invoice.jobId ? `/jobs/${invoice.jobId}` : null,
          address,
          invoice,
          usesPaymentSchedule: false,
        };
      })
      .filter((item) => item.balance > 0.005);

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
        const proposal = primaryPackage(estimate);
        const quickDueLabel = proposal?.dueLabel || (proposal?.dueDate ? `Due ${formatDateOnly(proposal.dueDate)}` : 'Due on receipt');
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
          dueLabel: isQuickInvoice ? quickDueLabel : 'Per payment schedule',
          href: `/estimates/${estimate.id}/details`,
          previewHref: estimate.customerPreviewUrl || `/estimates/${estimate.id}`,
          leadHref: estimate.leadId ? `/leads/${estimate.leadId}` : null,
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
          leadHref: null,
          jobHref: job ? `/jobs/${job.id}` : null,
          address: jobAddress(job),
          changeOrder: order,
          usesPaymentSchedule: true,
        };
      })
      .filter((item) => item.balance > 0.005);

    return [...invoiceReceivables, ...estimateReceivables, ...changeOrderReceivables]
      .sort((a, b) => b.balance - a.balance);
  }, [changeOrders, customerInvoices, estimates, jobsByEstimateId, jobsById, paymentsByChangeOrder]);

  const totalReceivable = useMemo(() => receivables.reduce((sum, item) => sum + item.balance, 0), [receivables]);
  const totalSpend = useMemo(
    () => purchases.reduce((sum, purchase) => sum + numberValue(purchase.totalAmount), 0),
    [purchases],
  );
  const quickInvoiceAmount = numberValue(quickInvoiceForm.amount);
  const quickInvoiceTaxRate = numberValue(quickInvoiceForm.taxRate);
  const quickInvoiceTax = quickInvoiceForm.taxMode === 'auto'
    ? Math.round(quickInvoiceAmount * (quickInvoiceTaxRate / 100) * 100) / 100
    : numberValue(quickInvoiceForm.tax);
  const quickInvoiceTotal = quickInvoiceAmount + quickInvoiceTax;
  useEffect(() => {
    loadInvoices();
  }, []);


  useEffect(() => {
    if (!purchaseToView || reviewingImport || uploadModalOpen) return;
    const element = document.getElementById(`supplier-purchase-${purchaseToView}`);
    if (element) {
      element.scrollIntoView({ block: 'center' });
      element.focus({ preventScroll: true });
      setPurchaseToView('');
    }
  }, [purchaseToView, purchases, reviewingImport, uploadModalOpen]);

  async function loadInvoices() {
    setIsLoading(true);
    setError('');
    setLoadWarning('');
    setSupplierError('');
    try {
      const [purchasePayload, importPayload, learningPayload, usagePayload, inboundEmailPayload, senderRulesPayload, customerInvoicesPayload, estimatesPayload, jobsPayload, changeOrdersPayload, paymentsPayload, leadsPayload, schedulePayload, settingsPayload] = await Promise.all([
        apiJson<{ data?: MaterialPurchase[] }>('/v1/invoices/purchases').catch((err) => { setSupplierError(supplierErrorMessage(err)); return { data: undefined }; }),
        apiJson<{ data?: InvoiceImport[] }>('/v1/invoices/imports?status=needs_review').catch((err) => { setSupplierError(supplierErrorMessage(err)); return { data: undefined }; }),
        apiJson<{ data?: { stats?: InvoiceLearningStat[] } }>('/v1/invoices/imports/learning').catch(() => ({ data: { stats: [] } })),
        apiJson<{ data?: AiUsageSummary }>('/v1/invoices/imports/ai-usage').catch(() => ({ data: null })),
        apiJson<{ data?: InboundEmailConfig }>('/v1/invoices/inbound-email-config').catch(() => ({ data: null })),
        apiJson<{ data?: InvoiceSenderRule[] }>('/v1/invoices/imports/sender-rules').catch(() => ({ data: [] })),
        apiJson<{ data?: CustomerInvoice[] }>('/v1/invoices/customer').catch(() => ({ data: [] })),
        apiJson<{ data?: Estimate[] }>('/v1/estimates?limit=100').catch((err) => {
          setLoadWarning(err instanceof Error ? `Estimate balances could not be loaded: ${err.message}` : 'Estimate balances could not be loaded.');
          return { data: [] };
        }),
        apiJson<{ data?: Job[] }>('/v1/jobs').catch(() => ({ data: [] })),
        apiJson<{ data?: ChangeOrder[] }>('/v1/change-orders').catch(() => ({ data: [] })),
        apiJson<{ data?: Payment[] }>('/v1/payments/history').catch(() => ({ data: [] })),
        apiJson<{ data?: Lead[] }>('/v1/leads?limit=200').catch(() => ({ data: [] })),
        apiJson<{ data?: { milestones?: PaymentMilestone[] } }>('/v1/settings/payment-schedule').catch(() => ({ data: { milestones: [] } })),
        apiJson<{ data?: OrgSettings }>('/v1/settings/org').catch(() => ({ data: {} })),
      ]);
      if (purchasePayload.data) setPurchases(purchasePayload.data);
      if (importPayload.data) setInvoiceImports(importPayload.data.filter((item) => item.status === 'needs_review'));
      setLearningStats(learningPayload.data?.stats || []);
      setAiUsage(usagePayload.data || null);
      setInboundEmailConfig(inboundEmailPayload.data || null);
      setSenderRules(senderRulesPayload.data || []);
      setCustomerInvoices(customerInvoicesPayload.data || []);
      const loadedImports = importPayload.data;
      if (loadedImports) setReviewJobByImport((previous) => ({ ...Object.fromEntries(loadedImports.map((item) => [item.id, item.jobId || ''])), ...previous }));
      setEstimates(estimatesPayload.data || []);
      setJobs(jobsPayload.data || []);
      setChangeOrders(changeOrdersPayload.data || []);
      setPayments(paymentsPayload.data || []);
      setLeads(leadsPayload.data || []);
      setMilestones(schedulePayload.data?.milestones || []);
      setSettings(settingsPayload.data || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invoices');
    } finally {
      setIsLoading(false);
    }
  }

  function openUploadModal() {
    setForm(emptyUploadForm);
    setSelectedInvoiceFile(null);
    uploadFileIdentity.current = '';
    setUploadError('');
    setUploadDuplicate(null);
    setUploadModalOpen(true);
  }

  function closeUploadModal() {
    if (uploadBusy.current) return;
    setUploadModalOpen(false);
  }

  function openQuickInvoiceModal() {
    const defaultTaxRate = taxRateDisplay(settings.salesTaxRate);
    setQuickInvoiceForm({
      ...emptyQuickInvoiceForm,
      taxRate: defaultTaxRate,
      dueDate: isoDateOffset(14),
      dueLabel: 'Net 14',
    });
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

  function openCancelInvoiceModal(receivable: Receivable) {
    setCancelInvoiceTarget(receivable);
    setCancelInvoiceReason('');
  }

  function closeCancelInvoiceModal() {
    if (isCancelingInvoice) return;
    setCancelInvoiceTarget(null);
    setCancelInvoiceReason('');
  }

  function selectInvoiceFile(file: File | null) {
    setUploadDuplicate(null);
    setUploadError('');
    uploadFileIdentity.current = crypto.randomUUID();
    if (file && (!['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 15 * 1024 * 1024)) {
      setSelectedInvoiceFile(null);
      setUploadError('Choose a PDF, JPG, PNG or WebP file up to 15 MB.');
      return;
    }
    setSelectedInvoiceFile(file);
  }

  async function refreshSupplierPurchases() {
    try {
      const payload = await supplierJson<{ data?: MaterialPurchase[] }>('/v1/invoices/purchases');
      setPurchases((previous) => {
        const known = new Map(previous.map((purchase) => [purchase.id, purchase]));
        (payload.data || []).forEach((purchase) => known.set(purchase.id, { ...known.get(purchase.id), ...purchase }));
        return Array.from(known.values());
      });
      return payload.data || [];
    } catch (err) {
      setSupplierError('Purchase history could not refresh. ' + supplierErrorMessage(err));
      return [];
    }
  }

  function openImportReview(invoiceImport: InvoiceImport) {
    setReviewError('');
    setReviewingImport(invoiceImport);
  }

  async function viewSupplierPurchase(id: string) {
    setMode('supplier');
    const purchase = purchases.find((item) => item.id === id) || (await refreshSupplierPurchases()).find((item) => item.id === id);
    if (!purchase) {
      setReviewError('The existing purchase could not be loaded. Keep this invoice in review and try again.');
      return;
    }
    setReviewingImport(null);
    setPurchaseToView(id);
  }

  function viewUploadDuplicate() {
    if (!uploadDuplicate) return;
    setUploadModalOpen(false);
    setMode('supplier');
    if (uploadDuplicate.type === 'import') {
      const invoiceImport = uploadDuplicate.record as InvoiceImport;
      if (invoiceImport.status === 'needs_review') {
        setInvoiceImports((previous) => previous.some((item) => item.id === invoiceImport.id) ? previous : [invoiceImport, ...previous]);
      }
      openImportReview(invoiceImport);
    } else {
      const purchase = uploadDuplicate.record as MaterialPurchase;
      setPurchases((previous) => previous.some((item) => item.id === purchase.id) ? previous : [purchase, ...previous]);
      setPurchaseToView(purchase.id);
    }
  }

  async function uploadInvoice(event: FormEvent) {
    event.preventDefault();
    if (uploadBusy.current || uploadDuplicate) return;
    const fileToUpload = selectedInvoiceFile;
    if (!fileToUpload) {
      setUploadError('Choose an invoice file first.');
      return;
    }
    uploadBusy.current = true;
    setIsUploading(true);
    setUploadError('');
    try {
      const body = new FormData();
      body.set('file', fileToUpload);
      body.set('supplier', form.supplier || '');
      body.set('invoiceNumber', form.invoiceNumber || '');
      body.set('senderEmail', form.senderEmail || '');
      body.set('jobId', form.jobId || '');
      const payload = await supplierJson<{ data?: InvoiceImport }>('/v1/invoices/imports', {
        method: 'POST',
        headers: { 'Idempotency-Key': supplierOperationKey('upload', JSON.stringify({ file: uploadFileIdentity.current, ...form })) },
        body,
      });
      if (!payload.data?.id) throw new Error('The server did not confirm staging. Retry with the same file.');
      const invoiceImport = payload.data;
      setInvoiceImports((previous) => previous.some((item) => item.id === invoiceImport.id) ? previous : [invoiceImport, ...previous]);
      setReviewJobByImport((previous) => ({ ...previous, [invoiceImport.id]: invoiceImport.jobId || form.jobId || '' }));
      setUploadModalOpen(false);
      setMode('supplier');
      openImportReview(invoiceImport);
      supplierOperations.current.delete('upload');
      window.showToast?.('Invoice staged for review.', 'success');
    } catch (err) {
      if (err instanceof SupplierRequestError && err.payload.duplicate && err.payload.data?.id) {
        setUploadDuplicate({ type: err.payload.duplicateType || ('status' in err.payload.data ? 'import' : 'purchase'), record: err.payload.data });
        if ('status' in err.payload.data && err.payload.data.status !== 'needs_review') {
          const reviewedId = err.payload.data.id;
          setInvoiceImports((previous) => previous.filter((item) => item.id !== reviewedId));
        }
      } else setUploadError(supplierErrorMessage(err));
    } finally {
      uploadBusy.current = false;
      setIsUploading(false);
    }
  }

  async function reconcileReviewConflict(invoiceImport: InvoiceImport, err: unknown) {
    if (!(err instanceof SupplierRequestError) || (err.status !== 409 && err.status !== 404)) return false;
    try {
      const payload = await supplierJson<{ data?: InvoiceImport[] }>('/v1/invoices/imports');
      const current = payload.data?.find((item) => item.id === invoiceImport.id);
      if (!current) return false;
      if (current.status === 'needs_review') {
        setReviewingImport({ ...invoiceImport, ...current, extractedData: { ...invoiceImport.extractedData, ...current.extractedData } });
        setReviewError(supplierErrorMessage(err));
        return true;
      }
      setInvoiceImports((previous) => previous.filter((item) => item.id !== current.id));
      setReviewingImport({ ...invoiceImport, ...current, extractedData: { ...invoiceImport.extractedData, ...current.extractedData } });
      setReviewError(current.status === 'approved'
        ? 'This invoice was approved in another session. No second purchase was added.'
        : 'This invoice was rejected in another session. No costs were added; the original file is still available.');
      await refreshSupplierPurchases();
      return true;
    } catch { return false; }
  }

  async function approveImport(invoiceImport: InvoiceImport, choices: SupplierReviewChoices) {
    if (supplierBusy.current) return;
    const jobId = reviewJobByImport[invoiceImport.id] || invoiceImport.jobId || '';
    if (!jobId || !jobs.some((job) => job.id === jobId)) {
      setReviewError('Select a job before approving this invoice.');
      return;
    }
    if (invoiceImport.extractedData?.possibleDuplicatePurchaseId && !choices.confirmSimilarPurchase) {
      setReviewError('Compare the existing purchase and confirm this is a separate purchase.');
      return;
    }
    supplierBusy.current = true;
    setBusyImportId(invoiceImport.id);
    setBusyImportAction('approve');
    setReviewError('');
    const input = { jobId, ...choices };
    try {
      const payload = await supplierJson<{ data?: { import?: InvoiceImport; purchase?: MaterialPurchase } }>(`/v1/invoices/imports/${invoiceImport.id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': supplierOperationKey(`approve:${invoiceImport.id}`, JSON.stringify(input)),
        },
        body: JSON.stringify(input),
      });
      if (!payload.data?.purchase?.id) throw new Error('The server did not confirm approval. Retry to check the result.');
      const purchase = { ...payload.data.purchase, fileUrl: payload.data.purchase.fileUrl || importFilePath(invoiceImport) || null };
      setPurchases((previous) => [purchase, ...previous.filter((item) => item.id !== purchase.id)]);
      setInvoiceImports((previous) => previous.filter((item) => item.id !== invoiceImport.id));
      setReviewingImport(null);
      supplierOperations.current.delete(`approve:${invoiceImport.id}`);
      window.showToast?.('Supplier invoice approved.', 'success');
    } catch (err) {
      if (!await reconcileReviewConflict(invoiceImport, err)) setReviewError(supplierErrorMessage(err));
    } finally {
      supplierBusy.current = false;
      setBusyImportId('');
      setBusyImportAction('');
    }
  }

  async function rejectImport(invoiceImport: InvoiceImport, reason: string) {
    if (supplierBusy.current) return;
    supplierBusy.current = true;
    setBusyImportId(invoiceImport.id);
    setBusyImportAction('reject');
    setReviewError('');
    const input = { reviewNotes: reason.trim() || 'Rejected from invoice review queue.' };
    try {
      await supplierJson(`/v1/invoices/imports/${invoiceImport.id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': supplierOperationKey(`reject:${invoiceImport.id}`, JSON.stringify(input)),
        },
        body: JSON.stringify(input),
      });
      setInvoiceImports((previous) => previous.filter((item) => item.id !== invoiceImport.id));
      setReviewingImport(null);
      supplierOperations.current.delete(`reject:${invoiceImport.id}`);
      window.showToast?.('Supplier invoice rejected.', 'success');
    } catch (err) {
      if (!await reconcileReviewConflict(invoiceImport, err)) setReviewError(supplierErrorMessage(err));
    } finally {
      supplierBusy.current = false;
      setBusyImportId('');
      setBusyImportAction('');
    }
  }

  async function trustInvoiceSender(invoiceImport: InvoiceImport) {
    if (supplierBusy.current || !invoiceImport.senderEmail || !invoiceImport.supplier) return;
    supplierBusy.current = true;
    setBusyImportId(invoiceImport.id);
    setBusyImportAction('trust');
    setReviewError('');
    const input = { supplier: invoiceImport.supplier, senderEmail: invoiceImport.senderEmail, autoStage: true, isActive: true };
    try {
      const payload = await supplierJson<{ data?: InvoiceSenderRule }>('/v1/invoices/imports/sender-rules', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': supplierOperationKey(`trust:${invoiceImport.id}`, JSON.stringify(input)),
        },
        body: JSON.stringify(input),
      });
      if (payload.data) setSenderRules((previous) => [payload.data!, ...previous.filter((rule) => rule.id !== payload.data!.id)]);
      supplierOperations.current.delete(`trust:${invoiceImport.id}`);
      window.showToast?.('Supplier sender trusted.', 'success');
    } catch (err) {
      setReviewError(supplierErrorMessage(err));
    } finally {
      supplierBusy.current = false;
      setBusyImportId('');
      setBusyImportAction('');
    }
  }

  async function createQuickInvoice(event: FormEvent) {
    event.preventDefault();
    const amount = numberValue(quickInvoiceForm.amount);
    const tax = quickInvoiceTax;
    if (quickInvoiceForm.customerMode === 'existing' && !quickInvoiceForm.leadId) {
      window.showToast?.('Select a customer or create a new one.', 'error');
      return;
    }
    if (quickInvoiceForm.customerMode === 'new' && !quickInvoiceForm.customerName.trim()) {
      window.showToast?.('Enter the customer name.', 'error');
      return;
    }
    if (quickInvoiceForm.customerMode === 'new' && !quickInvoiceForm.customerEmail.trim() && !quickInvoiceForm.customerPhone.trim()) {
      window.showToast?.('Add a phone number or email for the new customer.', 'error');
      return;
    }
    if (quickInvoiceForm.customerMode === 'new' && quickInvoiceForm.customerPhone && phoneDigits(quickInvoiceForm.customerPhone).length !== 10) {
      window.showToast?.('Enter a 10-digit customer phone number.', 'error');
      return;
    }
    if (amount <= 0) {
      window.showToast?.('Enter a positive invoice amount.', 'error');
      return;
    }
    if (quickInvoiceForm.taxMode === 'auto' && numberValue(quickInvoiceForm.taxRate) < 0) {
      window.showToast?.('Tax rate cannot be negative.', 'error');
      return;
    }
    let lead = leads.find((item) => item.id === quickInvoiceForm.leadId);
    const dueLabel = quickInvoiceForm.dueDate ? `Due ${formatDateOnly(quickInvoiceForm.dueDate)}` : 'Due on receipt';
    setIsCreatingInvoice(true);
    try {
      if (quickInvoiceForm.customerMode === 'new') {
        const leadResponse = await apiJson<{ data?: Lead }>('/v1/leads', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            name: quickInvoiceForm.customerName.trim(),
            email: quickInvoiceForm.customerEmail.trim() || undefined,
            phone: quickInvoiceForm.customerPhone.trim() || undefined,
            streetAddress: quickInvoiceForm.streetAddress.trim() || undefined,
            city: quickInvoiceForm.city.trim() || undefined,
            state: quickInvoiceForm.state.trim().toUpperCase() || undefined,
            postalCode: cleanZip(quickInvoiceForm.postalCode) || undefined,
            source: 'Quick invoice',
            status: 'contacted',
          }),
        });
        if (!leadResponse.data?.id) throw new Error('Customer was not created.');
        lead = leadResponse.data;
        setLeads((current) => [leadResponse.data as Lead, ...current]);
      }

      if (!lead?.id) throw new Error('Customer is required to create an invoice.');

      const response = await apiJson<{ data?: CustomerInvoice & { emailSent?: boolean } }>('/v1/invoices/customer', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          leadId: lead.id,
          description: quickInvoiceForm.description || 'Services',
          amount,
          tax,
          dueDate: quickInvoiceForm.dueDate || null,
          dueLabel,
          reminderCadence: quickInvoiceForm.reminderCadence,
          taxRate: quickInvoiceForm.taxMode === 'auto' ? numberValue(quickInvoiceForm.taxRate) : null,
          taxOverride: quickInvoiceForm.taxMode === 'manual',
          note: [reminderLabel(quickInvoiceForm.reminderCadence), quickInvoiceForm.note].filter(Boolean).join(' - ') || null,
        }),
      });
      window.showToast?.(response.data?.emailSent ? 'Invoice created and emailed' : 'Invoice created', 'success');
      setQuickInvoiceOpen(false);
      await loadInvoices();
      if (response.data?.id) navigate('/invoices');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to create invoice', 'error');
    } finally {
      setIsCreatingInvoice(false);
    }
  }

  async function recordPayment(event: FormEvent) {
    event.preventDefault();
    if (!paymentReceivable) return;
    const paymentTarget = paymentReceivable.invoice?.id
      ? { invoiceId: paymentReceivable.invoice.id }
      : paymentReceivable.estimate?.id
        ? { estimateId: paymentReceivable.estimate.id }
        : null;
    if (!paymentTarget) {
      window.showToast?.('Payments can be recorded for invoices and estimates.', 'error');
      return;
    }
    const amount = numberValue(paymentForm.amount);
    if (amount <= 0 || amount > paymentReceivable.balance + 0.005) {
      window.showToast?.(`Payment must be between $0.01 and ${formatMoney(paymentReceivable.balance)}.`, 'error');
      return;
    }
    const confirmAdditionalPayment = paymentReceivable.paid > 0.005;
    if (confirmAdditionalPayment && !window.confirm(`This customer already has ${formatMoney(paymentReceivable.paid)} recorded. Confirm this is an additional payment and not a duplicate.`)) return;
    setIsRecordingPayment(true);
    try {
      const body = JSON.stringify({ ...paymentTarget, amount: paymentForm.amount, source: paymentForm.source,
        reference: paymentForm.reference || null, description: paymentForm.description || null,
        confirmAdditionalPayment, sendReceipt: paymentReceivable.kind === 'invoice' ? paymentForm.sendReceipt : false });
      const result = await apiJson<ManualPaymentReceiptResult>('/v1/payments/manual', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': operations.keyFor('manual', body),
        },
        body,
      });
      operations.complete('manual');
      const feedback = manualPaymentFeedback(result);
      window.showToast?.(feedback.message, feedback.type);
      setPaymentReceivable(null);
      await loadInvoices();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to record payment', 'error');
    } finally {
      setIsRecordingPayment(false);
    }
  }

  async function sendPaymentReminder(receivable: Receivable) {
    if (!receivable.invoice?.id) {
      window.showToast?.('Reminders are available for invoice records.', 'error');
      return;
    }
    setSendingReminderId(receivable.id);
    try {
      await apiJson(`/v1/invoices/customer/${receivable.invoice.id}/send-reminder`, {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      window.showToast?.('Payment reminder sent', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to send reminder', 'error');
    } finally {
      setSendingReminderId('');
    }
  }

  async function cancelInvoice(event: FormEvent) {
    event.preventDefault();
    if (!cancelInvoiceTarget?.invoice?.id) return;
    setIsCancelingInvoice(true);
    try {
      const response = await apiJson<{ data?: CustomerInvoice & { emailSent?: boolean } }>(`/v1/invoices/customer/${cancelInvoiceTarget.invoice.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ reason: cancelInvoiceReason.trim() || null }),
      });
      window.showToast?.(response.data?.emailSent ? 'Invoice canceled and customer emailed' : 'Invoice canceled', 'success');
      setCancelInvoiceTarget(null);
      setCancelInvoiceReason('');
      await loadInvoices();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to cancel invoice', 'error');
    } finally {
      setIsCancelingInvoice(false);
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
          <Link to="/settings#payment-schedule-settings" className="btn-tonal btn-sm justify-center">Review payment schedule</Link>
        </div>
      </Card>

      <Card padding="sm">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="pf-row-title">Due dates</p>
            <p className="pf-helper mt-1">Set the exact calendar date when payment is expected.</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="pf-row-title">Reminders</p>
            <p className="pf-helper mt-1">Set invoice reminders now; the reminder queue can send them automatically when email automation is enabled.</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
            <p className="pf-row-title">Tax controls</p>
            <p className="pf-helper mt-1">Use the workspace tax rate by default, with per-invoice overrides for jurisdiction or tax-exempt work.</p>
          </div>
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
              {!isLoading && !error && loadWarning && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {loadWarning}
                </div>
              )}
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
                      <ReceivableCard
                        key={`${receivable.kind}-${receivable.id}`}
                        receivable={receivable}
                        milestones={milestones}
                        onRecordPayment={openPaymentModal}
                        onSendReminder={sendPaymentReminder}
                        onCancelInvoice={openCancelInvoiceModal}
                        sendingReminderId={sendingReminderId}
                      />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <section aria-label="Supplier invoices" className="space-y-4 min-w-0">
          <div className="flex flex-wrap gap-x-6 gap-y-2 border-b border-gray-200 pb-3">
            <p className="pf-copy">{invoiceImports.length} need review</p>
            <p className="pf-copy">{purchases.length} recent purchases</p>
            <p className="pf-copy">{formatMoney(totalSpend)} in this list</p>
          </div>
          {isLoading && <PurchaseSkeleton />}
          {!isLoading && (supplierError || error) && <div role="alert" className="space-y-2">
            <p className="pf-field-error">{supplierError || error}</p>
            <Button variant="secondary" className="min-h-12 min-w-12" onClick={loadInvoices}>Retry supplier data</Button>
          </div>}
          {!isLoading && !supplierError && !error && <>
            <section aria-labelledby="supplier-needs-review">
              <h2 id="supplier-needs-review" className="pf-section-title">Needs review</h2>
              {invoiceImports.length ? invoiceImports.map((invoiceImport) => <SupplierReviewCard
                key={invoiceImport.id} invoiceImport={invoiceImport} onReview={() => openImportReview(invoiceImport)} />
              ) : <p className="pf-helper mt-2">All caught up. Upload an invoice to add a purchase.</p>}
            </section>
            {purchases.length > 0 && <section aria-labelledby="supplier-purchase-history">
              <h2 id="supplier-purchase-history" className="pf-section-title">Purchase history</h2>
              {purchases.map((purchase) => <PurchaseCard key={purchase.id} purchase={purchase} />)}
            </section>}
            {!purchases.length && !invoiceImports.length && <Button className="min-h-12 min-w-12" leftIcon={<Icon name="file-text" />} onClick={openUploadModal}>Upload supplier invoice</Button>}
          </>}
          <details className="border-t border-gray-200 pt-2">
            <summary className="pf-copy min-h-12 cursor-pointer py-3">Email forwarding</summary>
            <p className="pf-helper">Only trusted sender addresses can forward invoices for review.</p>
            <p className="pf-meta mt-3">{inboundEmailConfig?.enabled ? 'Configured' : 'Not configured'}</p>
            <p className="pf-copy mt-1 break-all">{inboundEmailConfig?.forwardingAddress || 'Forwarding is not available yet.'}</p>
            {inboundEmailConfig?.alternateAddress && <p className="pf-helper mt-2 break-all">Alternate: {inboundEmailConfig.alternateAddress}</p>}
            {senderRules.length > 0 && <ul className="mt-3 space-y-2">{senderRules.map((rule) => <li key={rule.id} className="pf-copy break-all">{rule.senderEmail} - {rule.supplierName || rule.supplierKey}{rule.isActive === false ? ' (inactive)' : ''}</li>)}</ul>}
          </details>
          {(aiUsage || learningStats.length > 0) && <details className="border-t border-gray-200 pt-2">
            <summary className="pf-copy min-h-12 cursor-pointer py-3">Usage and matching</summary>
            {aiUsage && <AiUsageCard usage={aiUsage} />}
            {learningStats.length > 0 && <div className="mt-4 space-y-3">
              {learningStats.slice(0, 4).map((stat) => <LearningStatCard key={stat.id} stat={stat} />)}
            </div>}
          </details>}
        </section>
      )}

      {quickInvoiceOpen && (
        <Modal isOpen title="Create quick invoice" size="lg" onClose={closeQuickInvoiceModal} closeOnEscape={!isCreatingInvoice} closeOnBackdrop={false}>
            <form className="space-y-4" onSubmit={createQuickInvoice}>
              <div className="border-b border-gray-200 pb-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="pf-row-title">Customer</p>
                  <div className="pf-segmented-group" aria-label="Customer selection mode">
                    <button type="button" aria-pressed={quickInvoiceForm.customerMode === 'existing'} onClick={() => setQuickInvoiceForm({ ...quickInvoiceForm, customerMode: 'existing' })}>Existing</button>
                    <button type="button" aria-pressed={quickInvoiceForm.customerMode === 'new'} onClick={() => setQuickInvoiceForm({ ...quickInvoiceForm, customerMode: 'new', leadId: '' })}>New</button>
                  </div>
                </div>
                {quickInvoiceForm.customerMode === 'existing' ? (
                  <Select label="Choose customer" required value={quickInvoiceForm.leadId} onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, leadId: event.target.value })}>
                    <option value="">Select customer...</option>
                    {leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name || lead.email || 'Customer'}</option>)}
                  </Select>
                ) : (
                  <div className="grid gap-3">
                    <Input label="Name" required autoComplete="name" value={quickInvoiceForm.customerName} onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, customerName: event.target.value })} placeholder="Jane Homeowner" />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input label="Email" type="email" inputMode="email" autoComplete="email" value={quickInvoiceForm.customerEmail} onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, customerEmail: event.target.value })} placeholder="customer@example.com" />
                      <Input label="Phone" type="tel" inputMode="numeric" autoComplete="tel" value={quickInvoiceForm.customerPhone} onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, customerPhone: maskPhone(event.target.value) })} placeholder="(555) 123-4567" />
                    </div>
                    <AddressFields
                      streetLabel="Jobsite street"
                      value={quickInvoiceForm}
                      onChange={(address) => setQuickInvoiceForm({ ...quickInvoiceForm, ...address })}
                    />
                    <p className="pf-helper">This creates a CRM customer and uses the jobsite address on the invoice.</p>
                  </div>
                )}
              </div>
              <Input label="Description" required autoComplete="off" placeholder="Touch-up work, final balance, extra room" value={quickInvoiceForm.description} onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, description: event.target.value })} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Amount" required type="number" min="0.01" step="0.01" inputMode="decimal" value={quickInvoiceForm.amount} onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, amount: event.target.value })} />
                <Input
                  label="Due date"
                  type="date"
                  value={quickInvoiceForm.dueDate}
                  onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, dueDate: event.target.value, dueLabel: event.target.value ? 'Custom due date' : 'Due on receipt' })}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Reminder" value={quickInvoiceForm.reminderCadence} onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, reminderCadence: event.target.value as QuickInvoiceFormState['reminderCadence'] })}>
                  <option value="due_date">On due date</option>
                  <option value="three_days_before">3 days before due</option>
                  <option value="weekly">Weekly until paid</option>
                  <option value="none">No reminder</option>
                </Select>
              </div>
              <div className="border-y border-gray-200 py-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="pf-row-title">Sales tax</p>
                  <div className="pf-segmented-group" aria-label="Tax entry mode">
                    <button type="button" aria-pressed={quickInvoiceForm.taxMode === 'auto'} onClick={() => setQuickInvoiceForm({ ...quickInvoiceForm, taxMode: 'auto' })}>Rate</button>
                    <button type="button" aria-pressed={quickInvoiceForm.taxMode === 'manual'} onClick={() => setQuickInvoiceForm({ ...quickInvoiceForm, taxMode: 'manual', tax: String(quickInvoiceTax) })}>Override</button>
                  </div>
                </div>
                {quickInvoiceForm.taxMode === 'auto' ? (
                  <Input label="Tax rate (%)" type="number" min="0" step="0.01" inputMode="decimal" value={quickInvoiceForm.taxRate} onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, taxRate: event.target.value })} helperText="Defaults from Settings. Override here when the invoice needs a different local rate." />
                ) : (
                  <Input label="Tax amount" type="number" min="0" step="0.01" inputMode="decimal" value={quickInvoiceForm.tax} onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, tax: event.target.value })} helperText="Use for tax-exempt work, jurisdiction overrides, or accounting corrections." />
                )}
              </div>
              <div className="border-y border-gray-200 py-4">
                <p className="pf-row-title">Invoice total</p>
                <div className="pf-copy mt-2 grid gap-1">
                  <div className="flex justify-between gap-3"><span>Subtotal</span><span>{formatMoney(quickInvoiceAmount)}</span></div>
                  <div className="flex justify-between gap-3"><span>Tax{quickInvoiceForm.taxMode === 'auto' ? ` (${quickInvoiceTaxRate || 0}%)` : ' override'}</span><span>{formatMoney(quickInvoiceTax)}</span></div>
                  <div className="pf-emphasis flex justify-between gap-3 border-t border-gray-200 pt-2"><span>Total</span><span>{formatMoney(quickInvoiceTotal)}</span></div>
                  <p className="pf-helper mt-2">
                    {quickInvoiceForm.dueDate ? `Due ${formatDateOnly(quickInvoiceForm.dueDate)}. ` : ''}
                    {reminderLabel(quickInvoiceForm.reminderCadence)}.
                  </p>
                </div>
              </div>
              <Textarea label="Internal note" rows={3} value={quickInvoiceForm.note} onChange={(event) => setQuickInvoiceForm({ ...quickInvoiceForm, note: event.target.value })} />
              <ModalFooter className="!grid grid-cols-2 gap-2">
                <Button type="button" variant="ghost" fullWidth disabled={isCreatingInvoice} onClick={closeQuickInvoiceModal}>Cancel</Button>
                <Button type="submit" fullWidth isLoading={isCreatingInvoice}>Create invoice</Button>
              </ModalFooter>
            </form>
        </Modal>
      )}

      {cancelInvoiceTarget && (
        <Modal isOpen title="Cancel invoice" size="sm" onClose={closeCancelInvoiceModal} closeOnEscape={!isCancelingInvoice} closeOnBackdrop={false}>
            <form className="space-y-4" onSubmit={cancelInvoice}>
              <p className="pf-copy">{cancelInvoiceTarget.title} will be closed. Crewmodo will attempt to email the customer.</p>
              <div className="pf-field-error">
                Canceling an invoice does not refund money. If payment has already been recorded, use the refund or credit workflow instead.
              </div>
              <Textarea
                label="Internal reason"
                rows={3}
                maxLength={500}
                value={cancelInvoiceReason}
                onChange={(event) => setCancelInvoiceReason(event.target.value)}
                placeholder="Created in error, customer requested updated invoice, duplicate invoice"
              />
              <ModalFooter className="!grid grid-cols-2 gap-2">
                <Button type="button" variant="ghost" fullWidth disabled={isCancelingInvoice} onClick={closeCancelInvoiceModal}>Keep invoice</Button>
                <Button type="submit" variant="dangerSubtle" fullWidth isLoading={isCancelingInvoice}>Cancel invoice</Button>
              </ModalFooter>
            </form>
        </Modal>
      )}

      {paymentReceivable && (
        <Modal isOpen title="Record payment" size="sm" onClose={closePaymentModal} closeOnEscape={!isRecordingPayment} closeOnBackdrop={false}>
            <form className="space-y-4" onSubmit={recordPayment}>
              <p className="pf-copy">{paymentReceivable.customerName} · {formatMoney(paymentReceivable.balance)} open</p>
              <Input label="Amount" required type="number" min="0.01" max={paymentReceivable.balance.toFixed(2)} step="0.01" inputMode="decimal" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} />
              <Select label="Payment method" value={paymentForm.source} onChange={(event) => setPaymentForm({ ...paymentForm, source: event.target.value as PaymentFormState['source'] })}>
                <option value="check">Check</option>
                <option value="cash">Cash</option>
                <option value="ach">ACH</option>
                <option value="other">Other</option>
              </Select>
              <Input label="Reference" autoComplete="off" placeholder="Check #, ACH confirmation, note" value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} />
              <Input label="Description" autoComplete="off" value={paymentForm.description} onChange={(event) => setPaymentForm({ ...paymentForm, description: event.target.value })} />
              {paymentReceivable.kind === 'invoice' && (
                <label className="flex gap-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-950">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={paymentForm.sendReceipt}
                    onChange={(event) => setPaymentForm({ ...paymentForm, sendReceipt: event.target.checked })}
                  />
                  <span>
                    <span className="pf-copy block">Send receipt to customer</span>
                  </span>
                </label>
              )}
              {paymentReceivable.paid > 0.005 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  This invoice already has {formatMoney(paymentReceivable.paid)} recorded. You will be asked to confirm this is not a duplicate.
                </div>
              )}
              <ModalFooter className="!grid grid-cols-2 gap-2">
                <Button type="button" variant="ghost" fullWidth disabled={isRecordingPayment} onClick={closePaymentModal}>Cancel</Button>
                <Button type="submit" fullWidth isLoading={isRecordingPayment}>{paymentReceivable.kind === 'invoice' && numberValue(paymentForm.amount) >= paymentReceivable.balance - 0.005 ? 'Mark paid' : 'Record payment'}</Button>
              </ModalFooter>
            </form>
        </Modal>
      )}

      <SupplierUploadModal isOpen={uploadModalOpen} onClose={closeUploadModal} form={form} onFormChange={(value) => { setForm(value); setUploadError(''); }}
        file={selectedInvoiceFile} onFileChange={selectInvoiceFile} jobs={jobs} onSubmit={uploadInvoice} busy={isUploading}
        error={uploadError} duplicate={uploadDuplicate} onViewDuplicate={viewUploadDuplicate} />
      {reviewingImport && <SupplierInvoiceReview key={reviewingImport.id} invoiceImport={reviewingImport} jobs={jobs}
        selectedJobId={reviewJobByImport[reviewingImport.id] || reviewingImport.jobId || ''}
        onSelectJob={(jobId) => { setReviewJobByImport((previous) => ({ ...previous, [reviewingImport.id]: jobId })); setReviewError(''); }}
        onApprove={(choices) => approveImport(reviewingImport, choices)} onReject={(reason) => rejectImport(reviewingImport, reason)}
        onTrustSender={() => trustInvoiceSender(reviewingImport)}
        trustedSender={Boolean(reviewingImport.extractedData?.senderRuleMatched) || senderRules.some((rule) =>
          rule.isActive !== false && rule.senderEmail.toLowerCase() === String(reviewingImport.senderEmail || '').toLowerCase()
          && rule.supplierKey === supplierRuleKey(reviewingImport.supplier))}
        onClose={() => { if (!supplierBusy.current) setReviewingImport(null); }}
        busyAction={busyImportId === reviewingImport.id ? busyImportAction : ''} error={reviewError}
        onViewPurchase={viewSupplierPurchase} />}
    </main>
  );
}
