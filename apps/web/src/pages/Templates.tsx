import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Modal, ModalFooter } from '@/components/Modal';
import { apiJson } from '@/lib/api';

interface TemplateRoom {
  id?: string;
  name?: string | null;
  roomType?: string | null;
  length?: number | string | null;
  width?: number | string | null;
  items?: TemplateItem[];
  surfaces?: TemplateItem[];
}

interface TemplateItem {
  id?: string;
  category?: string | null;
  label?: string | null;
  quantity?: number | string | null;
  width?: number | string | null;
  height?: number | string | null;
  coats?: number | string | null;
  prepLevel?: string | null;
  applicationMethod?: string | null;
  notes?: string | null;
}

interface EstimateTemplate {
  id: string;
  name?: string | null;
  description?: string | null;
  isShared?: boolean | null;
  usageCount?: number | string | null;
  rooms?: TemplateRoom[];
}

interface TemplateFormState {
  name: string;
  description: string;
  category: 'room' | 'full_estimate' | 'package';
  roomName: string;
  roomType: string;
  length: string;
  width: string;
  items: Array<{
    id: string;
    category: string;
    quantity: string;
    prepLevel: string;
    notes: string;
  }>;
}

const defaultTemplateForm: TemplateFormState = {
  name: '',
  description: '',
  category: 'room',
  roomName: 'Bedroom',
  roomType: 'bedroom',
  length: '',
  width: '',
  items: [
    { id: crypto.randomUUID(), category: 'walls', quantity: '', prepLevel: 'standard', notes: '' },
    { id: crypto.randomUUID(), category: 'ceiling', quantity: '', prepLevel: 'standard', notes: '' },
    { id: crypto.randomUUID(), category: 'trim', quantity: '', prepLevel: 'standard', notes: '' },
  ],
};

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
  return rooms.reduce((sum, room) => {
    if (Array.isArray(room.surfaces)) return sum + room.surfaces.length;
    if (Array.isArray(room.items)) return sum + room.items.length;
    return sum;
  }, 0);
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
        <Button type="button" variant="secondary" size="sm" isLoading={isDeleting} onClick={() => onDelete(template)}>
          Delete
        </Button>
      </div>
    </Card>
  );
}

export function Templates() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<EstimateTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [usingId, setUsingId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);
  const [form, setForm] = useState<TemplateFormState>(defaultTemplateForm);

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
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      sessionStorage.setItem('templateRooms', JSON.stringify(payload.data?.rooms || []));
      window.showToast?.('Template loaded. Opening production estimator.', 'success');
      navigate('/estimates/production');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to use template', 'error');
    } finally {
      setUsingId('');
    }
  }

  function resetCreateForm() {
    setForm({
      ...defaultTemplateForm,
      items: defaultTemplateForm.items.map((item) => ({ ...item, id: crypto.randomUUID() })),
    });
  }

  function closeCreateModal() {
    setIsCreateOpen(false);
    resetCreateForm();
  }

  function updateItem(id: string, patch: Partial<TemplateFormState['items'][number]>) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item) => item.id === id ? { ...item, ...patch } : item),
    }));
  }

  function addItem() {
    setForm((current) => ({
      ...current,
      items: [...current.items, { id: crypto.randomUUID(), category: 'walls', quantity: '', prepLevel: 'standard', notes: '' }],
    }));
  }

  function removeItem(id: string) {
    setForm((current) => ({
      ...current,
      items: current.items.filter((item) => item.id !== id),
    }));
  }

  async function createTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const surfaces = form.items
      .map((item) => ({
        category: item.category.trim(),
        label: item.category.trim().replace(/_/g, ' '),
        quantity: numberValue(item.quantity),
        prepLevel: item.prepLevel,
        coats: 2,
        applicationMethod: item.category.includes('siding') ? 'spray_backroll' : 'brush_roll',
        notes: item.notes.trim() || undefined,
      }))
      .filter((item) => item.category && item.quantity > 0);
    if (!surfaces.length) {
      window.showToast?.('Add at least one substrate with a quantity.', 'error');
      return;
    }

    setIsSavingTemplate(true);
    try {
      await apiJson('/v1/estimate-templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          category: form.category,
          isShared: false,
          isSmart: false,
          rooms: [{
            name: form.roomName.trim() || form.name.trim(),
            roomType: form.roomType.trim() || undefined,
            kind: form.roomType === 'exterior' ? 'exterior' : 'interior',
            length: numberValue(form.length) > 0 ? numberValue(form.length) : undefined,
            width: numberValue(form.width) > 0 ? numberValue(form.width) : undefined,
            surfaces,
          }],
        }),
      });
      window.showToast?.('Template created', 'success');
      closeCreateModal();
      await loadTemplates();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to create template', 'error');
    } finally {
      setIsSavingTemplate(false);
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
          <Button type="button" size="sm" leftIcon={<Icon name="plus" className="h-4 w-4" />} onClick={() => setIsCreateOpen(true)}>New template</Button>
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
            action={<Button type="button" onClick={() => setIsCreateOpen(true)}>Create template</Button>}
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

      <Modal isOpen={isCreateOpen} onClose={closeCreateModal} title="New Estimate Template" size="lg">
        <form onSubmit={createTemplate} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="form-label">Template name</span>
              <input className="input mt-1" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Bedroom walls + trim" required />
            </label>
            <label>
              <span className="form-label">Room type</span>
              <select className="input mt-1" value={form.roomType} onChange={(event) => setForm((current) => ({ ...current, roomType: event.target.value }))}>
                <option value="bedroom">Bedroom</option>
                <option value="bathroom">Bathroom</option>
                <option value="kitchen">Kitchen</option>
                <option value="living_room">Living room</option>
                <option value="dining_room">Dining room</option>
                <option value="hallway">Hallway</option>
                <option value="exterior">Exterior area</option>
                <option value="custom">Custom</option>
              </select>
            </label>
          </div>
          <label>
            <span className="form-label">Description</span>
            <textarea className="input mt-1 min-h-20" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Reusable scope for common bedrooms, prep, coats, and trim." />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label>
              <span className="form-label">Room / area name</span>
              <input className="input mt-1" value={form.roomName} onChange={(event) => setForm((current) => ({ ...current, roomName: event.target.value }))} placeholder="Bedroom" required />
            </label>
            <label>
              <span className="form-label">Length</span>
              <input className="input mt-1" type="number" min="0" step="0.1" inputMode="decimal" value={form.length} onChange={(event) => setForm((current) => ({ ...current, length: event.target.value }))} placeholder="Optional" />
            </label>
            <label>
              <span className="form-label">Width</span>
              <input className="input mt-1" type="number" min="0" step="0.1" inputMode="decimal" value={form.width} onChange={(event) => setForm((current) => ({ ...current, width: event.target.value }))} placeholder="Optional" />
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="pf-row-title">Substrates</p>
                <p className="pf-helper">Quantities can be adjusted after applying the template in the production estimator.</p>
              </div>
              <Button type="button" variant="secondary" size="sm" leftIcon={<Icon name="plus" className="h-4 w-4" />} onClick={addItem}>Add</Button>
            </div>
            {form.items.map((item, index) => (
              <div key={item.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_7rem_9rem_auto] sm:items-end">
                  <label>
                    <span className="form-label">Substrate</span>
                    <select className="input mt-1" value={item.category} onChange={(event) => updateItem(item.id, { category: event.target.value })}>
                      <option value="walls">Walls</option>
                      <option value="ceiling">Ceiling</option>
                      <option value="trim">Trim</option>
                      <option value="doors">Doors</option>
                      <option value="cabinets">Cabinets</option>
                      <option value="siding">Siding</option>
                      <option value="soffit">Soffit</option>
                      <option value="fascia">Fascia</option>
                    </select>
                  </label>
                  <label>
                    <span className="form-label">Qty</span>
                    <input className="input mt-1" type="number" min="0" step="0.25" inputMode="decimal" value={item.quantity} onChange={(event) => updateItem(item.id, { quantity: event.target.value })} required />
                  </label>
                  <label>
                    <span className="form-label">Prep</span>
                    <select className="input mt-1" value={item.prepLevel} onChange={(event) => updateItem(item.id, { prepLevel: event.target.value })}>
                      <option value="none">No prep</option>
                      <option value="light">Light</option>
                      <option value="standard">Standard</option>
                      <option value="heavy">Heavy</option>
                    </select>
                  </label>
                  <button type="button" className="btn-icon btn-icon-outlined btn-icon-danger" aria-label={`Remove substrate ${index + 1}`} onClick={() => removeItem(item.id)} disabled={form.items.length === 1}>
                    <Icon name="trash" className="h-4 w-4" />
                  </button>
                </div>
                <input className="input mt-2" value={item.notes} onChange={(event) => updateItem(item.id, { notes: event.target.value })} placeholder="Notes, optional" />
              </div>
            ))}
          </div>

          <ModalFooter className="-mx-6 -mb-4 mt-4">
            <Button type="button" variant="secondary" onClick={closeCreateModal}>Cancel</Button>
            <Button type="submit" isLoading={isSavingTemplate}>Create template</Button>
          </ModalFooter>
        </form>
      </Modal>
    </main>
  );
}
