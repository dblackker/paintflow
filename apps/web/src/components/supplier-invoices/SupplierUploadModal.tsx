import { FormEvent, useId } from 'react';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal, ModalFooter } from '@/components/Modal';
import { SupplierFileLink } from './SupplierFileLink';
import { importFilePath, supplierDate, supplierJobLabel } from './types';
import type { InvoiceImport, MaterialPurchase, SupplierJob } from './types';

export interface SupplierUploadForm {
  supplier: string;
  invoiceNumber: string;
  jobId: string;
  senderEmail: string;
}

export interface DuplicateInvoiceContext {
  type: 'import' | 'purchase';
  record: InvoiceImport | MaterialPurchase;
}

export function DuplicateInvoiceNotice({ duplicate, onView }: { duplicate: DuplicateInvoiceContext; onView: () => void }) {
  const record = duplicate.record;
  const invoiceImport = duplicate.type === 'import' ? record as InvoiceImport : null;
  const filePath = invoiceImport ? importFilePath(invoiceImport) : (record as MaterialPurchase).fileUrl || '';
  const state = invoiceImport?.status;
  return <div className="space-y-2 border-l-4 border-amber-500 pl-3" role="status">
    <p className="pf-row-title">{state === 'needs_review' ? 'This file is already in review.' : state === 'rejected' ? 'This file was previously rejected.' : 'This file was already imported.'}</p>
    <p className="pf-helper">No second purchase was added. Invoice {record.invoiceNumber || 'not set'} · {supplierDate(record.invoiceDate || record.createdAt)}</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" className="!min-h-12 !min-w-12" onClick={onView}>{state === 'needs_review' ? 'Review existing invoice' : 'View record'}</Button>
      {filePath && <SupplierFileLink path={filePath} />}
    </div>
  </div>;
}

export function SupplierUploadModal({
  isOpen, onClose, form, onFormChange, file, onFileChange, jobs, onSubmit, busy, error, duplicate, onViewDuplicate,
}: {
  isOpen: boolean;
  onClose: () => void;
  form: SupplierUploadForm;
  onFormChange: (form: SupplierUploadForm) => void;
  file: File | null;
  onFileChange: (file: File | null) => void;
  jobs: SupplierJob[];
  onSubmit: (event: FormEvent) => void;
  busy: boolean;
  error?: string;
  duplicate?: DuplicateInvoiceContext | null;
  onViewDuplicate: () => void;
}) {
  const fileId = useId();
  const helpId = `${fileId}-help`;
  const errorId = `${fileId}-error`;
  return <Modal isOpen={isOpen} onClose={() => { if (!busy) onClose(); }} title="Upload supplier invoice" size="md" closeOnBackdrop={false} closeOnEscape={!busy}>
    <form className="space-y-4 min-w-0" onSubmit={onSubmit}>
      <div>
        <label htmlFor={fileId} className="pf-field-label">Invoice file</label>
        <input id={fileId} className="pf-input-control !min-h-12 w-full" type="file" disabled={busy}
          accept="application/pdf,image/png,image/jpeg,image/webp" aria-invalid={Boolean(error && !file) || undefined}
          aria-describedby={`${helpId}${error ? ` ${errorId}` : ''}`}
          onChange={(event) => onFileChange(event.target.files?.[0] || null)} />
        <p id={helpId} className="pf-helper mt-1">PDF, JPG, PNG or WebP. Up to 15 MB.</p>
        {file && <p className="pf-copy mt-2 break-words">{file.name}</p>}
      </div>
      {error && <p id={errorId} className="pf-field-error" role="alert">{error}</p>}
      {duplicate && <DuplicateInvoiceNotice duplicate={duplicate} onView={onViewDuplicate} />}
      <details>
        <summary className="pf-copy !min-h-12 cursor-pointer py-3">Optional details</summary>
        <div className="space-y-3 pt-2">
          <Select label="Supplier" disabled={busy} value={form.supplier} onChange={(event) => onFormChange({ ...form, supplier: event.target.value })}>
            <option value="">Detect from file</option>
            {['Sherwin-Williams', 'Benjamin Moore', 'Home Depot', 'Lowes', 'Other'].map((supplier) => <option key={supplier}>{supplier}</option>)}
          </Select>
          <Input label="Invoice number" autoComplete="off" enterKeyHint="next" disabled={busy} value={form.invoiceNumber} onChange={(event) => onFormChange({ ...form, invoiceNumber: event.target.value })} />
          <Select label="Suggested job" disabled={busy} value={form.jobId} onChange={(event) => onFormChange({ ...form, jobId: event.target.value })}>
            <option value="">Suggest from file</option>
            {jobs.map((job) => <option key={job.id} value={job.id}>{supplierJobLabel(job)}</option>)}
          </Select>
          <Input label="Sender email" type="email" autoComplete="email" disabled={busy} value={form.senderEmail} onChange={(event) => onFormChange({ ...form, senderEmail: event.target.value })} />
        </div>
      </details>
      <p className="pf-helper">Costs are only added after you review and approve.</p>
      <ModalFooter className="flex flex-wrap gap-2">
        <Button variant="ghost" className="!min-h-12 !min-w-12" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button type="submit" className="!min-h-12 !min-w-12 flex-1" isLoading={busy} disabled={!file || busy || Boolean(duplicate)}>Stage for review</Button>
      </ModalFooter>
    </form>
  </Modal>;
}
