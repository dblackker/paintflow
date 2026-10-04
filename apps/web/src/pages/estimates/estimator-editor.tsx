import { type ReactNode } from 'react';
import { ChevronDown, Copy, Pencil, Trash2 } from 'lucide-react';
import { Modal, ModalFooter } from '@/components/Modal';

export function EstimatorRoomRow({ name, count, hours, price, expanded, onExpand, onEdit, onDuplicate, onDelete, children }: {
  name: string; count: number; hours: string; price: string; expanded: boolean;
  onExpand: () => void; onEdit: () => void; onDuplicate: () => void; onDelete: () => void; children: ReactNode;
}) {
  return <section className="border-b py-2" data-testid="estimator-room">
    <div className="flex min-w-0 items-center gap-1">
      <button className="btn-text estimator-disclosure flex min-h-12 min-w-0 flex-1 items-center gap-2 text-left" aria-expanded={expanded} aria-label={`Expand ${name}`} onClick={onExpand}>
        <ChevronDown aria-hidden="true" className={`h-5 w-5 shrink-0 ${expanded ? 'rotate-180' : ''}`} />
        <span className="min-w-0 flex-1"><span className="pf-row-title block break-words">{name}</span><span className="pf-meta block">{count} substrates · {hours} hr · {price}</span></span>
      </button>
      <button className="btn-icon" aria-label={`Edit ${name}`} title="Edit room and metrics" onClick={onEdit}><Pencil className="h-5 w-5" /></button>
      <button className="btn-icon" aria-label={`Duplicate ${name}`} title="Duplicate room" onClick={onDuplicate}><Copy className="h-5 w-5" /></button>
      <button className="btn-icon btn-icon-danger" aria-label={`Delete ${name}`} title="Delete room" onClick={onDelete}><Trash2 className="h-5 w-5" /></button>
    </div>
    {expanded && <div className="mt-2 min-w-0 border-t">{children}</div>}
  </section>;
}

export function EstimatorEditSheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  return <Modal isOpen={open} onClose={onClose} title={title} size="lg">
    <div className="estimator-editor" onFocusCapture={(event) => {
      const control = event.target;
      if (control instanceof HTMLElement) requestAnimationFrame(() => control.scrollIntoView({ block: 'nearest' }));
    }}>{children}</div>
    <ModalFooter><button className="btn-primary min-h-12 w-full sm:w-auto" onClick={onClose}>Done editing</button></ModalFooter>
  </Modal>;
}

export function EstimatorGroup({ title, open = false, children }: { title: string; open?: boolean; children: ReactNode }) {
  return <details className="border-t py-2" open={open || undefined}>
    <summary className="pf-row-title flex min-h-12 cursor-pointer items-center gap-2"><ChevronDown className="h-4 w-4" aria-hidden="true" />{title}</summary>
    <div className="min-w-0 space-y-3 pb-3">{children}</div>
  </details>;
}

export function EstimatorStyles() {
  return <style>{`
    .estimator-editor :is(input:not([type=checkbox]),select,textarea), .estimator-page :is(input:not([type=checkbox]),select,textarea) { min-height:48px; min-width:0; max-width:100%; }
    .estimator-editor :is(button,.pf-inline-option,summary), .estimator-page :is(button,a.btn-secondary,.pf-inline-option) { min-height:48px; }
    .estimator-page .btn-icon { min-width:48px; width:48px; flex-shrink:0; }
    .estimator-page .estimator-disclosure { justify-content:flex-start; color:inherit; border-radius:8px; padding:4px; text-align:left; }
    .estimator-product-summary { display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; overflow-wrap:anywhere; }
    .estimator-editor .pf-inline-option { padding:8px 0; }
    .estimator-editor p, .estimator-page .pf-value { overflow-wrap:anywhere; }
    .estimator-editor select { text-overflow:ellipsis; }
    .estimator-page > div, .estimator-editor label { min-width:0; }
    .estimator-actions { position:sticky; bottom:calc(4rem + env(safe-area-inset-bottom)); z-index:30; background:var(--pf-card-surface); border-top:1px solid var(--pf-border); padding:8px; }
    .pf-dialog-panel:has(.estimator-editor) { height:min(840px,100%); }
    .pf-dialog-panel:has(.estimator-editor) .pf-dialog-content { display:flex; flex:1; flex-direction:column; overflow:hidden; padding:0; }
    .pf-dialog-panel:has(.estimator-editor) .estimator-editor { flex:1; min-height:0; overflow-y:auto; padding:var(--pf-dialog-gutter); scroll-padding-block:1rem; overscroll-behavior:contain; }
    .pf-dialog-panel:has(.estimator-editor) .pf-dialog-footer { flex:0 0 auto; margin-top:0; margin-inline:0 !important; }
    .pf-dialog-panel:has(.estimator-editor) button { min-height:48px; }
    @media (max-width:639px) {
      .pf-dialog-panel:has(.estimator-editor) { height:100%; border-radius:8px 8px 0 0; }
      .pf-dialog-panel:has(.estimator-editor) .pf-dialog-content { flex:1; }
      .estimator-editor .grid { grid-template-columns:minmax(0,1fr); }
    }
    @media (min-width:1024px) { .estimator-actions { display:none; } }
  `}</style>;
}
