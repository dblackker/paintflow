import { ReactNode } from 'react';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';

type UpsellTone = 'info' | 'neutral' | 'success' | 'warning';
type UpsellCtaVariant = 'primary' | 'secondary' | 'ghost';

interface UpsellCardProps {
  eyebrow?: string;
  title: string;
  body: string;
  ctaText: string;
  onCta?: () => void;
  icon?: string;
  isLoading?: boolean;
  tone?: UpsellTone;
  compact?: boolean;
  ctaVariant?: UpsellCtaVariant;
  className?: string;
  children?: ReactNode;
}

const toneStyles: Record<UpsellTone, { shell: string; icon: string; eyebrow: string }> = {
  info: {
    shell: 'border-blue-100 bg-blue-50/70',
    icon: 'bg-white text-blue-700',
    eyebrow: 'text-blue-700',
  },
  neutral: {
    shell: 'border-gray-200 bg-white',
    icon: 'bg-gray-50 text-gray-700',
    eyebrow: 'text-gray-600',
  },
  success: {
    shell: 'border-emerald-100 bg-emerald-50/70',
    icon: 'bg-white text-emerald-700',
    eyebrow: 'text-emerald-700',
  },
  warning: {
    shell: 'border-amber-100 bg-amber-50/80',
    icon: 'bg-white text-amber-700',
    eyebrow: 'text-amber-700',
  },
};

export function UpsellCard({
  eyebrow,
  title,
  body,
  ctaText,
  onCta,
  icon = 'bell',
  isLoading = false,
  tone = 'info',
  compact = false,
  ctaVariant = 'secondary',
  className = '',
  children,
}: UpsellCardProps) {
  const styles = toneStyles[tone];
  const padding = compact ? 'p-3 sm:p-4' : 'p-4 sm:p-5';
  const titleClass = compact ? 'pf-emphasis mt-0.5' : 'pf-section-title mt-1';

  return (
    <section className={`rounded-lg border shadow-sm ${styles.shell} ${padding} ${className}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-sm ${styles.icon}`}>
            <Icon name={icon} className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            {eyebrow && <p className={`pf-meta font-medium ${styles.eyebrow}`}>{eyebrow}</p>}
            <h2 className={titleClass}>{title}</h2>
            <p className="pf-copy mt-1 max-w-2xl">{body}</p>
            {children}
          </div>
        </div>
        <Button type="button" variant={ctaVariant} size="sm" onClick={onCta} isLoading={isLoading} className="shrink-0">
          {ctaText}
        </Button>
      </div>
    </section>
  );
}
