import { ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';

interface UpsellCardProps {
  eyebrow?: string;
  title: string;
  body: string;
  ctaText: string;
  onCta?: () => void;
  icon?: string;
  isLoading?: boolean;
  children?: ReactNode;
}

export function UpsellCard({
  eyebrow,
  title,
  body,
  ctaText,
  onCta,
  icon = 'bell',
  isLoading = false,
  children,
}: UpsellCardProps) {
  return (
    <section className="rounded-lg border border-blue-100 bg-blue-50/70 p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-blue-700 shadow-sm">
            <Icon name={icon} className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            {eyebrow && <p className="pf-meta font-medium text-blue-700">{eyebrow}</p>}
            <h2 className="pf-section-title mt-1">{title}</h2>
            <p className="pf-copy mt-1 max-w-2xl">{body}</p>
            {children}
          </div>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={onCta} isLoading={isLoading} className="shrink-0">
          {ctaText}
        </Button>
      </div>
    </section>
  );
}
