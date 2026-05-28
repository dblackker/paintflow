import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface ActivityTimelineItem {
  id: string;
  title: string;
  meta?: string;
  description?: string;
  href?: string;
  tone?: 'default' | 'info' | 'warning' | 'danger' | 'success';
  accessory?: ReactNode;
}

interface ActivityTimelineProps {
  items: ActivityTimelineItem[];
  className?: string;
  empty?: ReactNode;
}

const toneStyles = {
  default: 'border-gray-900 bg-gray-900',
  info: 'border-blue-600 bg-blue-600',
  warning: 'border-amber-500 bg-amber-500',
  danger: 'border-red-600 bg-red-600',
  success: 'border-emerald-600 bg-emerald-600',
};

export function ActivityTimeline({ items, className = '', empty }: ActivityTimelineProps) {
  if (!items.length) return empty ? <>{empty}</> : null;

  return (
    <ol className={`space-y-0 ${className}`}>
      {items.map((item, index) => {
        const tone = item.tone || (index === 0 ? 'info' : 'default');
        const content = (
          <>
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className={`pf-row-title ${tone === 'danger' ? 'text-red-700' : ''}`}>{item.title}</p>
                {item.meta && <p className="pf-meta mt-0.5">{item.meta}</p>}
              </div>
              {item.accessory}
            </div>
            {item.description && <p className="pf-copy mt-2 truncate">{item.description}</p>}
          </>
        );

        return (
          <li key={item.id} className="relative grid grid-cols-[1rem_minmax(0,1fr)] gap-4 pb-5 last:pb-0">
            <div className="relative flex justify-center">
              {index < items.length - 1 && <span className="absolute top-4 h-full w-px bg-gray-200" aria-hidden="true" />}
              <span className={`relative mt-1 h-2 w-2 rounded-full border ${toneStyles[tone]}`} aria-hidden="true" />
            </div>
            {item.href ? (
              <Link to={item.href} className="-mt-1 block min-w-0 rounded-lg p-1.5 transition hover:bg-blue-50">
                {content}
              </Link>
            ) : (
              <div className="-mt-1 min-w-0 p-1.5">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
