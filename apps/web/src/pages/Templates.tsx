import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { apiJson } from '@/lib/api';

interface TemplateRoom {
  id?: string;
  name?: string | null;
  length?: number | string | null;
  width?: number | string | null;
  surfaces?: unknown[];
}

interface EstimateTemplate {
  id: string;
  name?: string | null;
  description?: string | null;
  isShared?: boolean | null;
  usageCount?: number | string | null;
  rooms?: TemplateRoom[];
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function TemplateSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[0, 1, 2, 3].map((item) => (
        <Card key={item} className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="h-6 w-16 animate-pulse rounded-full bg-gray-100" />
          </div>
          <div className="h-14 animate-pulse rounded-lg bg-gray-50" />
          <div className="flex gap-2">
            <div className="h-8 flex-1 animate-pulse rounded bg-gray-100" />
            <div className="h-8 w-20 animate-pulse rounded bg-gray-100" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function roomDimensionsSummary(rooms: TemplateRoom[]) {
  return rooms
    .filter((room) => numberValue(room.length) > 0 && numberValue(room.width) > 0)
    .map((room) => `${room.name || 'Room'}: ${numberValue(room.length)} x ${numberValue(room.width)}`)
    .join(' · ');
}

function surfaceCount(rooms: TemplateRoom[]) {
  return rooms.reduce((sum, room) => sum + (Array.isArray(room.surfaces) ? room.surfaces.length : 0), 0);
}

function TemplateCard({
  template,
  onUse,
  onDelete,
  isUsing,
  isDeleting,
}: {
  template: EstimateTemplate;
  onUse: (template: EstimateTemplate) => void;
  onDelete: (template: EstimateTemplate) => void;
  isUsing: boolean;
  isDeleting: boolean;
}) {
  const rooms = template.rooms || [];
  const dimensions = roomDimensionsSummary(rooms);

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="pf-section-title">{template.name || 'Estimate template'}</p>
          {template.description && <p className="pf-copy mt-1">{template.description}</p>}
        </div>
        {template.isShared && <Badge variant="info" size="sm">Built-in</Badge>}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="pf-meta">Rooms</p>
          <p className="pf-emphasis">{rooms.length}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="pf-meta">Substrates</p>
          <p className="pf-emphasis">{surfaceCount(rooms)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="pf-meta">Used</p>
          <p className="pf-emphasis">{numberValue(template.usageCount)}x</p>
        </div>
      </div>

      {dimensions && (
        <p className="pf-helper rounded-lg bg-gray-50 px-3 py-2">{dimensions}</p>
      )}

      <div className="mt-auto flex gap-2">
        <Button type="button" size="sm" fullWidth isLoading={isUsing} onClick={() => onUse(template)}>
          Use template
        </Button>
        {!template.isShared && (
          <Button type="button" variant="secondary" size="sm" isLoading={isDeleting} onClick={() => onDelete(template)}>
            Delete
          </Button>
        )}
      </div>
    </Card>
  );
}

export function Templates() {
  const [templates, setTemplates] = useState<EstimateTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [usingId, setUsingId] = useState('');
  const [deletingId, setDeletingId] = useState('');

  const sortedTemplates = useMemo(() => {
    return [...templates].sort((a, b) => {
      if (Boolean(a.isShared) !== Boolean(b.isShared)) return a.isShared ? -1 : 1;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
  }, [templates]);

  useEffect(() => {
    loadTemplates();
  }, []);

  async function loadTemplates() {
    setIsLoading(true);
    setError('');
    try {
      const payload = await apiJson<{ data?: EstimateTemplate[] }>('/v1/estimate-templates');
      setTemplates(payload.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load templates');
    } finally {
      setIsLoading(false);
    }
  }

  async function useTemplate(template: EstimateTemplate) {
    setUsingId(template.id);
    try {
      const payload = await apiJson<{ data?: { rooms?: TemplateRoom[] } }>(`/v1/estimate-templates/${template.id}/use`, {
        method: 'POST',
      });
      sessionStorage.setItem('templateRooms', JSON.stringify(payload.data?.rooms || []));
      window.showToast?.('Template loaded. Opening production estimator.', 'success');
      window.location.href = '/estimates/production';
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to use template', 'error');
    } finally {
      setUsingId('');
    }
  }

  async function deleteTemplate(template: EstimateTemplate) {
    const confirmed = window.confirm(`Delete ${template.name || 'this template'}?`);
    if (!confirmed) return;
    setDeletingId(template.id);
    try {
      await apiJson(`/v1/estimate-templates/${template.id}`, { method: 'DELETE' });
      window.showToast?.('Template deleted', 'success');
      await loadTemplates();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to delete template', 'error');
    } finally {
      setDeletingId('');
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-1 pb-24 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="pf-page-copy max-w-2xl">
          Reuse room and substrate configurations in the production estimator.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button as="a" href="/estimates/production" size="sm">Open estimator</Button>
          <Button as="a" href="/estimates" variant="secondary" size="sm">Estimates</Button>
        </div>
      </div>

      {isLoading && <TemplateSkeleton />}

      {!isLoading && error && (
        <Card className="text-center">
          <Icon name="warning" className="mx-auto h-6 w-6 text-red-600" />
          <p className="pf-copy mt-2 text-red-700">{error}</p>
          <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={loadTemplates}>
            Retry
          </Button>
        </Card>
      )}

      {!isLoading && !error && !templates.length && (
        <Card>
          <EmptyState
            icon={<Icon name="templates" className="h-5 w-5" />}
            title="No estimate templates yet."
            description="Save repeatable room and substrate setups from the production estimator to speed up future proposals."
            action={<Button as="a" href="/estimates/production">Open production estimator</Button>}
          />
        </Card>
      )}

      {!isLoading && !error && templates.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {sortedTemplates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onUse={useTemplate}
              onDelete={deleteTemplate}
              isUsing={usingId === template.id}
              isDeleting={deletingId === template.id}
            />
          ))}
        </div>
      )}
    </main>
  );
}
