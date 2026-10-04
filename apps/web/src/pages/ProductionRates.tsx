import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Input, Select, Textarea } from '@/components/Input';
import { apiJson, formatMoney, labelize } from '@/lib/api';

type RateBasis = 'legacy_per_coat' | 'complete_system' | 'hours_per_item';
type SellSource = 'inherit' | 'override';
type ScopeGroup = 'interior' | 'exterior' | 'other';
interface ProductionRate {
  id: string;
  category: string;
  surfaceType: string;
  unit: string;
  ratePerHour: number | string;
  hourlyRate: number | string;
  prepMultiplier: number | string;
  coats: number;
  description?: string | null;
  rateBasis?: RateBasis;
  coatRates?: Record<string, string>;
  applicationMethod?: string | null;
  sellingRateSource?: SellSource;
  burdenedRate?: string | number | null;
  version?: number;
  provenance?: string;
  reviewedAt?: string | null;
  updatedAt?: string;
}
interface RateForm {
  id: string;
  category: string;
  surfaceType: string;
  unit: string;
  ratePerHour: string;
  hourlyRate: string;
  prepMultiplier: string;
  coats: string;
  description: string;
  rateBasis: RateBasis;
  coatRates: Record<string, string>;
  applicationMethod: string;
  sellingRateSource: SellSource;
  burdenedRate: string;
  expectedVersion?: number;
  reviewed: boolean;
}
interface ProductAssumption {
  id: string;
  name: string;
  unit: string;
  costPerUnit: string | number;
  coverageSqFt?: string | number | null;
  coverageBasis?: 'per_pack' | 'per_gallon';
  coverageSource?: string | null;
  costSource?: string | null;
  costUpdatedAt?: string | null;
}
const units = [
  { value: 'sqft', label: 'sq ft' },
  { value: 'linear_ft', label: 'linear ft' },
  { value: 'each', label: 'each' },
];
const coats = [1, 2, 3].map((count) => ({
  value: String(count),
  label: `${count} coat${count > 1 ? 's' : ''}`,
}));
const bases = [
  { value: 'complete_system', label: 'Complete system: units/hour' },
  { value: 'hours_per_item', label: 'Complete system: hours/item' },
  { value: 'legacy_per_coat', label: 'Legacy: units/hour per coat' },
];
const methods = [
  { value: '', label: 'Not method-calibrated' },
  { value: 'brush_roll', label: 'Brush / roll' },
  { value: 'spray_backroll', label: 'Spray / back-roll' },
  { value: 'spray_only', label: 'Spray only' },
];
const groupLabels: Record<ScopeGroup, string> = {
  interior: 'Interior',
  exterior: 'Exterior',
  other: 'Other',
};
const emptyForm: RateForm = {
  id: '',
  category: '',
  surfaceType: '',
  unit: 'sqft',
  ratePerHour: '',
  hourlyRate: '',
  prepMultiplier: '1',
  coats: '2',
  description: '',
  rateBasis: 'complete_system',
  coatRates: { '1': '', '2': '', '3': '' },
  applicationMethod: '',
  sellingRateSource: 'inherit',
  burdenedRate: '',
  reviewed: false,
};
function unitLabel(unit: string) {
  return units.find((option) => option.value === unit)?.label || labelize(unit);
}
function dateLabel(value?: string | null) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleDateString('en-US');
}
function scopeGroup(rate: ProductionRate): ScopeGroup {
  const text = `${rate.category} ${rate.surfaceType} ${rate.description || ''}`.toLowerCase();
  if (/exterior|siding|soffit|fascia|stucco|brick|deck|fence|shutter|garage|corner/.test(text))
    return 'exterior';
  if (/interior|wall|ceiling|trim|door|cabinet|baseboard|casing|drywall|room/.test(text)) return 'interior';
  return 'other';
}
function formFromRate(rate?: ProductionRate): RateForm {
  if (!rate) return { ...emptyForm, coatRates: { ...emptyForm.coatRates } };
  return {
    id: rate.id,
    category: rate.category,
    surfaceType: rate.surfaceType,
    unit: rate.unit,
    ratePerHour: String(rate.ratePerHour),
    hourlyRate: String(rate.hourlyRate),
    prepMultiplier: String(rate.prepMultiplier),
    coats: String(rate.coats),
    description: rate.description || '',
    rateBasis: rate.rateBasis || 'legacy_per_coat',
    coatRates: { '1': '', '2': '', '3': '', ...rate.coatRates },
    applicationMethod: rate.applicationMethod || '',
    sellingRateSource: rate.sellingRateSource || 'override',
    burdenedRate: rate.burdenedRate == null ? '' : String(rate.burdenedRate),
    expectedVersion: rate.version,
    reviewed: Boolean(rate.reviewedAt),
  };
}
function ratePayload(form: RateForm) {
  const selectedRate = Number(form.coatRates[form.coats]);
  // Keep the legacy column for old readers; v2 pricing uses the explicit table.
  const compatibleRate = form.rateBasis === 'hours_per_item' ? 1 / selectedRate : selectedRate;
  return {
    category: form.category.trim(),
    surfaceType: form.surfaceType.trim(),
    unit: form.unit,
    ratePerHour:
      form.rateBasis === 'legacy_per_coat'
        ? form.ratePerHour
        : String(Math.max(0.01, Number(compatibleRate.toFixed(2)))),
    hourlyRate: form.hourlyRate || '50',
    prepMultiplier: form.rateBasis === 'legacy_per_coat' ? form.prepMultiplier : '1',
    coats: Number(form.coats),
    description: form.description.trim() || null,
    rateBasis: form.rateBasis,
    coatRates: Object.fromEntries(Object.entries(form.coatRates).filter(([, value]) => value.trim() !== '')),
    applicationMethod: form.applicationMethod || null,
    sellingRateSource: form.sellingRateSource,
    burdenedRate: form.burdenedRate.trim() || null,
    reviewed: form.reviewed,
    expectedVersion: form.expectedVersion,
  };
}
function RateRow({
  rate,
  sellDefault,
  burdenDefault,
  disabled,
  onEdit,
  onDelete,
}: {
  rate: ProductionRate;
  sellDefault: string | null;
  burdenDefault: string | null;
  disabled: boolean;
  onEdit: (rate: ProductionRate) => void;
  onDelete: (rate: ProductionRate) => void;
}) {
  const basis = rate.rateBasis || 'legacy_per_coat';
  const inherit = rate.sellingRateSource === 'inherit';
  const rateValue = basis === 'legacy_per_coat' ? rate.ratePerHour : rate.coatRates?.[String(rate.coats)];
  const output =
    rateValue == null
      ? 'Missing coat rate'
      : `${Number(rateValue).toLocaleString('en-US', { maximumFractionDigits: 6 })} ${basis === 'hours_per_item' ? 'hr/item' : `${unitLabel(rate.unit)}/hr`}`;
  return (
    <article className="grid gap-3 border-b border-gray-200 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,15rem)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="pf-row-title break-words">
            {labelize(rate.category)} - {labelize(rate.surfaceType)}
          </h3>
          {!rate.reviewedAt && (
            <span className="pf-status pf-status-warning pf-status-sm">
              {rate.provenance === 'sample' ? 'Sample / unreviewed' : 'Unreviewed'}
            </span>
          )}
        </div>
        <p className="pf-copy mt-1">
          {output}{' '}
          <span className="text-gray-500">
            {basis === 'legacy_per_coat' ? 'per coat' : `for all ${rate.coats} coats`}
          </span>
        </p>
        <p className="pf-meta mt-1">
          {rate.applicationMethod
            ? `${methods.find((method) => method.value === rate.applicationMethod)?.label || rate.applicationMethod} calibrated`
            : 'No calibrated method'}
          {basis === 'legacy_per_coat' ? ` / prep ${rate.prepMultiplier}x` : ''}
        </p>
        {rate.description && <p className="pf-helper mt-1 break-words">{rate.description}</p>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-1">
        <div>
          <dt className="pf-meta">Selling / hour</dt>
          <dd className="pf-emphasis">
            {inherit
              ? sellDefault == null
                ? 'Company default'
                : formatMoney(sellDefault)
              : formatMoney(rate.hourlyRate)}{' '}
            <span className="font-normal text-gray-500">{inherit ? '(inherited)' : '(override)'}</span>
          </dd>
        </div>
        <div>
          <dt className="pf-meta">Burdened cost / hour</dt>
          <dd className="pf-emphasis">
            {rate.burdenedRate == null
              ? burdenDefault == null
                ? 'Not specified'
                : `${formatMoney(burdenDefault)} (inherited)`
              : formatMoney(rate.burdenedRate)}
          </dd>
        </div>
      </dl>
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          className="btn-icon btn-icon-tonal"
          title="Edit rate"
          aria-label={`Edit ${labelize(rate.category)}`}
          disabled={disabled}
          onClick={() => onEdit(rate)}
        >
          <Icon name="edit" className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="btn-icon btn-icon-outlined btn-icon-danger"
          title="Delete rate"
          aria-label={`Delete ${labelize(rate.category)}`}
          disabled={disabled}
          onClick={() => onDelete(rate)}
        >
          <Icon name="trash" className="h-4 w-4" />
        </button>
      </div>
    </article>
  );
}
function ProductAssumptions() {
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<ProductAssumption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function showProducts() {
    setOpen((current) => !current);
    if (loaded || loading || open) return;
    setLoading(true);
    setError('');
    try {
      const payload = await apiJson<{ data: ProductAssumption[] }>('/v1/materials');
      setProducts(payload.data || []);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load products.');
    } finally {
      setLoading(false);
    }
  }
  return (
    <section className="border-t border-gray-200 pt-4">
      <button
        type="button"
        className="btn-text w-full !min-h-12 !justify-start text-left"
        aria-expanded={open}
        aria-controls="product-assumptions"
        onClick={showProducts}
      >
        <Icon name="paint-bucket" className="h-4 w-4" />
        {open ? 'Hide product assumptions' : 'View product assumptions'}
      </button>
      {open && (
        <div id="product-assumptions" className="space-y-3">
          <p className="pf-helper">
            Coverage is for one coat per purchased pack unless explicitly recorded per gallon. A five-gallon
            pail needs five times the one-gallon coverage. Acquisition cost is per purchased pack; a supplier
            listing is not proof of contractor cost.
          </p>
          {loading && (
            <p role="status" className="pf-helper">
              Loading products...
            </p>
          )}
          {error && (
            <p role="alert" className="pf-copy text-red-700">
              {error}
            </p>
          )}
          {!loading && !error && loaded && !products.length && (
            <p className="pf-helper">No products recorded.</p>
          )}
          {products.map((product) => (
            <div key={product.id} className="grid gap-2 border-b border-gray-200 py-3 sm:grid-cols-2">
              <div className="min-w-0">
                <h3 className="pf-row-title break-words">{product.name}</h3>
                <p className="pf-helper">Pack: {labelize(product.unit)}</p>
                <p className="pf-copy">
                  {product.coverageSqFt == null
                    ? 'Coverage not recorded'
                    : `${product.coverageSqFt} sq ft / ${product.coverageBasis === 'per_gallon' ? 'gallon' : 'pack'} / coat`}
                </p>
                <p className="pf-meta break-words">
                  Coverage source: {product.coverageSource || 'Not recorded'}
                </p>
              </div>
              <div>
                <p className="pf-emphasis">{formatMoney(product.costPerUnit)} / pack</p>
                <p className="pf-meta">Cost date: {dateLabel(product.costUpdatedAt)}</p>
                <p className="pf-meta break-words">Cost source: {product.costSource || 'Not recorded'}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function ProductionRates() {
  const [rates, setRates] = useState<ProductionRate[]>([]);
  const [sellDefault, setSellDefault] = useState<string | null>(null);
  const [burdenDefault, setBurdenDefault] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<RateForm>(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [deletingId, setDeletingId] = useState('');
  const [formError, setFormError] = useState('');
  const [filter, setFilter] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const savingRef = useRef(false);
  const saveAttempt = useRef<{ body: string; key: string } | null>(null);
  const initializeKey = useRef('');
  const groups = useMemo(
    () =>
      (Object.keys(groupLabels) as ScopeGroup[]).map((key) => ({
        key,
        rates: rates
          .filter(
            (rate) =>
              scopeGroup(rate) === key &&
              `${rate.category} ${rate.surfaceType} ${rate.description || ''}`
                .toLowerCase()
                .includes(filter.toLowerCase()),
          )
          .sort((a, b) => a.category.localeCompare(b.category) || a.surfaceType.localeCompare(b.surfaceType)),
      })),
    [rates, filter],
  );
  useEffect(() => {
    void loadRates();
    void apiJson<{ data?: { defaultLaborRate?: string | number } }>('/v1/settings/org')
      .then((payload) =>
        setSellDefault(payload.data?.defaultLaborRate == null ? null : String(payload.data.defaultLaborRate)),
      )
      .catch(() => undefined);
    void apiJson<{ data?: { defaultBurdenedRate?: string | number | null } }>(
      '/v1/settings/estimation-policy',
    )
      .then((payload) =>
        setBurdenDefault(
          payload.data?.defaultBurdenedRate == null ? null : String(payload.data.defaultBurdenedRate),
        ),
      )
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!modalOpen) return;
    document.body.classList.add('pf-modal-open');
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingRef.current) setModalOpen(false);
      if (event.key !== 'Tab') return;
      const fields = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]',
        ) || [],
      );
      const first = fields[0];
      const last = fields[fields.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.classList.remove('pf-modal-open');
      document.removeEventListener('keydown', onKey);
      returnFocus.current?.focus();
    };
  }, [modalOpen]);
  async function loadRates() {
    setIsLoading(true);
    setError('');
    try {
      const payload = await apiJson<{ data?: ProductionRate[] }>('/v1/production-rates');
      setRates(payload.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load production rates.');
    } finally {
      setIsLoading(false);
    }
  }
  function openModal(rate?: ProductionRate) {
    returnFocus.current = document.activeElement as HTMLElement;
    setForm(formFromRate(rate));
    setFormError('');
    saveAttempt.current = null;
    setModalOpen(true);
  }
  function changeBasis(value: RateBasis) {
    setForm((current) => ({
      ...current,
      rateBasis: value,
      unit: value === 'hours_per_item' ? 'each' : current.unit,
      coatRates: value === current.rateBasis ? current.coatRates : { '1': '', '2': '', '3': '' },
      reviewed: false,
    }));
  }
  async function saveRate(event: FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    setFormError('');
    if (form.rateBasis !== 'legacy_per_coat' && !(Number(form.coatRates[form.coats]) > 0)) {
      setFormError('Enter a complete-system rate for the default coat count.');
      return;
    }
    if (form.sellingRateSource === 'override' && !(Number(form.hourlyRate) > 0)) {
      setFormError('Enter the selling hourly override.');
      return;
    }
    const body = JSON.stringify(ratePayload(form));
    if (saveAttempt.current?.body !== body) saveAttempt.current = { body, key: crypto.randomUUID() };
    savingRef.current = true;
    setIsSaving(true);
    try {
      await apiJson(`/v1/production-rates${form.id ? `/${form.id}` : ''}`, {
        method: form.id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': saveAttempt.current!.key },
        body,
      });
      window.showToast?.(form.id ? 'Production rate updated' : 'Production rate added', 'success');
      setModalOpen(false);
      saveAttempt.current = null;
      await loadRates();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save production rate.');
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }
  async function initializeSamples() {
    if (initializing) return;
    if (!initializeKey.current) initializeKey.current = crypto.randomUUID();
    setInitializing(true);
    try {
      const result = await apiJson<{ data: ProductionRate[] }>('/v1/production-rates/initialize-samples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': initializeKey.current },
        body: '{}',
      });
      initializeKey.current = '';
      window.showToast?.(
        result.data.length
          ? 'Sample rates added. Review before estimating.'
          : 'No new samples added. Previously deleted rates stay deleted.',
        'success',
      );
      await loadRates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add sample rates.');
    } finally {
      setInitializing(false);
    }
  }
  async function deleteRate(rate: ProductionRate) {
    if (
      !window.confirm(
        'Delete this rate? Existing estimates retain saved pricing. New estimates will no longer use this rate.',
      )
    )
      return;
    setDeletingId(rate.id);
    try {
      await apiJson(`/v1/production-rates/${rate.id}`, {
        method: 'DELETE',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      window.showToast?.('Production rate deleted', 'success');
      await loadRates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete production rate.');
    } finally {
      setDeletingId('');
    }
  }
  return (
    <main className="mx-auto max-w-5xl space-y-5 px-1 pb-24 sm:px-0">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="pf-section-title">Production rates</h1>
          <p className="pf-helper mt-1">
            {rates.length} active rates / {rates.filter((rate) => !rate.reviewedAt).length} unreviewed
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button as="a" href="/materials" variant="secondary" size="sm">
            View products
          </Button>
          <Button
            type="button"
            size="sm"
            leftIcon={<Icon name="plus" className="h-4 w-4" />}
            onClick={() => openModal()}
          >
            Add rate
          </Button>
        </div>
      </header>
      <dl className="grid gap-3 border-y border-gray-200 py-4 text-sm sm:grid-cols-3">
        <div>
          <dt className="pf-row-title">Rate basis</dt>
          <dd className="pf-helper mt-1">
            Legacy rates apply per coat. Complete-system rates cover all selected coats once.
          </dd>
        </div>
        <div>
          <dt className="pf-row-title">Cost and sell</dt>
          <dd className="pf-helper mt-1">
            Burdened labor is contractor cost, not selling price. Inherited selling uses the company default
            {sellDefault == null ? '.' : ` of ${formatMoney(sellDefault)}/hour.`}
          </dd>
        </div>
        <div>
          <dt className="pf-row-title">Prep and materials</dt>
          <dd className="pf-helper mt-1">
            Legacy prep factors multiply painting time. Missing products can use unverified allowances;
            missing burdened cost is not zero cost.
          </dd>
        </div>
      </dl>
      <Input
        label="Search rates"
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        autoComplete="off"
      />
      {isLoading && (
        <p role="status" className="pf-copy py-8">
          Loading rates...
        </p>
      )}
      {error && (
        <div role="alert" className="space-y-2">
          <p className="pf-copy text-red-700">{error}</p>
          <Button type="button" variant="secondary" size="sm" onClick={loadRates}>
            Retry loading
          </Button>
        </div>
      )}
      {!isLoading && !error && !rates.length && (
        <EmptyState
          icon={<Icon name="paint-bucket" className="h-5 w-5" />}
          title="No production rates"
          description="Sample rates are unreviewed examples, not calibrated contractor rates."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" onClick={() => openModal()}>
                Add rate
              </Button>
              <Button type="button" variant="secondary" isLoading={initializing} onClick={initializeSamples}>
                Add sample rates
              </Button>
            </div>
          }
        />
      )}
      {!isLoading && !error && rates.length > 0 && (
        <div className="space-y-5">
          {groups
            .filter((group) => group.rates.length)
            .map((group) => (
              <section key={group.key}>
                <div className="flex items-center justify-between border-b border-gray-200 py-2">
                  <h2 className="pf-section-title">{groupLabels[group.key]}</h2>
                  <span className="pf-meta">{group.rates.length} rates</span>
                </div>
                {group.rates.map((rate) => (
                  <RateRow
                    key={rate.id}
                    rate={rate}
                    sellDefault={sellDefault}
                    burdenDefault={burdenDefault}
                    disabled={deletingId === rate.id}
                    onEdit={openModal}
                    onDelete={deleteRate}
                  />
                ))}
              </section>
            ))}
          {!groups.some((group) => group.rates.length) && (
            <p className="pf-helper py-4">No matching rates.</p>
          )}
        </div>
      )}
      <ProductAssumptions />
      {modalOpen && (
        <div
          className="mobile-sheet fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="rate-modal-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSaving) setModalOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-lg bg-white p-5 shadow-xl sm:rounded-lg sm:p-6"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 id="rate-modal-title" className="pf-section-title">
                  {form.id ? 'Edit production rate' : 'Add production rate'}
                </h2>
                {form.id && (
                  <p className="pf-meta mt-1">
                    Version {form.expectedVersion || 1} /{' '}
                    {dateLabel(rates.find((rate) => rate.id === form.id)?.updatedAt)}
                  </p>
                )}
              </div>
              <button
                type="button"
                className="btn-icon shrink-0"
                title="Close rate editor"
                aria-label="Close rate editor"
                disabled={isSaving}
                onClick={() => setModalOpen(false)}
              >
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            <form className="space-y-4" onSubmit={saveRate}>
              <fieldset disabled={isSaving} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Category"
                    required
                    maxLength={100}
                    autoComplete="off"
                    value={form.category}
                    onChange={(event) => setForm({ ...form, category: event.target.value })}
                  />
                  <Input
                    label="Substrate"
                    required
                    maxLength={100}
                    autoComplete="off"
                    value={form.surfaceType}
                    onChange={(event) => setForm({ ...form, surfaceType: event.target.value })}
                  />
                </div>
                <Select
                  label="Rate basis"
                  required
                  value={form.rateBasis}
                  options={bases}
                  onChange={(event) => changeBasis(event.target.value as RateBasis)}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    label="Unit"
                    value={form.unit}
                    disabled={form.rateBasis === 'hours_per_item'}
                    options={units}
                    onChange={(event) => setForm({ ...form, unit: event.target.value })}
                  />
                  <Select
                    label="Default coats"
                    value={form.coats}
                    options={coats}
                    onChange={(event) => setForm({ ...form, coats: event.target.value })}
                  />
                </div>
                {form.rateBasis === 'legacy_per_coat' ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      label="Units/hour per coat"
                      required
                      type="number"
                      min="0.01"
                      max="99999999.99"
                      step="0.01"
                      inputMode="decimal"
                      value={form.ratePerHour}
                      onChange={(event) => setForm({ ...form, ratePerHour: event.target.value })}
                    />
                    <Input
                      label="Legacy prep multiplier"
                      required
                      type="number"
                      min="0.01"
                      max="999.99"
                      step="0.01"
                      inputMode="decimal"
                      value={form.prepMultiplier}
                      onChange={(event) => setForm({ ...form, prepMultiplier: event.target.value })}
                    />
                  </div>
                ) : (
                  <fieldset className="border-y border-gray-200 py-3">
                    <legend className="pf-row-title px-1">Complete coats table</legend>
                    <p className="pf-helper mb-3">
                      {form.rateBasis === 'hours_per_item'
                        ? 'Total hours per item for the entire coating count.'
                        : 'Units per labor-hour for the entire coating count, not per additional coat.'}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {coats.map((coat) => (
                        <Input
                          key={coat.value}
                          label={`${coat.label} (${form.rateBasis === 'hours_per_item' ? 'hr/item' : `${unitLabel(form.unit)}/hr`})`}
                          required={form.coats === coat.value}
                          type="number"
                          min="0.000001"
                          max="99999999.99"
                          step="0.000001"
                          inputMode="decimal"
                          value={form.coatRates[coat.value]}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              coatRates: { ...form.coatRates, [coat.value]: event.target.value },
                            })
                          }
                        />
                      ))}
                    </div>
                  </fieldset>
                )}
                <Select
                  label="Calibrated application method"
                  value={form.applicationMethod}
                  options={methods}
                  labelHelp="Select a method only when the rate already measures that method. A calibrated rate receives no additional method productivity boost. Legacy descriptions alone do not establish calibration."
                  onChange={(event) =>
                    setForm({ ...form, applicationMethod: event.target.value, reviewed: false })
                  }
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Burdened cost / hour"
                    type="number"
                    min="0"
                    max="99999999.99"
                    step="0.01"
                    inputMode="decimal"
                    value={form.burdenedRate}
                    helperText={
                      burdenDefault == null
                        ? 'Blank: unknown cost unless a company default is configured.'
                        : `Blank: inherit company cost of ${formatMoney(burdenDefault)}/hour.`
                    }
                    labelHelp="Contractor labor cost including wage and labor burden. Blank inherits a configured company cost; otherwise cost remains unknown. This is separate from the customer selling rate."
                    onChange={(event) => setForm({ ...form, burdenedRate: event.target.value })}
                  />
                  <Select
                    label="Selling rate source"
                    value={form.sellingRateSource}
                    options={[
                      { value: 'inherit', label: 'Inherit company default' },
                      { value: 'override', label: 'Override for this rate' },
                    ]}
                    onChange={(event) =>
                      setForm({ ...form, sellingRateSource: event.target.value as SellSource })
                    }
                  />
                </div>
                {form.sellingRateSource === 'override' ? (
                  <Input
                    label="Selling override / hour"
                    required
                    type="number"
                    min="0.01"
                    max="99999999.99"
                    step="0.01"
                    inputMode="decimal"
                    value={form.hourlyRate}
                    onChange={(event) => setForm({ ...form, hourlyRate: event.target.value })}
                  />
                ) : (
                  <p className="pf-helper">
                    Company selling rate:{' '}
                    {sellDefault == null ? 'Not available' : `${formatMoney(sellDefault)}/hour`}{' '}
                    <a href="/settings" className="underline">
                      View company settings
                    </a>
                  </p>
                )}
                <Textarea
                  label="Description"
                  rows={2}
                  maxLength={4000}
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                />
                <label className="flex min-h-12 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={form.reviewed}
                    onChange={(event) => setForm({ ...form, reviewed: event.target.checked })}
                  />
                  Contractor-reviewed assumptions
                </label>
              </fieldset>
              {formError && (
                <p role="alert" className="pf-copy text-red-700">
                  {formError}
                </p>
              )}
              <div className="mobile-sticky-actions flex gap-3 pt-2 sm:static sm:m-0 sm:border-0 sm:bg-transparent sm:p-0">
                <Button
                  type="button"
                  variant="secondary"
                  fullWidth
                  disabled={isSaving}
                  onClick={() => setModalOpen(false)}
                >
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
