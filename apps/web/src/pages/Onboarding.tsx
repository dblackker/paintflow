import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Input } from '@/components/Input';
import { API_URL, apiJson, labelize } from '@/lib/api';

interface OrgSettings {
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  defaultLaborRate?: string | number | null;
  materialMarkupPercent?: string | number | null;
  salesTaxRate?: string | number | null;
  depositPercent?: string | number | null;
  onboardingCompletedAt?: string | null;
}

interface ServiceArea {
  id: string;
  zipCode: string;
}

interface OnboardingProgress {
  completed?: boolean;
  completedSteps?: number;
  totalSteps?: number;
  percent?: number;
  steps?: Array<{ key: string; label: string; complete: boolean }>;
  shouldShowUpsell?: boolean;
  upsell?: {
    title: string;
    message: string;
    cta: string;
    href: string;
  };
}

interface OnboardingResponse {
  data?: {
    settings?: OrgSettings;
    serviceAreas?: ServiceArea[];
    progress?: OnboardingProgress;
  };
}

type StepKey = 'business' | 'pricing' | 'areas' | 'connectors' | 'ready';
type SubscriptionStatus = {
  status?: string | null;
  currentPeriodEnd?: string | null;
  plan?: {
    name?: string | null;
    price?: string | number | null;
    features?: { displayName?: string; userLimit?: number | null } | null;
  } | null;
} | null;

const steps: Array<{ key: StepKey; title: string }> = [
  { key: 'business', title: 'Business basics' },
  { key: 'pricing', title: 'Pricing defaults' },
  { key: 'areas', title: 'Service areas' },
  { key: 'connectors', title: 'Connect tools' },
  { key: 'ready', title: 'Ready to work' },
];

function normalizePercent(value: unknown, fallback = '') {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return String(number <= 1 ? number * 100 : number);
}

function displayOrgSettings(settings: OrgSettings) {
  return {
    ...settings,
    phone: settings.phone ? maskPhone(String(settings.phone)) : '',
    salesTaxRate: normalizePercent(settings.salesTaxRate, '9.2'),
  };
}

function phoneDigits(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.slice(0, 10);
}

function maskPhone(value: string) {
  const digits = phoneDigits(value);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function parseZipCodes(value: string) {
  return Array.from(new Set(value.split(/[\s,]+/).map((zip) => zip.trim()).filter(Boolean)));
}

export function Onboarding() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState(0);
  const [settings, setSettings] = useState<OrgSettings>({});
  const [zipCodes, setZipCodes] = useState('');
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [subscription, setSubscription] = useState<SubscriptionStatus>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const isWelcome = searchParams.get('welcome') === '1';

  const step = steps[currentStep];
  const progressPercent = Math.round(((currentStep + 1) / steps.length) * 100);
  const areaCount = useMemo(() => parseZipCodes(zipCodes).length, [zipCodes]);

  useEffect(() => {
    if (!isWelcome) return;

    const guardKey = 'crewmodo.postSignupHistoryGuarded';
    const guarded = sessionStorage.getItem(guardKey) === '1';

    if (!guarded) {
      window.history.replaceState({ ...(window.history.state || {}), crewmodoPostSignup: true }, '', window.location.href);
      window.history.pushState({ crewmodoPostSignupGuard: true }, '', window.location.href);
      sessionStorage.setItem(guardKey, '1');
    }

    function keepUserInAppAfterSignup() {
      navigate('/dashboard', { replace: true });
    }

    window.addEventListener('popstate', keepUserInAppAfterSignup);
    return () => {
      window.removeEventListener('popstate', keepUserInAppAfterSignup);
    };
  }, [isWelcome, navigate]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        const [payload, subscriptionPayload] = await Promise.all([
          apiJson<OnboardingResponse>('/v1/settings/onboarding'),
          apiJson<{ data?: SubscriptionStatus }>('/v1/billing/subscription').catch(() => ({ data: null })),
        ]);
        if (cancelled) return;
        const nextSettings = payload.data?.settings || {};
        setSettings(displayOrgSettings(nextSettings));
        setZipCodes((payload.data?.serviceAreas || []).map((area) => area.zipCode).join(', '));
        setProgress(payload.data?.progress || null);
        setSubscription(subscriptionPayload.data || null);
      } catch (err) {
        if (!cancelled) setAlert({ type: 'error', message: err instanceof Error ? err.message : 'Failed to load onboarding' });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveOrg(patch: Partial<OrgSettings>) {
    const payload = await apiJson<{ data?: OrgSettings }>('/v1/settings/org', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(patch),
    });
    if (payload.data) setSettings(displayOrgSettings(payload.data));
  }

  async function refreshProgress() {
    const payload = await apiJson<OnboardingResponse>('/v1/settings/onboarding');
    setProgress(payload.data?.progress || null);
  }

  async function saveStep() {
    setAlert(null);
    setIsSaving(true);
    try {
      if (step.key === 'business') {
        await saveOrg({
          companyName: settings.companyName || '',
          phone: settings.phone || '',
          email: settings.email || '',
          address: settings.address || '',
        });
      } else if (step.key === 'pricing') {
        await saveOrg({
          defaultLaborRate: settings.defaultLaborRate || 65,
          materialMarkupPercent: settings.materialMarkupPercent || 30,
          salesTaxRate: settings.salesTaxRate || 9.2,
          depositPercent: settings.depositPercent || 50,
        });
      } else if (step.key === 'areas') {
        const zips = parseZipCodes(zipCodes);
        const invalid = zips.find((zip) => !/^\d{5}(?:-\d{4})?$/.test(zip));
        if (invalid) throw new Error(`ZIP code ${invalid} is not valid.`);
        await apiJson('/v1/settings/service-areas', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': crypto.randomUUID(),
          },
          body: JSON.stringify({ zipCodes: zips }),
        });
      } else if (step.key === 'ready') {
        await saveOrg({ onboardingCompletedAt: new Date().toISOString() });
        navigate('/dashboard');
        return;
      }

      await refreshProgress();
      if (currentStep < steps.length - 1) {
        setCurrentStep((value) => value + 1);
      }
    } catch (err) {
      setAlert({ type: 'error', message: err instanceof Error ? err.message : 'Request failed' });
    } finally {
      setIsSaving(false);
    }
  }

  function updateSetting(key: keyof OrgSettings, value: string) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="mx-auto max-w-5xl px-1 pb-24 sm:px-0">
      {isWelcome && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
          <p className="font-semibold">Workspace created</p>
                  <p className="mt-1">
            We loaded starter settings for lead intake, estimating, job costing, roles, and follow-up. Review the defaults here before your first estimate.
          </p>
        </div>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="flex min-h-72 items-center justify-center">
            <div className="text-center">
              <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
              <p className="pf-copy mt-4">Loading setup...</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="pf-kicker">Setup</p>
                  <h1 className="pf-section-title mt-1">Get Crewmodo ready for your painting business</h1>
                </div>
                <span className="pf-meta">Step {currentStep + 1} of {steps.length}</span>
              </div>
              <div className="mt-4 h-2 rounded-full bg-gray-100">
                <div className="h-2 rounded-full bg-blue-600 transition-all" style={{ width: `${progressPercent}%` }} />
              </div>
            </CardHeader>
            <CardContent>
              {alert && (
                <div
                  className={`mb-5 rounded-lg border p-3 text-sm ${
                    alert.type === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'
                  }`}
                  role="alert"
                >
                  {alert.message}
                </div>
              )}

              <form
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  void saveStep();
                }}
              >
                {step.key === 'business' && (
                  <div className="grid gap-5">
                    <TrialSummary subscription={subscription} />
                    <div className="grid gap-4">
                      <Input label="Company name" required autoComplete="organization" value={settings.companyName || ''} onChange={(event) => updateSetting('companyName', event.target.value)} placeholder="Acme Painting Co." />
                      <Input label="Phone number" required type="tel" inputMode="numeric" autoComplete="tel" maxLength={14} value={settings.phone || ''} onChange={(event) => updateSetting('phone', maskPhone(event.target.value))} placeholder="(555) 123-4567" />
                      <Input label="Email" required type="email" inputMode="email" autoComplete="email" value={settings.email || ''} onChange={(event) => updateSetting('email', event.target.value)} placeholder="owner@example.com" />
                      <Input label="Business address" required autoComplete="street-address" value={settings.address || ''} onChange={(event) => updateSetting('address', event.target.value)} placeholder="123 Main St, Tacoma, WA 98402" />
                    </div>
                  </div>
                )}

                {step.key === 'pricing' && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input label="Default labor rate ($/hour)" type="number" min="0" step="0.01" inputMode="decimal" autoComplete="off" value={settings.defaultLaborRate ?? '65'} onChange={(event) => updateSetting('defaultLaborRate', event.target.value)} />
                    <Input label="Material markup (%)" type="number" min="0" step="0.01" inputMode="decimal" autoComplete="off" value={settings.materialMarkupPercent ?? '30'} onChange={(event) => updateSetting('materialMarkupPercent', event.target.value)} />
                    <Input
                      label="Sales tax rate (%)"
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      inputMode="decimal"
                      autoComplete="off"
                      value={settings.salesTaxRate ?? '9.2'}
                      onChange={(event) => updateSetting('salesTaxRate', event.target.value)}
                      onBlur={(event) => updateSetting('salesTaxRate', normalizePercent(event.target.value, '9.2'))}
                      labelHelp="This is the default rate used when a more specific tax rule is not available. You can configure ZIP-specific sales tax later, and invoices can calculate tax automatically or be manually overridden before sending."
                      helperText="Enter 9.2 for a 9.2% sales tax rate."
                    />
                    <Input
                      label="Deposit required (%)"
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      inputMode="decimal"
                      autoComplete="off"
                      value={settings.depositPercent ?? '50'}
                      onChange={(event) => updateSetting('depositPercent', event.target.value)}
                      labelHelp="This is the default upfront deposit. You can change payment schedules later in Settings, including milestone plans such as 10% to schedule, 40% before work starts, and the balance on completion."
                    />
                  </div>
                )}

                {step.key === 'areas' && (
                  <div className="grid gap-4">
                    <Input
                      label="Service ZIP codes"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      value={zipCodes}
                      onChange={(event) => setZipCodes(event.target.value.replace(/[^\d,\s-]/g, ''))}
                      placeholder="98402, 98403, 98405"
                      helperText={`${areaCount} ZIP ${areaCount === 1 ? 'code' : 'codes'} selected. Separate each ZIP with a comma.`}
                    />
                  </div>
                )}

                {step.key === 'connectors' && (
                  <div className="grid gap-3">
                    <ConnectorRow title="Stripe Payments" copy="Create or connect a Stripe account for customer deposits and payouts." href="/payments/stripe" />
                    <ConnectorRow title="QuickBooks" copy="Sync invoices and payments when accounting is ready." href={`${API_URL}/v1/quickbooks/connect`} />
                    <ConnectorRow title="Google Calendar" copy="Schedule jobs and crews from the production calendar." href={`${API_URL}/v1/calendar/connect`} />
                    <p className="pf-copy mt-2">You can connect these later, but payments and accounting make the CRM operational instead of just a contact list.</p>
                  </div>
                )}

                {step.key === 'ready' && (
                  <div className="rounded-lg border bg-green-50 p-5 text-green-950">
                    <p className="pf-section-title text-green-950">You are ready to start using Crewmodo</p>
                    <p className="mt-2 text-sm text-green-900">
                      Next, add paint products and production rates so estimates and job costing stay accurate.
                    </p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2">
                      <Link to="/materials" className="btn-secondary btn-sm justify-center">Paint products</Link>
                      <Link to="/production-rates" className="btn-secondary btn-sm justify-center">Production rates</Link>
                    </div>
                  </div>
                )}

                <div className="sticky bottom-0 -mx-6 mt-8 flex gap-2 border-t bg-white px-6 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:justify-between sm:border-t-0 sm:px-0 sm:pb-0">
                  <Button type="button" variant="ghost" className={currentStep === 0 ? 'invisible' : ''} onClick={() => setCurrentStep((value) => Math.max(0, value - 1))}>
                    Back
                  </Button>
                  <div className="ml-auto flex gap-2">
                    {currentStep < steps.length - 1 && (
                      <Button type="button" variant="ghost" onClick={() => setCurrentStep(steps.length - 1)}>
                        Finish later
                      </Button>
                    )}
                    <Button type="submit" isLoading={isSaving}>
                      {currentStep === steps.length - 1 ? 'Go to dashboard' : 'Save and continue'}
                    </Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>

          <aside className="grid gap-4 self-start">
            <Card padding="sm">
              <CardHeader title="Setup checklist" className="mb-3" />
              <CardContent>
                <div className="grid gap-2 text-sm text-gray-700">
                  {(progress?.steps || []).map((item) => (
                    <div key={item.key} className="flex items-center gap-2">
                      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-xs ${item.complete ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {item.complete && <Icon name="check" className="h-3.5 w-3.5" />}
                      </span>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
                <p className="pf-meta mt-3">{progress?.completedSteps || 0} of {progress?.totalSteps || 4} complete</p>
              </CardContent>
            </Card>

            <Card padding="sm">
              <CardHeader title="Trial and billing" />
              <CardContent>
                <TrialSummary subscription={subscription} compact />
                <Button as="a" href="/billing" variant="secondary" size="sm" className="mt-4">
                  Manage billing
                </Button>
              </CardContent>
            </Card>

            <Card padding="sm">
              <CardHeader title="Estimator setup" />
              <CardContent>
                <p className="pf-copy">Keep pricing accurate by entering paint products and production rates before live estimates.</p>
                <div className="mt-4 grid gap-2">
                  <Button as="a" href="/materials" variant="secondary" size="sm">Paint products and costs</Button>
                  <Button as="a" href="/production-rates" variant="secondary" size="sm">Production rates</Button>
                </div>
              </CardContent>
            </Card>

            {progress?.shouldShowUpsell && progress.upsell && (
              <Card padding="sm" className="border-blue-200 bg-blue-50">
                <CardHeader title={progress.upsell.title} />
                <CardContent>
                  <p className="text-sm text-blue-900">{progress.upsell.message}</p>
                  <Button as="a" href={progress.upsell.href} size="sm" className="mt-4">
                    {progress.upsell.cta}
                  </Button>
                </CardContent>
              </Card>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function TrialSummary({ subscription, compact = false }: { subscription: SubscriptionStatus; compact?: boolean }) {
  const planName = subscription?.plan?.features?.displayName || subscription?.plan?.name || 'Crewmodo';
  const trialEnd = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const status = subscription?.status || 'trial';
  const statusLabel = status === 'trial_pending_payment' ? 'Payment pending' : labelize(status);
  return (
    <div className={`rounded-lg border border-blue-100 bg-blue-50 ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="pf-row-title text-blue-950">{planName} trial</p>
        <Badge variant={status === 'active' ? 'success' : 'info'} size="sm">{statusLabel}</Badge>
      </div>
      <p className="pf-copy mt-1 text-blue-900">
        {trialEnd ? `Your trial runs through ${trialEnd}.` : 'Your subscription details will appear here after checkout.'}
        {' '}Stripe stores the payment method and handles automatic billing after the trial.
      </p>
    </div>
  );
}

function ConnectorRow({ title, copy, href }: { title: string; copy: string; href: string }) {
  return (
    <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div>
        <p className="pf-body-strong">{title}</p>
        <p className="pf-copy mt-1">{copy}</p>
      </div>
      <Button as="a" href={href} size="sm" className="justify-center">
        Set up
      </Button>
    </div>
  );
}
