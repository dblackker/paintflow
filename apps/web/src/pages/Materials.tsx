import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Input, Select } from '@/components/Input';
import { apiJson, formatMoney, labelize } from '@/lib/api';

interface Material {
  id: string;
  name?: string | null;
  brand?: string | null;
  category?: string | null;
  unit?: string | null;
  coverageSqFt?: number | string | null;
  costPerUnit?: number | string | null;
  markupPercent?: number | string | null;
  supplier?: string | null;
  sku?: string | null;
}

interface MaterialFormState {
  id: string;
  name: string;
  brand: string;
  category: string;
  unit: string;
  coverageSqFt: string;
  costPerUnit: string;
  markupPercent: string;
  supplier: string;
  sku: string;
}

const emptyMaterialForm: MaterialFormState = {
  id: '',
  name: '',
  brand: '',
  category: 'paint',
  unit: 'gallon',
  coverageSqFt: '',
  costPerUnit: '',
  markupPercent: '30',
  supplier: '',
  sku: '',
};

const categoryOptions = [
  { value: '', label: 'Choose category' },
  { value: 'paint', label: 'Paint' },
  { value: 'primer', label: 'Primer' },
  { value: 'supplies', label: 'Supplies' },
];

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function displayName(material: Material) {
  return [material.brand, material.name].filter(Boolean).join(' ') || material.name || 'Paint product';
}

function sellPrice(material: Material) {
  const cost = numberValue(material.costPerUnit);
  const markup = numberValue(material.markupPercent);
  return cost * (1 + markup / 100);
}

function formFromMaterial(material?: Material | null): MaterialFormState {
  if (!material) return emptyMaterialForm;
  return {
    id: material.id,
    name: material.name || '',
    brand: material.brand || '',
    category: material.category || 'paint',
    unit: material.unit || 'gallon',
    coverageSqFt: material.coverageSqFt == null ? '' : String(material.coverageSqFt),
    costPerUnit: material.costPerUnit == null ? '' : String(material.costPerUnit),
    markupPercent: material.markupPercent == null ? '30' : String(material.markupPercent),
    supplier: material.supplier || '',
    sku: material.sku || '',
  };
}

function materialFromForm(form: MaterialFormState) {
  return {
    name: form.name.trim(),
    brand: form.brand.trim() || null,
    category: form.category,
    unit: form.unit.trim(),
    costPerUnit: Number(form.costPerUnit),
    markupPercent: Number(form.markupPercent || 30),
    supplier: form.supplier.trim() || null,
    sku: form.sku.trim() || null,
    ...(form.coverageSqFt ? { coverageSqFt: Number(form.coverageSqFt) } : {}),
  };
}

function MaterialSkeleton() {
  return (
    <div className="divide-y divide-gray-200">
      {[0, 1, 2].map((item) => (
        <div key={item} className="p-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0 space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-gray-100" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="flex items-center gap-3">
              <div className="h-10 w-28 animate-pulse rounded bg-gray-100" />
              <div className="h-9 w-9 animate-pulse rounded-full bg-gray-100" />
              <div className="h-9 w-9 animate-pulse rounded-full bg-gray-100" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MaterialRow({
  material,
  onEdit,
  onDelete,
  isDeleting,
}: {
  material: Material;
  onEdit: (material: Material) => void;
  onDelete: (material: Material) => void;
  isDeleting: boolean;
}) {
  const name = displayName(material);
  const unit = material.unit || 'unit';

  return (
    <article className="grid gap-3 p-4 transition hover:bg-gray-50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5">
      <div className="min-w-0">
        <p className="pf-row-title truncate">{name}</p>
        <p className="pf-copy mt-1">
          {labelize(material.category || 'Product')} · {unit}
          {material.coverageSqFt ? ` · ${numberValue(material.coverageSqFt).toLocaleString('en-US')} sq ft/${unit}` : ''}
        </p>
        <p className="pf-helper mt-1">
          {[material.supplier, material.sku].filter(Boolean).join(' · ') || 'No supplier details'}
        </p>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-right">
          <p className="pf-section-title">{formatMoney(sellPrice(material))}/{unit}</p>
          <p className="pf-meta">
            Cost: {formatMoney(material.costPerUnit)} · {numberValue(material.markupPercent).toFixed(1)}% markup
          </p>
        </div>
        <div className="flex gap-1.5">
          <button type="button" className="btn-icon btn-icon-tonal" aria-label={`Edit ${name}`} onClick={() => onEdit(material)}>
            <Icon name="edit" className="h-4 w-4" />
          </button>
          <button type="button" className="btn-icon btn-icon-outlined btn-icon-danger" aria-label={`Delete ${name}`} disabled={isDeleting} onClick={() => onDelete(material)}>
            <Icon name="trash" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </article>
  );
}

export function Materials() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<MaterialFormState>(emptyMaterialForm);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');

  const sortedMaterials = useMemo(() => [...materials].sort((a, b) => displayName(a).localeCompare(displayName(b))), [materials]);
  const paintCount = useMemo(() => materials.filter((material) => material.category === 'paint').length, [materials]);
  const averageCost = useMemo(() => {
    if (!materials.length) return 0;
    return materials.reduce((sum, material) => sum + numberValue(material.costPerUnit), 0) / materials.length;
  }, [materials]);

  useEffect(() => {
    loadMaterials();
  }, []);

  useEffect(() => {
    document.body.classList.toggle('pf-modal-open', modalOpen);
    return () => document.body.classList.remove('pf-modal-open');
  }, [modalOpen]);

  async function loadMaterials() {
    setIsLoading(true);
    setError('');
    try {
      const payload = await apiJson<{ data?: Material[] }>('/v1/materials');
      setMaterials(payload.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load paint products');
    } finally {
      setIsLoading(false);
    }
  }

  function openMaterialModal(material?: Material) {
    setForm(formFromMaterial(material));
    setModalOpen(true);
  }

  function closeMaterialModal() {
    if (isSaving) return;
    setModalOpen(false);
  }

  async function saveMaterial(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    try {
      const id = form.id;
      await apiJson(`/v1/materials${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(id ? {} : { 'Idempotency-Key': crypto.randomUUID() }),
        },
        body: JSON.stringify(materialFromForm(form)),
      });
      window.showToast?.(id ? 'Paint product updated' : 'Paint product added', 'success');
      setModalOpen(false);
      await loadMaterials();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Could not save paint product', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteMaterial(material: Material) {
    const confirmed = window.confirm(`Delete ${displayName(material)}? Existing estimates keep saved product data, but new estimates will no longer use it.`);
    if (!confirmed) return;
    setDeletingId(material.id);
    try {
      await apiJson(`/v1/materials/${material.id}`, { method: 'DELETE' });
      window.showToast?.('Paint product deleted', 'success');
      await loadMaterials();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Could not delete paint product', 'error');
    } finally {
      setDeletingId('');
    }
  }

  return (
    <section className="mx-auto max-w-5xl space-y-5 px-1 pb-24 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="pf-page-copy max-w-2xl">
          Track product cost, coverage, supplier, and markup for production estimates.
        </p>
        <div className="grid grid-cols-3 gap-2 sm:flex">
          <Button as="a" href="/production-rates" variant="secondary" size="sm">Rates</Button>
          <Button as="a" href="/settings" variant="secondary" size="sm">Settings</Button>
          <Button type="button" size="sm" leftIcon={<Icon name="plus" className="h-4 w-4" />} onClick={() => openMaterialModal()}>
            Product
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Card padding="sm" className="shadow-none">
          <p className="pf-meta">Products</p>
          <p className="pf-metric mt-1">{materials.length}</p>
        </Card>
        <Card padding="sm" className="shadow-none">
          <p className="pf-meta">Paints</p>
          <p className="pf-metric mt-1">{paintCount}</p>
        </Card>
        <Card padding="sm" className="shadow-none">
          <p className="pf-meta">Avg cost</p>
          <p className="pf-metric mt-1">{formatMoney(averageCost)}</p>
        </Card>
      </div>

      <Card padding="none" className="overflow-hidden">
        <CardHeader
          className="mb-0 border-b border-gray-200 px-4 py-3 sm:px-5"
          title="Paint Product Library"
          description="Products selected on estimates use this cost, coverage, and markup to calculate material pricing."
        />
        <CardContent>
          {isLoading && <MaterialSkeleton />}

          {!isLoading && error && (
            <div className="p-8 text-center">
              <Icon name="warning" className="mx-auto h-6 w-6 text-red-600" />
              <p className="pf-copy mt-2 text-red-700">{error}</p>
              <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={loadMaterials}>
                Retry
              </Button>
            </div>
          )}

          {!isLoading && !error && !materials.length && (
            <EmptyState
              icon={<Icon name="paint-bucket" className="h-5 w-5" />}
              title="No paint products yet."
              description="Add your common paint, primer, and supplies so estimates calculate realistic material cost and owner markup."
              action={{ label: 'Add paint product', onClick: () => openMaterialModal() }}
            />
          )}

          {!isLoading && !error && materials.length > 0 && (
            <div className="divide-y divide-gray-200">
              {sortedMaterials.map((material) => (
                <MaterialRow
                  key={material.id}
                  material={material}
                  onEdit={openMaterialModal}
                  onDelete={deleteMaterial}
                  isDeleting={deletingId === material.id}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {modalOpen && (
        <div
          className="mobile-sheet fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="material-modal-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeMaterialModal();
          }}
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="material-modal-title" className="pf-section-title">{form.id ? 'Edit Paint Product' : 'Add Paint Product'}</h2>
                <p className="pf-copy mt-1">These costs feed estimate material pricing and production ordering.</p>
              </div>
              <button type="button" className="btn-icon" aria-label="Close paint product form" onClick={closeMaterialModal}>
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>

            <form className="space-y-4" onSubmit={saveMaterial}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Product name"
                  required
                  autoComplete="off"
                  enterKeyHint="next"
                  placeholder="Regal Select Interior Matte"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                />
                <Input
                  label="Brand"
                  autoComplete="organization"
                  enterKeyHint="next"
                  placeholder="Benjamin Moore"
                  value={form.brand}
                  onChange={(event) => setForm({ ...form, brand: event.target.value })}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Select
                  label="Category"
                  required
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                  options={categoryOptions}
                />
                <Input
                  label="Unit"
                  required
                  autoComplete="off"
                  enterKeyHint="next"
                  placeholder="gallon"
                  value={form.unit}
                  onChange={(event) => setForm({ ...form, unit: event.target.value })}
                />
                <Input
                  label="Coverage per unit"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="350"
                  value={form.coverageSqFt}
                  onChange={(event) => setForm({ ...form, coverageSqFt: event.target.value })}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Cost per unit"
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="48.00"
                  value={form.costPerUnit}
                  onChange={(event) => setForm({ ...form, costPerUnit: event.target.value })}
                />
                <Input
                  label="Markup percent"
                  required
                  type="number"
                  min="0"
                  max="200"
                  step="0.1"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="30"
                  value={form.markupPercent}
                  onChange={(event) => setForm({ ...form, markupPercent: event.target.value })}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Supplier"
                  autoComplete="organization"
                  enterKeyHint="next"
                  placeholder="NorCal Paint Supply"
                  value={form.supplier}
                  onChange={(event) => setForm({ ...form, supplier: event.target.value })}
                />
                <Input
                  label="SKU"
                  autoComplete="off"
                  enterKeyHint="done"
                  placeholder="Optional supplier SKU"
                  value={form.sku}
                  onChange={(event) => setForm({ ...form, sku: event.target.value })}
                />
              </div>
              <div className="mobile-sticky-actions flex flex-col gap-3 pt-2 sm:static sm:m-0 sm:flex-row sm:border-0 sm:bg-transparent sm:p-0">
                <Button type="button" variant="secondary" fullWidth onClick={closeMaterialModal}>
                  Cancel
                </Button>
                <Button type="submit" fullWidth isLoading={isSaving}>
                  {form.id ? 'Save changes' : 'Save product'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
