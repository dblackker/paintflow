import { useEffect, useState, type FormEvent } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';
import { apiJson, CrewmodoApiError } from '@/lib/api';

interface Rule {
  id: string;
  postalCode: string;
  label: string;
  ratePercent: string;
}
interface Policy {
  rules: { postalCode: string; label: string; ratePercent: string | number }[];
  defaultBurdenedRate: string | null;
  priceStaleDays: number;
  updatedAt: string | null;
}
export function EstimationPolicySettings() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [burden, setBurden] = useState('');
  const [staleDays, setStaleDays] = useState(90);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoaded(false);
    setError('');
    apiJson<{ data: Policy }>('/v1/settings/estimation-policy')
      .then(({ data }) => {
        if (!active) return;
        if (data.updatedAt === undefined) throw new Error('Policy revision is missing.');
        setRules(
          data.rules.map((rule) => ({
            ...rule,
            ratePercent: String(rule.ratePercent),
            id: crypto.randomUUID(),
          })),
        );
        setBurden(data.defaultBurdenedRate ?? '');
        setStaleDays(data.priceStaleDays);
        setUpdatedAt(data.updatedAt);
        setStale(false);
        setLoaded(true);
      })
      .catch(() => {
        if (active) setError('Pricing policy could not be loaded. Reload before making changes.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadVersion]);
  function update(id: string, patch: Partial<Rule>) {
    setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !loaded || stale) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await apiJson<{ data: Policy }>('/v1/settings/estimation-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rules: rules.map(({ postalCode, label, ratePercent }) => ({ postalCode, label, ratePercent })),
          defaultBurdenedRate: burden === '' ? null : burden,
          priceStaleDays: staleDays,
          expectedUpdatedAt: updatedAt,
        }),
      });
      setUpdatedAt(data.updatedAt);
      setBurden(data.defaultBurdenedRate ?? '');
      window.showToast?.('Estimation policy saved', 'success');
    } catch (err) {
      if (err instanceof CrewmodoApiError && err.status === 409) setStale(true);
      setError(err instanceof Error ? err.message : 'Pricing policy could not be saved.');
    } finally {
      setSaving(false);
    }
  }
  return (
    <form
      id="estimation-tax-settings"
      className="mt-6 grid scroll-mt-24 gap-4 border-t border-gray-200 pt-5"
      onSubmit={save}
      aria-busy={loading || saving}
    >
      <div>
        <h4 className="pf-section-title">Jobsite Tax & Cost</h4>
        <p className="pf-meta mt-1">
          Reviewed ZIP rules override the default tax rate. Confirm jurisdiction requirements with your tax
          adviser.
        </p>
      </div>
      {error && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="pf-copy text-red-700" role="alert">
            {error}
          </p>
          {(!loaded || stale) && (
            <Button
              type="button"
              variant="ghost"
              disabled={loading || saving}
              leftIcon={<Icon name="refresh-cw" />}
              onClick={() => setReloadVersion((version) => version + 1)}
            >
              Reload policy
            </Button>
          )}
        </div>
      )}
      <fieldset disabled={loading || saving || !loaded} className="grid min-w-0 gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className="pf-label">Burdened labor ($/hr)</span>
            <input
              className="input"
              type="number"
              min="0"
              max="1000"
              step="0.01"
              inputMode="decimal"
              value={burden}
              onChange={(event) => setBurden(event.target.value)}
              placeholder="Not configured"
            />
            <span className="pf-meta">
              Direct cost including payroll burden, not the customer selling rate.
            </span>
          </label>
          <label className="grid gap-1.5">
            <span className="pf-label">Price review (days)</span>
            <input
              className="input"
              type="number"
              min="1"
              max="730"
              step="1"
              inputMode="numeric"
              value={staleDays}
              onChange={(event) => setStaleDays(Number(event.target.value))}
            />
          </label>
        </div>
        <div className="grid gap-3">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_48px] items-end gap-2 border-b border-gray-200 pb-3"
            >
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1.5">
                  <span className="pf-label">ZIP code</span>
                  <input
                    className="input"
                    required
                    inputMode="numeric"
                    autoComplete="postal-code"
                    pattern="[0-9]{5}"
                    maxLength={5}
                    value={rule.postalCode}
                    onChange={(event) =>
                      update(rule.id, { postalCode: event.target.value.replace(/\D/g, '').slice(0, 5) })
                    }
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="pf-label">Jurisdiction</span>
                  <input
                    className="input"
                    required
                    maxLength={100}
                    value={rule.label}
                    onChange={(event) => update(rule.id, { label: event.target.value })}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="pf-label">Tax rate (%)</span>
                  <input
                    className="input"
                    required
                    type="number"
                    min="0"
                    max="100"
                    step="0.0001"
                    inputMode="decimal"
                    value={rule.ratePercent}
                    onChange={(event) => update(rule.id, { ratePercent: event.target.value })}
                  />
                </label>
              </div>
              <button
                type="button"
                className="btn-icon btn-icon-danger min-h-12 min-w-12"
                aria-label={`Remove tax rule ${rule.postalCode || 'new ZIP'}`}
                onClick={() => setRules((current) => current.filter((entry) => entry.id !== rule.id))}
              >
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={rules.length >= 100}
            leftIcon={<Icon name="plus" />}
            onClick={() =>
              setRules((current) => [
                ...current,
                { id: crypto.randomUUID(), postalCode: '', label: '', ratePercent: '' },
              ])
            }
          >
            Add tax rule
          </Button>
          <Button type="submit" variant="secondary" disabled={stale} isLoading={saving}>
            Save policy
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
