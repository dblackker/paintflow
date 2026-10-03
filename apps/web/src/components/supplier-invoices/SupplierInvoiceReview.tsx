import { useId, useState } from 'react';
import { Badge, StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Select, Textarea } from '@/components/Input';
import { Modal, ModalFooter } from '@/components/Modal';
import { formatMoney } from '@/lib/api';
import { SupplierFileLink } from './SupplierFileLink';
import { importFilePath, itemTitle, supplierDate, supplierJobLabel } from './types';
import type { InvoiceImport, SupplierJob } from './types';

export interface SupplierReviewChoices {
  applyMaterialUpdates: boolean;
  confirmSimilarPurchase: boolean;
}

export function SupplierReviewCard({ invoiceImport, onReview }: { invoiceImport: InvoiceImport; onReview: () => void }) {
  return <article className="min-w-0 border-b border-gray-200 py-3" data-testid={`supplier-review-${invoiceImport.id}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="pf-row-title break-words">{invoiceImport.supplier || 'Supplier invoice'}</p>
        <p className="pf-meta mt-1 break-words">Invoice {invoiceImport.invoiceNumber || 'not detected'} · {supplierDate(invoiceImport.invoiceDate)}</p>
        <p className="pf-value mt-1">{formatMoney(invoiceImport.totalAmount)}</p>
        {invoiceImport.extractedData?.possibleDuplicatePurchaseId && <Badge variant="warning" size="sm">Possible duplicate</Badge>}
      </div>
      <Button variant="secondary" className="!min-h-12 !min-w-12 shrink-0" onClick={onReview}>Review</Button>
    </div>
  </article>;
}

export function SupplierInvoiceReview({
  invoiceImport, jobs, selectedJobId, onSelectJob, onApprove, onReject, onClose,
  busyAction, error, onTrustSender, trustedSender, onViewPurchase,
}: {
  invoiceImport: InvoiceImport;
  jobs: SupplierJob[];
  selectedJobId: string;
  onSelectJob: (id: string) => void;
  onApprove: (choices: SupplierReviewChoices) => void;
  onReject: (reason: string) => void;
  onClose: () => void;
  busyAction: '' | 'approve' | 'reject' | 'trust';
  error?: string;
  onTrustSender: () => void;
  trustedSender: boolean;
  onViewPurchase: (id: string) => void;
}) {
  const [applyMaterialUpdates, setApplyMaterialUpdates] = useState(true);
  const [confirmSimilarPurchase, setConfirmSimilarPurchase] = useState(false);
  const [showLines, setShowLines] = useState(false);
  const [rejectRequested, setRejectRequested] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const duplicateId = useId();
  const requiredJobId = useId();
  const items = invoiceImport.extractedItems || [];
  const filePath = importFilePath(invoiceImport);
  const pending = invoiceImport.status === 'needs_review';
  const possibleDuplicate = invoiceImport.extractedData?.possibleDuplicatePurchaseId;
  const busy = Boolean(busyAction);
  const reconciliation = invoiceImport.extractedData?.documentReconciliation;
  const totalsBlocked = reconciliation?.status === 'mismatch' || Boolean(reconciliation?.required && reconciliation.status !== 'matched');
  const canApprove = !totalsBlocked && jobs.some((job) => job.id === selectedJobId) && (!possibleDuplicate || confirmSimilarPurchase);
  const suggestions = (invoiceImport.matchCandidates || []).filter((candidate) => jobs.some((job) => job.id === candidate.id)).slice(0, 3);
  const hasPaint = items.some((item) => !item.isFee && (item.sku || item.salesNumber || item.productCode));
  const confidence = Number(invoiceImport.extractionConfidence);

  return <Modal isOpen onClose={() => { if (!busy) onClose(); }} size="lg" title={pending ? 'Review supplier invoice' : 'Supplier invoice record'} closeOnBackdrop={false} closeOnEscape={!busy}>
    <div className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="pf-row-title break-words">{invoiceImport.supplier || 'Supplier invoice'}</p>
          <p className="pf-meta mt-1 break-words">Invoice {invoiceImport.invoiceNumber || 'not detected'} · {supplierDate(invoiceImport.invoiceDate)}</p>
          <StatusBadge status={invoiceImport.status} />
        </div>
        <p className="pf-section-title">{formatMoney(invoiceImport.totalAmount)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 pb-3">
        <Icon name="file-text" className="h-6 w-6 shrink-0" />
        <p className="pf-copy min-w-0 flex-1 break-words">{invoiceImport.extractedData?.fileName || 'Original invoice'}</p>
        {filePath ? <SupplierFileLink path={filePath} /> : <p className="pf-helper">Original file not retained.</p>}
      </div>
      {error && <p className="pf-field-error" role="alert">{error}</p>}
      {pending && totalsBlocked && <div role="alert" className="pf-field-error">
        <p>Charge totals need review. Compare the original file, then upload a complete invoice.</p>
        {reconciliation?.documentTotal != null && <p>Document: {formatMoney(reconciliation.documentTotal)} · Extracted lines: {formatMoney(reconciliation.lineTotal)}</p>}
      </div>}
      {pending && <>
        {possibleDuplicate && <div className="space-y-2 border-l-4 border-amber-500 pl-3">
          <p className="pf-row-title">Possible duplicate purchase</p>
          <p className="pf-helper">This supplier and invoice number already appear in purchase history. Compare both files before adding another purchase.</p>
          <Button variant="ghost" className="!min-h-12 !min-w-12" onClick={() => onViewPurchase(possibleDuplicate)}>View existing purchase</Button>
          <label htmlFor={duplicateId} className="pf-copy flex !min-h-12 cursor-pointer items-center gap-3">
            <input id={duplicateId} type="checkbox" checked={confirmSimilarPurchase} disabled={busy} onChange={(event) => setConfirmSimilarPurchase(event.target.checked)} className="h-5 w-5 shrink-0" />
            <span>This is a separate purchase.</span>
          </label>
        </div>}
        <Select label="Job" value={selectedJobId} onChange={(event) => onSelectJob(event.target.value)} disabled={busy} required className="!min-h-12"
          aria-describedby={!selectedJobId ? requiredJobId : undefined}>
          <option value="">Select a job</option>
          {jobs.map((job) => <option key={job.id} value={job.id}>{supplierJobLabel(job)}</option>)}
        </Select>
        {!selectedJobId && <p id={requiredJobId} className="pf-helper">Choose a job before approving. Costs will be added to that job.</p>}
        {!selectedJobId && suggestions.length > 0 && <div className="space-y-1">
          <p className="pf-meta">Suggested jobs</p>
          {suggestions.map((job) => <Button key={job.id} variant="ghost" fullWidth className="!min-h-12 whitespace-normal text-left justify-start" disabled={busy} onClick={() => onSelectJob(job.id)}>
            <span className="block min-w-0 break-words">{supplierJobLabel(job)}</span>
          </Button>)}
        </div>}
        {Number.isFinite(confidence) && confidence > 0 && confidence < 0.8 && <p className="pf-helper flex gap-2"><Icon name="warning" className="h-5 w-5 shrink-0" />Check the extracted lines against the original file.</p>}
      </>}
      <div className="border-t border-gray-200 pt-2">
        <Button variant="ghost" className="!min-h-12 !min-w-12" aria-expanded={showLines} onClick={() => setShowLines((value) => !value)}>
          {showLines ? 'Hide' : 'View'} {items.length} line{items.length === 1 ? '' : 's'}
        </Button>
        {showLines && <ul className="divide-y divide-gray-200">
          {items.map((item, index) => <li key={index} className="min-w-0 py-3">
            <div className="flex items-start justify-between gap-3">
              <p className="pf-copy min-w-0 break-words">{itemTitle(item)}</p>
              <p className="pf-value shrink-0">{formatMoney(item.total)}</p>
            </div>
            <p className="pf-meta mt-1 break-words">{[
              item.isFee ? 'Fee' : '', item.quantity != null ? `Qty ${item.quantity}` : '', item.size,
              item.gallons != null ? `${item.gallons} gal` : '', item.pricePerGallon != null ? `${formatMoney(item.pricePerGallon)}/gal` : '',
              item.productCode || item.sku || item.salesNumber, item.colorName, item.colorCode,
            ].filter(Boolean).join(' · ')}</p>
          </li>)}
        </ul>}
      </div>
      {pending && hasPaint && <label className="pf-copy flex !min-h-12 cursor-pointer items-center gap-3">
        <input type="checkbox" className="h-5 w-5 shrink-0" checked={applyMaterialUpdates} disabled={busy} onChange={(event) => setApplyMaterialUpdates(event.target.checked)} />
        <span>Update matching product prices.</span>
      </label>}
      {pending && invoiceImport.senderEmail && !trustedSender && <div className="border-t border-gray-200 pt-2">
        <p className="pf-meta break-all">Forwarded by {invoiceImport.senderEmail}</p>
        <Button variant="ghost" className="!min-h-12 !min-w-12" disabled={busy} isLoading={busyAction === 'trust'} onClick={onTrustSender}>Trust sender</Button>
      </div>}
      {!pending && invoiceImport.materialPurchaseId && <Button variant="secondary" className="!min-h-12 !min-w-12" onClick={() => onViewPurchase(invoiceImport.materialPurchaseId!)}>View purchase history</Button>}
      {pending && rejectRequested && <div className="space-y-2 border-t border-gray-200 pt-3">
        <p className="pf-row-title">Reject this invoice?</p>
        <p className="pf-helper">The original file stays in history. No costs will be added.</p>
        <Textarea label="Reason (optional)" value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} disabled={busy} maxLength={500} rows={2} />
      </div>}
      <ModalFooter className="!grid grid-cols-2 gap-2 sm:!flex sm:flex-wrap">
        {pending && rejectRequested ? <>
          <Button variant="ghost" className="!min-h-12 !min-w-12" disabled={busy} onClick={() => setRejectRequested(false)}>Keep invoice</Button>
          <Button variant="dangerSubtle" className="!min-h-12 !min-w-12 flex-1" disabled={busy} isLoading={busyAction === 'reject'} onClick={() => onReject(rejectReason)}>Reject invoice</Button>
        </> : pending ? <>
          <Button variant="ghost" className="!min-h-12 !min-w-12" disabled={busy} onClick={onClose}>Keep for later</Button>
          <Button variant="dangerSubtle" className="!min-h-12 !min-w-12" disabled={busy} onClick={() => setRejectRequested(true)}>Reject</Button>
          <Button className="!min-h-12 !min-w-12 col-span-2 flex-1" disabled={!canApprove || busy} isLoading={busyAction === 'approve'} onClick={() => onApprove({ applyMaterialUpdates: hasPaint && applyMaterialUpdates, confirmSimilarPurchase })}>Approve invoice</Button>
        </> : <Button className="!min-h-12 !min-w-12 col-span-2" onClick={onClose}>Done</Button>}
      </ModalFooter>
    </div>
  </Modal>;
}
