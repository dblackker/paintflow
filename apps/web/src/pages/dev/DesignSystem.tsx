import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';

const colorRoles = [
  ['Primary', 'var(--md-sys-color-primary)', 'var(--md-sys-color-on-primary)'],
  ['Primary container', 'var(--md-sys-color-primary-container)', 'var(--md-sys-color-on-primary-container)'],
  ['Secondary container', 'var(--md-sys-color-secondary-container)', 'var(--md-sys-color-on-secondary-container)'],
  ['Surface', 'var(--md-sys-color-surface)', 'var(--md-sys-color-on-surface)'],
  ['Surface container', 'var(--md-sys-color-surface-container)', 'var(--md-sys-color-on-surface)'],
  ['Error container', 'var(--md-sys-color-error-container)', 'var(--md-sys-color-on-error-container)'],
];

const iconNames = ['plus', 'edit', 'trash', 'calendar', 'clock', 'mail', 'message', 'map-pin', 'more-horizontal', 'warning', 'settings', 'paint-bucket'];

export function DesignSystem() {
  return (
    <div className="mx-auto max-w-5xl py-6 sm:py-8">
      <div className="mb-6">
        <p className="pf-kicker">Developer only</p>
        <h1 className="pf-page-title">Design System</h1>
        <p className="pf-page-copy mt-2 max-w-2xl">
          PaintFlow uses Material-style color roles, rounded action controls, consistent Lucide icons, and compact mobile-first density.
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader title="Buttons" description="Use filled buttons for primary work, tonal/outlined for secondary work, and icon buttons for common visual actions." />
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button leftIcon={<Icon name="plus" className="h-4 w-4" />}>Primary</Button>
            <Button variant="secondary" leftIcon={<Icon name="calendar" className="h-4 w-4" />}>Secondary</Button>
            <Button variant="ghost" leftIcon={<Icon name="edit" className="h-4 w-4" />}>Text</Button>
            <Button variant="dangerSubtle" leftIcon={<Icon name="trash" className="h-4 w-4" />}>Subtle danger</Button>
          </div>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-icon btn-icon-filled" aria-label="Add"><Icon name="plus" className="h-5 w-5" /></button>
            <button type="button" className="btn-icon btn-icon-tonal" aria-label="Edit"><Icon name="edit" className="h-5 w-5" /></button>
            <button type="button" className="btn-icon btn-icon-outlined" aria-label="More"><Icon name="more-horizontal" className="h-5 w-5" /></button>
            <button type="button" className="btn-icon btn-icon-outlined btn-icon-danger" aria-label="Remove"><Icon name="trash" className="h-5 w-5" /></button>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader title="Icon Set" description="React surfaces use one Lucide-backed Icon component for consistent stroke, sizing, and accessibility." />
        <CardContent className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {iconNames.map((name) => (
            <div key={name} className="rounded-lg border border-[var(--pf-border)] bg-white p-3 text-center">
              <Icon name={name} className="mx-auto h-5 w-5 text-[var(--pf-primary)]" />
              <p className="pf-meta mt-2 truncate">{name}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader title="Color Roles" description="Prefer semantic role tokens over ad hoc colors." />
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {colorRoles.map(([label, background, color]) => (
            <div key={label} className="rounded-lg border border-[var(--pf-border)] p-4" style={{ background, color }}>
              <p className="pf-row-title" style={{ color }}>{label}</p>
              <p className="mt-2 text-xs" style={{ color }}>{background}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
