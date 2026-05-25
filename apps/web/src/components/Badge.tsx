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
    default: 'bg-gray-100 text-gray-800',
    success: 'bg-green-100 text-green-800',
    warning: 'bg-yellow-100 text-yellow-800',
    danger: 'bg-red-100 text-red-800',
    info: 'bg-blue-100 text-blue-800',
    purple: 'bg-purple-100 text-purple-800',
  };
  
  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-0.5 text-xs',
  };
  
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${variants[variant]} ${sizes[size]} ${className}`}>
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
