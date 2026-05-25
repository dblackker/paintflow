import { isValidElement, ReactNode } from 'react';
import { Button } from './Button';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  } | ReactNode;
  className?: string;
}

export function EmptyState({ 
  icon, 
  title, 
  description, 
  action,
  className = '' 
}: EmptyStateProps) {
  const actionConfig = action && !isValidElement(action) && typeof action === 'object' && 'label' in action
    ? action as { label: string; onClick: () => void }
    : null;

  return (
    <div className={`text-center py-12 ${className}`}>
      {icon && (
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 mb-4">
          <div className="text-gray-400">
            {icon}
          </div>
        </div>
      )}
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {description && (
        <p className="mt-1 text-sm text-gray-500 max-w-sm mx-auto">
          {description}
        </p>
      )}
      {action && !actionConfig && (
        <div className="mt-6">
          {action as ReactNode}
        </div>
      )}
      {actionConfig && (
        <div className="mt-6">
          <Button onClick={actionConfig.onClick}>
            {actionConfig.label}
          </Button>
        </div>
      )}
    </div>
  );
}
