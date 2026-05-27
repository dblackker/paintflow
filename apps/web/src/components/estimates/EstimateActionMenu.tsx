import { Link } from 'react-router-dom';
import { Icon } from '@/components/Icon';

export interface EstimateActionMenuPayment {
  amount?: number | string | null;
  refundedAmount?: number | string | null;
  status?: string | null;
}

export interface EstimateActionMenuEstimate {
  id: string;
  status?: string | null;
  signedAt?: string | null;
  total?: number | string | null;
  packages?: Array<{ name?: string; total?: number | string; subtotal?: number | string }> | null;
  payments?: EstimateActionMenuPayment[] | null;
  customerPreviewUrl?: string | null;
  publicUrl?: string | null;
}

export type EstimateActionType = 'payment' | 'cancel' | 'revise' | 'void';

interface EstimateActionDefinition {
  key: string;
  label: string;
  href?: string;
  destructive?: boolean;
  priority?: boolean;
  action?: EstimateActionType;
}

interface EstimateActionMenuProps {
  estimate: EstimateActionMenuEstimate;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (estimate: EstimateActionMenuEstimate, action: EstimateActionType) => void;
  align?: 'left' | 'right';
}

function estimateTotal(estimate: EstimateActionMenuEstimate) {
  const proposal = estimate.packages?.find((item) => item.name === 'proposal')
    || estimate.packages?.find((item) => /better|recommended/i.test(String(item.name || '')))
    || estimate.packages?.[0];
  return Number(proposal?.total ?? proposal?.subtotal ?? estimate.total ?? 0);
}

function netPaid(payments: EstimateActionMenuPayment[] = []) {
  return payments.reduce((sum, payment) => {
    const status = String(payment.status || '');
    if (!['succeeded', 'paid', 'partially_refunded', 'refunded'].includes(status)) return sum;
    return sum + Number(payment.amount || 0) - Number(payment.refundedAmount || 0);
  }, 0);
}

function estimateBalance(estimate: EstimateActionMenuEstimate) {
  return Math.max(estimateTotal(estimate) - netPaid(estimate.payments || []), 0);
}

function previewHref(estimate: EstimateActionMenuEstimate) {
  return new URL(estimate.customerPreviewUrl || estimate.publicUrl || `/estimates/${estimate.id}`, window.location.origin).pathname;
}

function buildActions(estimate: EstimateActionMenuEstimate) {
  const status = String(estimate.status || '').toLowerCase();
  const canCancel = ['draft', 'sent', 'declined'].includes(status) && !estimate.signedAt;
  const canEdit = status === 'draft' || (status === 'sent' && !estimate.signedAt);
  const isSignedAgreement = Boolean(estimate.signedAt) || status === 'accepted';
  const canReviseAgreement = isSignedAgreement && status === 'accepted';
  const canVoidAgreement = isSignedAgreement && status === 'accepted';
  const isInactiveAgreement = ['canceled', 'voided', 'superseded'].includes(status);
  const canPreview = !['draft', 'canceled'].includes(status);
  const canRecordPayment = estimate.id && !['draft', 'canceled', 'voided', 'superseded'].includes(status) && estimateBalance(estimate) > 0.005;
  const actions: EstimateActionDefinition[] = [];

  if (isInactiveAgreement) actions.push({ key: 'details', label: 'View details', href: `/estimates/${estimate.id}/details`, priority: true });
  if (canEdit) actions.push({ key: 'edit', label: status === 'sent' ? 'Edit sent' : 'Edit draft', href: `/estimates/production?estimateId=${estimate.id}`, priority: true });
  if (canPreview) actions.push({ key: 'preview', label: 'Preview link', href: previewHref(estimate), priority: !canEdit });
  if (canRecordPayment) actions.push({ key: 'payment', label: 'Record payment', action: 'payment' });
  if (canReviseAgreement) actions.push({ key: 'revise', label: 'Create revision', action: 'revise' });
  if (canCancel) actions.push({ key: 'cancel', label: 'Cancel', action: 'cancel', destructive: true });
  if (canVoidAgreement) actions.push({ key: 'void', label: 'Void agreement', action: 'void', destructive: true });

  const primary = actions.find((action) => action.priority) || actions[0];
  const overflow = actions
    .filter((action) => action !== primary)
    .sort((a, b) => Number(Boolean(a.destructive)) - Number(Boolean(b.destructive)));
  return { primary, overflow };
}

export function EstimateActionMenu({ estimate, isOpen, onOpenChange, onAction, align = 'right' }: EstimateActionMenuProps) {
  const actions = buildActions(estimate);
  if (!actions.primary && !actions.overflow.length) return null;

  return (
    <div className="relative flex items-center justify-end gap-1">
      {actions.primary && <ActionButton action={actions.primary} estimate={estimate} onAction={onAction} />}
      {actions.overflow.length > 0 && (
        <>
          <button
            type="button"
            className="btn-icon btn-icon-tonal pf-estimate-menu-button"
            aria-label="More estimate actions"
            aria-expanded={isOpen}
            onClick={() => onOpenChange(!isOpen)}
          >
            <Icon name="more-horizontal" className="h-4 w-4" />
          </button>
          {isOpen && (
            <div className={`absolute top-full z-30 mt-2 min-w-44 rounded-lg border bg-white p-1 text-left shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}>
              <div className="grid gap-1">
                {actions.overflow.map((action) => <ActionButton key={action.key} action={action} estimate={estimate} onAction={onAction} inMenu />)}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ActionButton({
  action,
  estimate,
  onAction,
  inMenu = false,
}: {
  action: EstimateActionDefinition;
  estimate: EstimateActionMenuEstimate;
  onAction: (estimate: EstimateActionMenuEstimate, action: EstimateActionType) => void;
  inMenu?: boolean;
}) {
  const className = `btn-text btn-sm ${action.destructive ? 'text-red-700' : ''} ${inMenu ? 'w-full justify-start' : 'justify-center'}`;
  if (action.href) {
    const external = action.key === 'preview';
    return external ? (
      <a href={action.href} target="_blank" rel="noreferrer" className={className}>{action.label}</a>
    ) : (
      <Link to={action.href} className={className}>{action.label}</Link>
    );
  }
  if (!action.action) return null;
  return <button type="button" className={className} onClick={() => onAction(estimate, action.action!)}>{action.label}</button>;
}
