import { ReactNode } from 'react';

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple';
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({ 
  children, 
  variant = 'default', 
  size = 'md',
  className = '' 
}: BadgeProps) {
  const variants = {
    default: 'pf-status-neutral',
    success: 'pf-status-success',
    warning: 'pf-status-warning',
    danger: 'pf-status-danger',
    info: 'pf-status-info',
    purple: 'pf-status-purple',
  };
  
  const sizes = {
    sm: 'pf-status-sm',
    md: '',
  };
  
  return (
    <span className={`pf-status ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </span>
  );
}

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const statusConfig: Record<string, { variant: BadgeProps['variant']; label: string }> = {
    draft: { variant: 'default', label: 'Draft' },
    sent: { variant: 'info', label: 'Sent' },
    viewed: { variant: 'info', label: 'Viewed' },
    approved: { variant: 'success', label: 'Approved' },
    accepted: { variant: 'success', label: 'Accepted' },
    signed: { variant: 'success', label: 'Signed' },
    rejected: { variant: 'danger', label: 'Rejected' },
    declined: { variant: 'danger', label: 'Declined' },
    voided: { variant: 'danger', label: 'Voided' },
    in_progress: { variant: 'warning', label: 'In Progress' },
    completed: { variant: 'success', label: 'Completed' },
    cancelled: { variant: 'default', label: 'Cancelled' },
    canceled: { variant: 'default', label: 'Canceled' },
    on_hold: { variant: 'warning', label: 'On Hold' },
    scheduled: { variant: 'info', label: 'Scheduled' },
    deposit_pending: { variant: 'warning', label: 'Deposit Pending' },
    payment_pending: { variant: 'warning', label: 'Payment Pending' },
    partially_paid: { variant: 'warning', label: 'Partially Paid' },
    paid: { variant: 'success', label: 'Paid' },
    active: { variant: 'success', label: 'Active' },
    inactive: { variant: 'default', label: 'Inactive' },
    won: { variant: 'success', label: 'Won' },
    lost: { variant: 'danger', label: 'Lost' },
    new: { variant: 'info', label: 'New' },
    contacted: { variant: 'warning', label: 'Contacted' },
    qualified: { variant: 'success', label: 'Qualified' },
    estimate_sent: { variant: 'info', label: 'Estimate Sent' },
  };
  
  const config = statusConfig[status.toLowerCase()] || {
    variant: 'default',
    label: status.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
  };
  
  return (
    <Badge variant={config.variant} className={className}>
      {config.label}
    </Badge>
  );
}
