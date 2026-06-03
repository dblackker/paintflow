import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Input, Select, Textarea } from '@/components/Input';
import { apiJson, formatMoney, labelize } from '@/lib/api';

interface ProductionRate {
  id: string;
  category?: string | null;
  surfaceType?: string | null;
  unit?: string | null;
  ratePerHour?: number | string | null;
  hourlyRate?: number | string | null;
  prepMultiplier?: number | string | null;
  coats?: number | string | null;
  description?: string | null;
}

interface RateFormState {
  id: string;
  category: string;
  surfaceType: string;
  unit: string;
  ratePerHour: string;
  hourlyRate: string;
  prepMultiplier: string;
  coats: string;
  description: string;
}

const emptyRateForm: RateFormState = {
  id: '',
  category: '',
  surfaceType: '',
  unit: 'sqft',
  ratePerHour: '',
  hourlyRate: '50',
  prepMultiplier: '1',
  coats: '2',
  description: '',
};

const unitOptions = [
  { value: 'sqft', label: 'sq ft' },
  { value: 'linear_ft', label: 'linear ft' },
  { value: 'each', label: 'each' },
];

const coatOptions = [
  { value: '1', label: '1 coat' },
  { value: '2', label: '2 coats' },
  { value: '3', label: '3 coats' },
];

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function unitLabel(value?: string | null) {
  return unitOptions.find((option) => option.value === value)?.label || labelize(value || 'unit');
}

type RateSectionKey = 'interior' | 'exterior' | 'prep' | 'other';

interface GroupedRateSubsection {
  key: string;
  title: string;
  description: string;
  rates: ProductionRate[];
}

interface GroupedRateSection {
  key: RateSectionKey;
  title: string;
  description: string;
  order: number;
  subsections: GroupedRateSubsection[];
  count: number;
}

const sectionMeta: Record<RateSectionKey, { title: string; description: string; order: number }> = {
  interior: {
    title: 'Interior',
    description: 'Walls, ceilings, trim, doors, cabinets, and room-level repaint work.',
    order: 1,
  },
  exterior: {
    title: 'Exterior',
    description: 'Siding, body, soffits, fascia, exterior trim, and exterior repaint work.',
    order: 2,
  },
  prep: {
    title: 'Prep and Specialty',
    description: 'Preparation, repairs, coating, staining, and specialty work that can apply across scopes.',
    order: 3,
  },
  other: {
    title: 'Other Rates',
    description: 'Rates that do not match a standard interior, exterior, or specialty grouping yet.',
    order: 4,
  },
};

const subsectionMeta: Record<string, { title: string; description: string; order: number }> = {
  interior_walls: {
    title: 'Walls and Ceilings',
    description: 'Primary room substrates measured by square footage.',
    order: 1,
  },
  interior_trim: {
    title: 'Trim, Doors, and Cabinets',
    description: 'Detailed finish work measured by linear foot or each.',
    order: 2,
  },
  interior_prep: {
    title: 'Interior Prep and Repairs',
    description: 'Prep adjustments and repair-driven interior labor.',
    order: 3,
  },
  exterior_body: {
    title: 'Body and Siding',
    description: 'Main exterior surface production rates.',
    order: 1,
  },
  exterior_trim: {
    title: 'Trim, Fascia, Soffits, and Details',
    description: 'Exterior detail substrates measured separately from siding.',
    order: 2,
  },
  exterior_prep: {
    title: 'Exterior Prep and Repairs',
    description: 'Washing, scraping, caulking, priming, and repair-driven labor.',
    order: 3,
  },
  specialty: {
    title: 'Specialty Work',
    description: 'Special coating, stain, and non-standard production assumptions.',
    order: 1,
  },
  other: {
    title: 'Unsorted Rates',
    description: 'Review these categories when you tune your rate library.',
    order: 99,
  },
};

function searchableRateText(rate: ProductionRate) {
  return [rate.category, rate.surfaceType, rate.unit, rate.description].filter(Boolean).join(' ').toLowerCase();
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function classifyRate(rate: ProductionRate): { section: RateSectionKey; subsection: string } {
  const text = searchableRateText(rate);
  const category = (rate.category || '').toLowerCase();

  const isExterior =
    category === 'exterior' ||
    hasAny(text, ['exterior', 'siding', 'soffit', 'fascia', 'corner', 'stucco', 'brick', 'deck', 'fence', 'shutter', 'garage']);
  const isInterior =
    category === 'interior' ||
    hasAny(text, ['interior', 'wall', 'ceiling', 'trim', 'door', 'cabinet', 'baseboard', 'casing', 'drywall', 'room']);
  const isPrep = hasAny(text, ['prep', 'repair', 'patch', 'wash', 'pressure', 'scrape', 'caulk', 'prime', 'primer', 'stain', 'specialty']);

  if (isExterior) {
    if (hasAny(text, ['soffit', 'fascia', 'trim', 'corner', 'door', 'shutter', 'garage'])) {
      return { section: 'exterior', subsection: 'exterior_trim' };
    }
    if (isPrep) return { section: 'exterior', subsection: 'exterior_prep' };
    return { section: 'exterior', subsection: 'exterior_body' };
  }

  if (isInterior) {
    if (hasAny(text, ['trim', 'door', 'cabinet', 'baseboard', 'casing'])) {
      return { section: 'interior', subsection: 'interior_trim' };
    }
    if (isPrep) return { section: 'interior', subsection: 'interior_prep' };
    return { section: 'interior', subsection: 'interior_walls' };
  }

  if (isPrep) return { section: 'prep', subsection: 'specialty' };
  return { section: 'other', subsection: 'other' };
}

function rateSortKey(rate: ProductionRate) {
  return `${rate.category || ''} ${rate.surfaceType || ''} ${rate.description || ''}`.toLowerCase();
}

function rateDisplayTitle(rate: ProductionRate) {
  const category = labelize(rate.category || '');
  const surface = labelize(rate.surfaceType || '');
  const normalizedCategory = category.toLowerCase();
  const normalizedSurface = surface.toLowerCase();

  if (!category && !surface) return 'Production rate';
  if (!category) return surface;
  if (!surface) return category;
  if (normalizedCategory === 'interior' || normalizedCategory === 'exterior') return surface;
  if (normalizedCategory.includes(normalizedSurface) || normalizedSurface.includes(normalizedCategory)) return category;
  return `${category} - ${surface}`;
}

function groupRatesByScope(rates: ProductionRate[]): GroupedRateSection[] {
  const sectionMap = new Map<RateSectionKey, Map<string, ProductionRate[]>>();

  rates.forEach((rate) => {
    const classification = classifyRate(rate);
    if (!sectionMap.has(classification.section)) {
      sectionMap.set(classification.section, new Map());
    }
    const subsectionMap = sectionMap.get(classification.section)!;
    const currentRates = subsectionMap.get(classification.subsection) || [];
    currentRates.push(rate);
    subsectionMap.set(classification.subsection, currentRates);
  });

  return Array.from(sectionMap.entries())
    .map(([key, subsectionMap]) => {
      const meta = sectionMeta[key];
      const subsections = Array.from(subsectionMap.entries())
        .map(([subsectionKey, subsectionRates]) => {
          const subsection = subsectionMeta[subsectionKey] || subsectionMeta.other;
          return {
            key: subsectionKey,
            title: subsection.title,
            description: subsection.description,
            rates: [...subsectionRates].sort((a, b) => rateSortKey(a).localeCompare(rateSortKey(b))),
          };
        })
        .sort((a, b) => {
          const aOrder = subsectionMeta[a.key]?.order ?? 99;
          const bOrder = subsectionMeta[b.key]?.order ?? 99;
          return aOrder - bOrder || a.title.localeCompare(b.title);
        });

      return {
        key,
        title: meta.title,
        description: meta.description,
        order: meta.order,
        subsections,
        count: subsections.reduce((sum, subsection) => sum + subsection.rates.length, 0),
      };
    })
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

function rateFromForm(form: RateFormState) {
  return {
    category: form.category.trim(),
    surfaceType: form.surfaceType.trim(),
    unit: form.unit,
    ratePerHour: Number(form.ratePerHour),
    hourlyRate: Number(form.hourlyRate),
    prepMultiplier: Number(form.prepMultiplier || 1),
    coats: Number(form.coats || 2),
    description: form.description.trim() || null,
  };
}

function formFromRate(rate?: ProductionRate | null): RateFormState {
  if (!rate) return emptyRateForm;
  return {
    id: rate.id,
    category: rate.category || '',
    surfaceType: rate.surfaceType || '',
    unit: rate.unit || 'sqft',
    ratePerHour: rate.ratePerHour == null ? '' : String(rate.ratePerHour),
    hourlyRate: rate.hourlyRate == null ? '50' : String(rate.hourlyRate),
    prepMultiplier: rate.prepMultiplier == null ? '1' : String(rate.prepMultiplier),
    coats: rate.coats == null ? '2' : String(rate.coats),
    description: rate.description || '',
  };
}

function RateSkeleton() {
  return (
    <div className="divide-y divide-gray-200">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-3/4 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="flex gap-2">
              <div className="h-9 w-9 animate-pulse rounded-full bg-gray-100" />
              <div className="h-9 w-9 animate-pulse rounded-full bg-gray-100" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function RateRow({
  rate,
  onEdit,
  onDelete,
  isDeleting,
}: {
  rate: ProductionRate;
  onEdit: (rate: ProductionRate) => void;
  onDelete: (rate: ProductionRate) => void;
  isDeleting: boolean;
}) {
  const ratePerHour = numberValue(rate.ratePerHour);
  const hourlyRate = numberValue(rate.hourlyRate);
  const laborUnitCost = ratePerHour > 0 ? hourlyRate / ratePerHour : 0;

  return (
    <article className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="pf-row-title">
            {labelize(rate.category || 'Rate')} · {labelize(rate.surfaceType || 'Substrate')}
          </p>
          <span className="pf-status pf-status-neutral pf-status-sm">{unitLabel(rate.unit)}</span>
        </div>
        <p className="pf-copy mt-1">
          {ratePerHour.toLocaleString('en-US')} {unitLabel(rate.unit)}/hr at {formatMoney(hourlyRate, false)}/hr
        </p>
        {rate.description && <p className="pf-helper mt-1">{rate.description}</p>}
      </div>

      <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_auto] items-center gap-2 sm:grid-cols-[6.5rem_6.5rem_6.5rem_auto]">
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="pf-meta">Coats</p>
          <p className="pf-emphasis">{numberValue(rate.coats) || 2}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="pf-meta">Prep</p>
          <p className="pf-emphasis">{numberValue(rate.prepMultiplier || 1).toFixed(2)}x</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <p className="pf-meta">Labor cost</p>
          <p className="pf-emphasis">{formatMoney(laborUnitCost)}/{unitLabel(rate.unit)}</p>
        </div>
        <div className="flex justify-end gap-1">
          <button type="button" className="btn-icon btn-icon-tonal" aria-label={`Edit ${labelize(rate.category || 'rate')}`} onClick={() => onEdit(rate)}>
            <Icon name="edit" className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-icon btn-icon-outlined btn-icon-danger"
            aria-label={`Delete ${labelize(rate.category || 'rate')}`}
            disabled={isDeleting}
            onClick={() => onDelete(rate)}
          >
            <Icon name="trash" className="h-4 w-4" />
          </button>
        </div>
      </div>
    </article>
  );
}

export function ProductionRates() {
  const [rates, setRates] = useState<ProductionRate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<RateFormState>(emptyRateForm);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState('');

  const groupedRateSections = useMemo(() => groupRatesByScope(rates), [rates]);

  const averageHourlyRate = useMemo(() => {
    if (!rates.length) return 0;
    return rates.reduce((sum, rate) => sum + numberValue(rate.hourlyRate), 0) / rates.length;
  }, [rates]);

  useEffect(() => {
    loadRates();
  }, []);

  useEffect(() => {
    document.body.classList.toggle('pf-modal-open', modalOpen);
    return () => document.body.classList.remove('pf-modal-open');
  }, [modalOpen]);

  async function loadRates() {
    setIsLoading(true);
    setError('');
    try {
      const payload = await apiJson<{ data?: ProductionRate[] }>('/v1/production-rates');
      setRates(payload.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load production rates');
    } finally {
      setIsLoading(false);
    }
  }

  function openRateModal(rate?: ProductionRate) {
    setForm(formFromRate(rate));
    setModalOpen(true);
  }

  function closeRateModal() {
    if (isSaving) return;
    setModalOpen(false);
  }

  async function saveRate(event: FormEvent) {
    event.preventDefault();
    setIsSaving(true);
    try {
      const id = form.id;
      await apiJson(`/v1/production-rates${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(id ? {} : { 'Idempotency-Key': crypto.randomUUID() }),
        },
        body: JSON.stringify(rateFromForm(form)),
      });
      window.showToast?.(id ? 'Production rate updated' : 'Production rate added', 'success');
      setModalOpen(false);
      await loadRates();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Could not save production rate', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  async function deleteRate(rate: ProductionRate) {
    const confirmed = window.confirm('Delete this rate? Existing estimates keep their saved pricing, but new estimates will no longer use this rate.');
    if (!confirmed) return;
    setDeletingId(rate.id);
    try {
      await apiJson(`/v1/production-rates/${rate.id}`, { method: 'DELETE' });
      window.showToast?.('Production rate deleted', 'success');
      await loadRates();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Could not delete production rate', 'error');
    } finally {
      setDeletingId('');
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-1 pb-24 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="pf-page-copy max-w-2xl">
          Set your production rates for accurate estimates. Rates are how much your crew can complete per labor hour.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button as="a" href="/materials" variant="secondary" size="sm">Paint products</Button>
          <Button type="button" size="sm" leftIcon={<Icon name="plus" className="h-4 w-4" />} onClick={() => openRateModal()}>
            Add rate
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Card padding="sm" className="shadow-none">
          <p className="pf-meta">Rates</p>
          <p className="pf-metric mt-1">{rates.length}</p>
        </Card>
        <Card padding="sm" className="shadow-none">
          <p className="pf-meta">Substrates</p>
          <p className="pf-metric mt-1">{new Set(rates.map((rate) => rate.surfaceType).filter(Boolean)).size}</p>
        </Card>
        <Card padding="sm" className="shadow-none">
          <p className="pf-meta">Avg labor</p>
          <p className="pf-metric mt-1">{formatMoney(averageHourlyRate, false)}</p>
        </Card>
      </div>

      <Card padding="none" className="overflow-hidden">
        <CardHeader
          className="mb-0 border-b border-gray-200 px-4 py-3 sm:px-5"
          title="Production Rate Library"
          description="Grouped by how estimators build scope: interior, exterior, and specialty prep."
        />
        <CardContent>
          {isLoading && <RateSkeleton />}

          {!isLoading && error && (
            <div className="p-8 text-center">
              <Icon name="warning" className="mx-auto h-6 w-6 text-red-600" />
              <p className="pf-copy mt-2 text-red-700">{error}</p>
              <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={loadRates}>
                Retry
              </Button>
            </div>
          )}

          {!isLoading && !error && !rates.length && (
            <EmptyState
              icon={<Icon name="paint-bucket" className="h-5 w-5" />}
              title="No production rates yet."
              description="Add rates for walls, trim, doors, cabinets, exterior siding, and other common painting substrates."
              action={{ label: 'Add production rate', onClick: () => openRateModal() }}
            />
          )}

          {!isLoading && !error && rates.length > 0 && (
            <div className="grid gap-4 p-3 sm:p-4">
              {groupedRateSections.map((section) => (
                <section key={section.key} className="overflow-hidden rounded-xl border border-gray-200 bg-gray-50/80">
                  <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:px-5">
                    <div>
                      <h3 className="pf-section-title">{section.title}</h3>
                      <p className="pf-copy mt-1">{section.description}</p>
                    </div>
                    <span className="pf-status pf-status-neutral pf-status-sm self-start">{section.count} rates</span>
                  </div>

                  <div className="divide-y divide-gray-200 border-t border-gray-200 bg-white">
                    {section.subsections.map((subsection) => (
                      <div key={subsection.key}>
                        <div className="bg-gray-50/70 px-4 py-2 sm:px-5">
                          <p className="pf-row-title">{subsection.title}</p>
                          <p className="pf-meta mt-0.5">{subsection.description}</p>
                        </div>
                        <div className="divide-y divide-gray-200">
                          {subsection.rates.map((rate) => (
                            <RateRow
                              key={rate.id}
                              rate={rate}
                              onEdit={openRateModal}
                              onDelete={deleteRate}
                              isDeleting={deletingId === rate.id}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
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
          aria-labelledby="rate-modal-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeRateModal();
          }}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="rate-modal-title" className="pf-section-title">{form.id ? 'Edit Production Rate' : 'Add Production Rate'}</h2>
                <p className="pf-copy mt-1">Rates power production estimates and job costing assumptions.</p>
              </div>
              <button type="button" className="btn-icon" aria-label="Close production rate form" onClick={closeRateModal}>
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>

            <form className="space-y-4" onSubmit={saveRate}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Category"
                  required
                  autoComplete="off"
                  enterKeyHint="next"
                  placeholder="walls, trim, exterior siding"
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                />
                <Input
                  label="Substrate"
                  required
                  autoComplete="off"
                  enterKeyHint="next"
                  placeholder="drywall, wood, stucco"
                  value={form.surfaceType}
                  onChange={(event) => setForm({ ...form, surfaceType: event.target.value })}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Select
                  label="Unit"
                  required
                  value={form.unit}
                  onChange={(event) => setForm({ ...form, unit: event.target.value })}
                  options={unitOptions}
                />
                <Input
                  label="Production per hour"
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="400"
                  value={form.ratePerHour}
                  onChange={(event) => setForm({ ...form, ratePerHour: event.target.value })}
                />
                <Input
                  label="Labor rate"
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="65"
                  value={form.hourlyRate}
                  onChange={(event) => setForm({ ...form, hourlyRate: event.target.value })}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Prep multiplier"
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="1"
                  value={form.prepMultiplier}
                  onChange={(event) => setForm({ ...form, prepMultiplier: event.target.value })}
                />
                <Select
                  label="Default coats"
                  required
                  value={form.coats}
                  onChange={(event) => setForm({ ...form, coats: event.target.value })}
                  options={coatOptions}
                />
              </div>
              <Textarea
                label="Description"
                rows={2}
                autoComplete="off"
                enterKeyHint="done"
                placeholder="Interior walls - roll"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
              <div className="mobile-sticky-actions flex flex-col gap-3 pt-2 sm:static sm:m-0 sm:flex-row sm:border-0 sm:bg-transparent sm:p-0">
                <Button type="button" variant="secondary" fullWidth onClick={closeRateModal}>
                  Cancel
                </Button>
                <Button type="submit" fullWidth isLoading={isSaving}>
                  {form.id ? 'Save changes' : 'Save rate'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
