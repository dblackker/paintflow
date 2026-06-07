import { FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { UpsellCard } from '@/components/UpsellCard';
import { API_URL, apiJson, formatPhone } from '@/lib/api';

interface OrgSettings {
  companyName?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  defaultLaborRate?: string | number | null;
  materialMarkupPercent?: string | number | null;
  salesTaxRate?: string | number | null;
  paymentTerms?: string | null;
  googleReviewUrl?: string | null;
  yelpReviewUrl?: string | null;
}

interface BrandingSettings {
  companyName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
}

interface LegalSettings {
  jurisdiction?: string | null;
  contractorRegistrationNumber?: string | null;
  bondAmount?: string | null;
  contractTerms?: string | null;
  disclosureEnabled?: boolean;
  disclosureRequired?: boolean;
  disclosureTitle?: string | null;
  disclosureText?: string | null;
  legalReviewNote?: string | null;
}

interface PaymentMilestone {
  key?: string;
  label: string;
  due: string;
  percent: number | string;
  payable?: boolean;
}

interface PaymentSchedule {
  enabled?: boolean;
  milestones?: PaymentMilestone[];
}

interface ConnectorStatus {
  stripe: React.ReactNode;
  quickbooks: React.ReactNode;
  calendar: React.ReactNode;
}

interface LeadIntakeSettings {
  enabled: boolean;
  defaultSource: string;
  allowedDomains: string[];
  requireSecret: boolean;
  notifyOwners: boolean;
  secret: string;
  orgSlug: string;
  endpointUrl: string;
}

const defaultMilestones: PaymentMilestone[] = [
  { key: 'deposit', label: 'Deposit', due: 'Due after approval to reserve the schedule', percent: 40, payable: true },
  { key: 'progress', label: 'Progress payment', due: 'Due before production starts', percent: 30, payable: true },
  { key: 'completion', label: 'Final payment', due: 'Due on completion', percent: 30, payable: true },
];

const setupCards = [
  ['Company', 'Business profile', 'Company name, phone, email, and address.', '#business-settings'],
  ['Branding', 'Proposal branding', 'Customer-facing company name, logo, and brand color.', '#proposal-branding-settings'],
  ['Pricing', 'Pricing defaults', 'Labor rate, material markup, tax, and payment schedule.', '#pricing-settings'],
  ['Estimator', 'Estimator setup', 'Paint products, costs, production rates, prep defaults, and estimating assumptions.', '#estimator-settings'],
  ['Intake', 'Website lead intake', 'Connect contractor website forms, landing pages, and automation tools to Crewmodo leads.', '#lead-intake-settings'],
  ['Operations', 'Team and field setup', 'Crew roles, time clock policies, scheduling, notifications, and reusable templates.', '#operations-settings'],
  ['Connectors', 'Payments and integrations', 'Stripe deposits, Google Calendar, QuickBooks status, billing, and browser notifications.', '#integrations-settings'],
  ['Insights', 'Reports', 'Review sales, revenue, jobs, and operating metrics from one reporting surface.', '/reports'],
  ['Audit', 'Activity log', 'See customer events and operational changes across leads, estimates, and jobs.', '/activity'],
  ['Email', 'Email templates', 'Customize estimate emails and future drips, thank-yous, and change-order communication.', '/email-templates'],
  ['Reviews', 'Review links', 'Google Business and Yelp review destinations for post-job follow-up.', '#review-links-settings'],
  ['Legal', 'Contract terms', 'Set company-reviewed proposal terms, disclosures, and registration details.', '#legal-settings'],
];

function phoneDigits(value: string) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits.slice(0, 10);
}

function maskPhone(value: string) {
  return formatPhone(phoneDigits(value));
}

function numberPercent(value: unknown) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function salesTaxDisplay(value: unknown) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '';
  return numeric > 0 && numeric <= 1 ? String(Number((numeric * 100).toFixed(4))) : String(numeric || '');
}

const logoUploadLimits = {
  maxSourceBytes: 5 * 1024 * 1024,
  maxOptimizedBytes: 512 * 1024,
  minWidth: 64,
  minHeight: 32,
  maxSourceWidth: 4000,
  maxSourceHeight: 4000,
  maxOutputWidth: 640,
  maxOutputHeight: 240,
  minRatio: 0.5,
  maxRatio: 8,
};

type PreparedLogoUpload = {
  blob: Blob;
  name: string;
  previewUrl: string;
  width: number;
  height: number;
};

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function loadLogoImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Logo image could not be read.'));
    };
    image.src = url;
  });
}

function canvasToWebp(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Logo could not be optimized to WebP in this browser.'));
        return;
      }
      resolve(blob);
    }, 'image/webp', quality);
  });
}

async function prepareLogoUpload(file: File): Promise<PreparedLogoUpload> {
  const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    throw new Error('Use a PNG, JPG, or WebP logo.');
  }
  if (file.size <= 0 || file.size > logoUploadLimits.maxSourceBytes) {
    throw new Error(`Logo must be smaller than ${formatBytes(logoUploadLimits.maxSourceBytes)} before optimization.`);
  }

  const image = await loadLogoImage(file);
  const sourceWidth = image.naturalWidth;
  const sourceHeight = image.naturalHeight;
  const ratio = sourceWidth / sourceHeight;
  if (
    sourceWidth < logoUploadLimits.minWidth
    || sourceHeight < logoUploadLimits.minHeight
    || sourceWidth > logoUploadLimits.maxSourceWidth
    || sourceHeight > logoUploadLimits.maxSourceHeight
    || ratio < logoUploadLimits.minRatio
    || ratio > logoUploadLimits.maxRatio
  ) {
    throw new Error(`Logo must be at least ${logoUploadLimits.minWidth}x${logoUploadLimits.minHeight}px, no larger than ${logoUploadLimits.maxSourceWidth}x${logoUploadLimits.maxSourceHeight}px, and not extremely wide or tall.`);
  }

  const scale = Math.min(1, logoUploadLimits.maxOutputWidth / sourceWidth, logoUploadLimits.maxOutputHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Logo could not be prepared in this browser.');
  context.drawImage(image, 0, 0, width, height);

  let blob = await canvasToWebp(canvas, 0.9);
  if (blob.size > logoUploadLimits.maxOptimizedBytes) {
    blob = await canvasToWebp(canvas, 0.75);
  }
  if (blob.size > logoUploadLimits.maxOptimizedBytes) {
    throw new Error(`Optimized logo must be smaller than ${formatBytes(logoUploadLimits.maxOptimizedBytes)}.`);
  }

  return {
    blob,
    name: file.name,
    previewUrl: URL.createObjectURL(blob),
    width,
    height,
  };
}

function slugify(value: string, fallback: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || fallback;
}

function ActionCard({ href, title, copy }: { href: string; title: string; copy: string }) {
  return (
    <Link to={href} className="flex min-h-[4.25rem] items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 transition hover:border-blue-200 hover:bg-blue-50/40 hover:shadow-sm sm:p-4">
      <span className="min-w-0">
        <span className="block font-semibold text-gray-950">{title}</span>
        <span className="pf-copy mt-0.5 block">{copy}</span>
      </span>
      <span className="btn-text btn-sm pointer-events-none shrink-0">Open</span>
    </Link>
  );
}

function FieldLabel({ label, help }: { label: string; help?: string }) {
  const tooltipId = `settings-help-${useId().replace(/:/g, '')}`;
  const [open, setOpen] = useState(false);

  return (
    <span className="form-label inline-flex items-center gap-1.5">
      {label}
      {help && (
        <span
          className="group relative inline-flex"
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120);
          }}
        >
          <button
            type="button"
            className="btn-icon h-5 w-5 text-gray-500"
            aria-label={`Explain ${label}`}
            aria-expanded={open}
            aria-describedby={tooltipId}
            onClick={() => setOpen((current) => !current)}
          >
            <Icon name="info" className="h-3.5 w-3.5" />
          </button>
          <span
            id={tooltipId}
            role="tooltip"
            className={`pointer-events-none absolute left-1/2 top-full z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-3 text-xs font-normal leading-5 text-gray-700 shadow-lg group-hover:block group-focus-within:block sm:left-full sm:top-1/2 sm:ml-2 sm:mt-0 sm:-translate-y-1/2 sm:translate-x-0 ${open ? 'block' : 'hidden'}`}
          >
            {help}
          </span>
        </span>
      )}
    </span>
  );
}

export function Settings() {
  const location = useLocation();
  const [settings, setSettings] = useState<OrgSettings>({});
  const [branding, setBranding] = useState<BrandingSettings>({ primaryColor: '#2563eb' });
  const [legal, setLegal] = useState<LegalSettings>({});
  const [logoUpload, setLogoUpload] = useState<PreparedLogoUpload | null>(null);
  const [logoUploadError, setLogoUploadError] = useState('');
  const [milestones, setMilestones] = useState<PaymentMilestone[]>(defaultMilestones);
  const [connectors, setConnectors] = useState<ConnectorStatus>({
    stripe: 'Checking...',
    quickbooks: 'Check QuickBooks settings',
    calendar: 'Checking...',
  });
  const [leadIntake, setLeadIntake] = useState<LeadIntakeSettings | null>(null);
  const [allowedDomainsText, setAllowedDomainsText] = useState('');
  const [testLeadEmail, setTestLeadEmail] = useState('demo-lead@example.com');
  const [stripeReady, setStripeReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const paymentTotal = useMemo(
    () => milestones.reduce((sum, milestone) => sum + numberPercent(milestone.percent), 0),
    [milestones],
  );
  const paymentTotalOk = Math.abs(paymentTotal - 100) <= 0.01;

  useEffect(() => {
    if (!location.hash || isLoading) return undefined;
    const targetId = decodeURIComponent(location.hash.slice(1));
    const timer = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ block: 'start' });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isLoading, location.hash]);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => () => {
    if (logoUpload?.previewUrl) URL.revokeObjectURL(logoUpload.previewUrl);
  }, [logoUpload?.previewUrl]);

  async function loadSettings() {
    setIsLoading(true);
    setError('');
    try {
      const [orgPayload, brandingPayload, legalPayload, schedulePayload, leadIntakePayload] = await Promise.all([
        apiJson<{ data?: OrgSettings }>('/v1/settings/org'),
        apiJson<{ data?: BrandingSettings }>('/v1/settings/branding'),
        apiJson<{ data?: LegalSettings }>('/v1/settings/legal'),
        apiJson<{ data?: PaymentSchedule }>('/v1/settings/payment-schedule'),
        apiJson<{ data?: LeadIntakeSettings }>('/v1/settings/lead-intake'),
      ]);
      const org = orgPayload.data || {};
      setSettings({ ...org, phone: org.phone ? maskPhone(String(org.phone)) : '', salesTaxRate: salesTaxDisplay(org.salesTaxRate) });
      setBranding({ primaryColor: '#2563eb', ...(brandingPayload.data || {}) });
      setLegal(legalPayload.data || {});
      setMilestones((schedulePayload.data?.milestones?.length ? schedulePayload.data.milestones : defaultMilestones).map((milestone) => ({
        ...milestone,
        payable: milestone.payable !== false,
      })));
      const intake = leadIntakePayload.data || null;
      setLeadIntake(intake);
      setAllowedDomainsText((intake?.allowedDomains || []).join('\n'));
      void loadConnectorStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setIsLoading(false);
    }
  }

  async function loadConnectorStatus() {
    const next: ConnectorStatus = { stripe: 'Checking...', quickbooks: 'Check QuickBooks settings', calendar: 'Checking...' };
    try {
      const calendarResponse = await fetch(`${API_URL}/v1/calendar/status`, { credentials: 'include' });
      const calendar = await calendarResponse.json().catch(() => ({}));
      next.calendar = calendar.connected ? <span className="text-green-700">Connected</span> : 'Not connected';
    } catch {
      next.calendar = 'Not connected';
    }
    try {
      const stripePayload = await apiJson<{ data?: { onboardingComplete?: boolean } }>('/v1/stripe/status');
      const isReady = Boolean(stripePayload.data?.onboardingComplete);
      setStripeReady(isReady);
      next.stripe = isReady ? <span className="text-green-700">Ready for deposits</span> : <Link to="/payments/stripe" className="text-blue-700">Set up payments</Link>;
    } catch {
      setStripeReady(false);
      next.stripe = <Link to="/payments/stripe" className="text-blue-700">Set up payments</Link>;
    }
    setConnectors(next);
  }

  async function saveOrgPatch(section: string, patch: Record<string, unknown>, toast: string) {
    setSaving(section);
    try {
      const payload = await apiJson<{ data?: OrgSettings }>('/v1/settings/org', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const next = payload.data || {};
      setSettings({ ...next, phone: next.phone ? maskPhone(String(next.phone)) : '', salesTaxRate: salesTaxDisplay(next.salesTaxRate) });
      window.showToast?.(toast, 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to save settings', 'error');
    } finally {
      setSaving(null);
    }
  }

  async function saveBusiness(event: FormEvent) {
    event.preventDefault();
    const digits = phoneDigits(String(settings.phone || ''));
    if (settings.phone && digits.length !== 10) {
      window.showToast?.('Enter a 10-digit phone number', 'error');
      return;
    }
    await saveOrgPatch('business', {
      companyName: settings.companyName,
      phone: settings.phone ? maskPhone(String(settings.phone)) : undefined,
      email: settings.email,
      address: settings.address,
    }, 'Business info saved');
  }

  async function savePricing(event: FormEvent) {
    event.preventDefault();
    await saveOrgPatch('pricing', {
      defaultLaborRate: settings.defaultLaborRate,
      materialMarkupPercent: settings.materialMarkupPercent,
      salesTaxRate: settings.salesTaxRate,
      paymentTerms: settings.paymentTerms,
    }, 'Pricing saved');
  }

  async function saveReviews(event: FormEvent) {
    event.preventDefault();
    await saveOrgPatch('reviews', {
      googleReviewUrl: settings.googleReviewUrl,
      yelpReviewUrl: settings.yelpReviewUrl,
    }, 'Review links saved');
  }

  async function saveBranding(event: FormEvent) {
    event.preventDefault();
    setSaving('branding');
    try {
      let nextBranding = branding;
      if (logoUpload) {
        const formData = new FormData();
        formData.append('file', new File([logoUpload.blob], 'logo.webp', { type: 'image/webp' }));
        const uploadPayload = await apiJson<{ data?: BrandingSettings }>('/v1/settings/branding/logo', {
          method: 'PUT',
          body: formData,
        });
        nextBranding = { ...nextBranding, ...(uploadPayload.data || {}) };
      }

      const payload = await apiJson<{ data?: BrandingSettings }>('/v1/settings/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: nextBranding.companyName,
          primaryColor: nextBranding.primaryColor,
        }),
      });
      setBranding({ primaryColor: '#2563eb', ...nextBranding, ...(payload.data || {}) });
      if (logoUpload?.previewUrl) URL.revokeObjectURL(logoUpload.previewUrl);
      setLogoUpload(null);
      setLogoUploadError('');
      window.showToast?.('Branding saved', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to save branding', 'error');
    } finally {
      setSaving(null);
    }
  }

  async function handleLogoChange(file: File | null) {
    if (logoUpload?.previewUrl) URL.revokeObjectURL(logoUpload.previewUrl);
    setLogoUpload(null);
    setLogoUploadError('');
    if (!file) return;

    try {
      setLogoUpload(await prepareLogoUpload(file));
    } catch (err) {
      setLogoUploadError(err instanceof Error ? err.message : 'Logo could not be prepared.');
    }
  }

  async function saveLegal(event: FormEvent) {
    event.preventDefault();
    setSaving('legal');
    try {
      const payload = await apiJson<{ data?: LegalSettings }>('/v1/settings/legal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(legal),
      });
      setLegal(payload.data || legal);
      window.showToast?.('Contract terms saved', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to save terms', 'error');
    } finally {
      setSaving(null);
    }
  }

  async function savePaymentSchedule(event: FormEvent) {
    event.preventDefault();
    const valid = milestones
      .filter((milestone) => String(milestone.label).trim() && String(milestone.due).trim() && numberPercent(milestone.percent) > 0)
      .map((milestone, index) => ({
        ...milestone,
        key: slugify(String(milestone.label), `payment_${index + 1}`),
        percent: numberPercent(milestone.percent),
        payable: Boolean(milestone.payable),
      }));
    if (!valid.length) {
      window.showToast?.('Add at least one payment milestone', 'error');
      return;
    }
    if (!paymentTotalOk) {
      window.showToast?.('Payment milestones must total 100%', 'error');
      return;
    }
    setSaving('schedule');
    try {
      const payload = await apiJson<{ data?: PaymentSchedule }>('/v1/settings/payment-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true, milestones: valid }),
      });
      setMilestones(payload.data?.milestones?.length ? payload.data.milestones : valid);
      window.showToast?.('Payment schedule saved', 'success');
      await loadSettings();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to save payment schedule', 'error');
    } finally {
      setSaving(null);
    }
  }

  function updateMilestone(index: number, patch: Partial<PaymentMilestone>) {
    setMilestones((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  }

  async function saveLeadIntake(event: FormEvent) {
    event.preventDefault();
    if (!leadIntake) return;
    setSaving('lead-intake');
    try {
      const payload = await apiJson<{ data?: LeadIntakeSettings }>('/v1/settings/lead-intake', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: leadIntake.enabled,
          defaultSource: leadIntake.defaultSource,
          allowedDomains: allowedDomainsText.split(/\r?\n|,/).map((domain) => domain.trim()).filter(Boolean),
          requireSecret: leadIntake.requireSecret,
          notifyOwners: leadIntake.notifyOwners,
        }),
      });
      const next = payload.data || leadIntake;
      setLeadIntake(next);
      setAllowedDomainsText((next.allowedDomains || []).join('\n'));
      window.showToast?.('Lead intake settings saved', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to save lead intake settings', 'error');
    } finally {
      setSaving(null);
    }
  }

  async function rotateLeadSecret() {
    setSaving('lead-secret');
    try {
      const payload = await apiJson<{ data?: LeadIntakeSettings }>('/v1/settings/lead-intake/rotate-secret', {
        method: 'POST',
      });
      if (payload.data) {
        setLeadIntake(payload.data);
        setAllowedDomainsText((payload.data.allowedDomains || []).join('\n'));
      }
      window.showToast?.('Lead intake secret rotated', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to rotate secret', 'error');
    } finally {
      setSaving(null);
    }
  }

  async function submitTestLead() {
    if (!leadIntake?.endpointUrl) return;
    setSaving('lead-test');
    try {
      const headers = new Headers({ 'Content-Type': 'application/json', 'Idempotency-Key': `settings-test-${Date.now()}` });
      if (leadIntake.requireSecret && leadIntake.secret) {
        headers.set('x-crewmodo-lead-secret', leadIntake.secret);
      }
      const response = await fetch(leadIntake.endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: 'Crewmodo Test Lead',
          email: testLeadEmail,
          phone: '(555) 010-0101',
          city: 'San Francisco',
          state: 'CA',
          source: leadIntake.defaultSource || 'Website form',
          sourceType: 'website_test',
          message: 'Test submission from Crewmodo lead intake settings.',
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body?.error || 'Test lead failed');
      window.showToast?.(body?.data?.duplicate ? 'Test matched an existing lead' : 'Test lead created', 'success');
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to submit test lead', 'error');
    } finally {
      setSaving(null);
    }
  }

  async function copyText(value: string, success: string) {
    try {
      await navigator.clipboard.writeText(value);
      window.showToast?.(success, 'success');
    } catch {
      window.showToast?.('Copy failed. Select the text and copy it manually.', 'error');
    }
  }

  const leadEmbedSnippet = useMemo(() => {
    if (!leadIntake?.endpointUrl) return '';
    return `<form id="crewmodo-lead-form">
  <input name="name" placeholder="Name" required />
  <input name="email" type="email" placeholder="Email" />
  <input name="phone" type="tel" placeholder="Phone" />
  <input name="streetAddress" placeholder="Project address" />
  <textarea name="message" placeholder="Tell us about the project"></textarea>
  <input name="company" tabindex="-1" autocomplete="off" style="display:none" />
  <button type="submit">Request estimate</button>
</form>
<script>
document.getElementById('crewmodo-lead-form').addEventListener('submit', async function (event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form).entries());
  const response = await fetch('${leadIntake.endpointUrl}', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ ...data, source: '${leadIntake.defaultSource || 'Website form'}', sourceType: 'website' })
  });
  if (!response.ok) throw new Error('Lead submission failed');
  form.reset();
});
</script>`;
  }, [leadIntake]);

  if (isLoading) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-b-2 border-blue-600" />
          <p className="pf-copy mt-4">Loading settings...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <section className="mb-5 rounded-lg border border-blue-100 bg-blue-50/70 p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="pf-meta text-blue-700">Owner setup</p>
            <p className="pf-copy mt-1 max-w-3xl">
              Configure the business defaults that make Crewmodo usable in the field: pricing, production rates, materials, team roles, payments, and customer-facing branding.
            </p>
          </div>
          <Link to="/onboarding" className="btn-primary btn-sm justify-center">Review</Link>
        </div>
      </section>

      {error && (
        <Card className="mb-5 border-red-100 bg-red-50" padding="sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="pf-copy text-red-700">{error}</p>
            <button type="button" className="btn-secondary btn-sm" onClick={loadSettings}>Retry</button>
          </div>
        </Card>
      )}

      <section className="mb-6">
        <div className="mb-3">
          <h2 className="pf-section-title">Setup checklist</h2>
          <p className="pf-copy mt-1">Use these sections to get a contractor workspace ready before sending live estimates or scheduling crews.</p>
        </div>
        <div className="grid gap-3">
          {setupCards.map(([pill, title, copy, href]) => (
            <Link key={title} to={href.startsWith('#') ? `/settings${href}` : href} className="grid gap-2 rounded-lg border border-gray-200 bg-white p-4 transition hover:border-blue-200 hover:bg-blue-50/40 hover:shadow-sm sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-start">
              <span className="w-fit rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold uppercase text-gray-700">{pill}</span>
              <span className="min-w-0">
                <span className="pf-section-title block">{title}</span>
                <span className="pf-copy mt-1 block">{copy}</span>
              </span>
              <span className="btn-text btn-sm pointer-events-none hidden sm:inline-flex">Open</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6">
        <Card id="business-settings" padding="lg" className="scroll-mt-20">
          <CardHeader title="Business Information" />
          <form className="grid gap-4" onSubmit={saveBusiness}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <FieldLabel label="Company name" />
                <input className="input" autoComplete="organization" value={settings.companyName || ''} onChange={(event) => setSettings({ ...settings, companyName: event.target.value })} placeholder="Blackline Painting" />
              </label>
              <label className="grid gap-1.5">
                <FieldLabel label="Business phone" />
                <input className="input" type="tel" autoComplete="tel" inputMode="numeric" maxLength={14} value={settings.phone || ''} onChange={(event) => setSettings({ ...settings, phone: maskPhone(event.target.value) })} placeholder="(555) 123-4567" />
              </label>
            </div>
            <label className="grid gap-1.5">
              <FieldLabel label="Business email" />
              <input className="input" type="email" autoComplete="email" inputMode="email" value={settings.email || ''} onChange={(event) => setSettings({ ...settings, email: event.target.value })} placeholder="office@example.com" />
            </label>
            <label className="grid gap-1.5">
              <FieldLabel label="Business address" />
              <input className="input" autoComplete="street-address" value={settings.address || ''} onChange={(event) => setSettings({ ...settings, address: event.target.value })} placeholder="123 Main St, San Francisco, CA" />
            </label>
            <Button type="submit" isLoading={saving === 'business'} className="w-full sm:w-fit">Save</Button>
          </form>
        </Card>

        <Card id="proposal-branding-settings" padding="lg" className="scroll-mt-20">
          <CardHeader title="Branding & Proposals" />
          <form className="grid gap-4" onSubmit={saveBranding}>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
              <label className="grid gap-1.5">
                <FieldLabel label="Proposal company name" />
                <input className="input" autoComplete="organization" value={branding.companyName || ''} onChange={(event) => setBranding({ ...branding, companyName: event.target.value })} placeholder="Blackline Painting" />
              </label>
              <label className="grid gap-1.5">
                <FieldLabel label="Brand color" />
                <input className="h-11 w-full rounded-lg border border-gray-300" type="color" value={branding.primaryColor || '#2563eb'} onChange={(event) => setBranding({ ...branding, primaryColor: event.target.value })} />
              </label>
            </div>
            <label className="grid gap-1.5">
              <FieldLabel label="Logo" help="Upload a PNG, JPG, or WebP logo. Crewmodo optimizes it to WebP and stores it for customer-facing proposals." />
              <input
                className="input py-3"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  void handleLogoChange(event.target.files?.[0] || null);
                  event.target.value = '';
                }}
              />
              <span className="pf-meta">PNG, JPG, or WebP. Source file under 5 MB. Recommended landscape logo, at least 64x32px.</span>
            </label>
            {logoUploadError && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{logoUploadError}</p>
            )}
            {(logoUpload?.previewUrl || branding.logoUrl) && (
              <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="pf-row-title">Logo preview</p>
                  <p className="pf-helper mt-1">
                    {logoUpload
                      ? `Prepared as WebP (${logoUpload.width}x${logoUpload.height}, ${formatBytes(logoUpload.blob.size)}). Save branding to publish it.`
                      : 'Current logo used on customer-facing proposals.'}
                  </p>
                </div>
                <div className="flex h-16 min-w-36 items-center justify-center rounded-lg border border-gray-200 bg-white px-4">
                  <img src={logoUpload?.previewUrl || branding.logoUrl || ''} className="max-h-12 max-w-48 object-contain" alt="Logo preview" />
                </div>
              </div>
            )}
            <Button type="submit" isLoading={saving === 'branding'} className="w-full sm:w-fit">Save Branding</Button>
          </form>
        </Card>

        <Card id="pricing-settings" padding="lg" className="scroll-mt-20">
          <CardHeader title="Pricing & Tax" />
          <form className="grid gap-4" onSubmit={savePricing}>
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="grid gap-1.5">
                <FieldLabel label="Labor Rate ($/hr)" />
                <input className="input" type="number" min="0" step="0.01" inputMode="decimal" value={settings.defaultLaborRate ?? ''} onChange={(event) => setSettings({ ...settings, defaultLaborRate: event.target.value })} />
              </label>
              <label className="grid gap-1.5">
                <FieldLabel label="Material Markup (%)" />
                <input className="input" type="number" min="0" step="0.1" inputMode="decimal" value={settings.materialMarkupPercent ?? ''} onChange={(event) => setSettings({ ...settings, materialMarkupPercent: event.target.value })} />
              </label>
              <label className="grid gap-1.5">
                <FieldLabel label="Sales Tax (%)" />
                <input className="input" type="number" min="0" step="0.01" inputMode="decimal" value={settings.salesTaxRate ?? ''} onChange={(event) => setSettings({ ...settings, salesTaxRate: event.target.value })} />
              </label>
            </div>
            <label className="grid gap-1.5">
              <FieldLabel label="Payment terms summary" />
              <input className="input" maxLength={255} value={settings.paymentTerms || ''} onChange={(event) => setSettings({ ...settings, paymentTerms: event.target.value })} placeholder="40% deposit, 30% before production, balance due on completion" />
              <span className="pf-meta">Shown on proposals as the short summary. The milestone schedule below controls deposit and payment amounts.</span>
            </label>
            <Button type="submit" isLoading={saving === 'pricing'} className="w-full sm:w-fit">Save</Button>
          </form>

          <form id="payment-schedule-settings" className="mt-6 grid scroll-mt-24 gap-4 border-t border-gray-200 pt-5" onSubmit={savePaymentSchedule}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="pf-section-title">Deposit & Payment Schedule</h4>
                <p className="pf-copy mt-1">Define the payment milestones customers see on proposals. Percentages must total 100%.</p>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setMilestones([...milestones, { key: `payment_${milestones.length + 1}`, label: 'Progress payment', due: 'Due before the next phase starts', percent: 0, payable: true }])}>
                Add Payment
              </Button>
            </div>
            {!stripeReady && (
              <UpsellCard
                eyebrow="Recommended setup"
                title="Connect Stripe to collect scheduled payments online"
                body="Milestones are set up for online payments by default. Connect Stripe before customers can pay deposits, progress payments, or final balances by card."
                ctaText="Set up Stripe"
                icon="credit-card"
                compact
                onCta={() => { window.location.href = '/payments/stripe'; }}
              />
            )}
            <div className="grid gap-2">
              {milestones.map((milestone, index) => (
                <div key={`${milestone.key || 'payment'}-${index}`} className="grid gap-3 rounded-lg border border-gray-200 p-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.5fr)_6rem_7rem_auto] sm:items-end">
                  <label className="grid gap-1.5">
                    <FieldLabel label="Milestone" />
                    <input className="input" maxLength={80} value={milestone.label} onChange={(event) => updateMilestone(index, { label: event.target.value })} />
                  </label>
                  <label className="grid gap-1.5">
                    <FieldLabel label="Due" />
                    <input className="input" maxLength={160} value={milestone.due} onChange={(event) => updateMilestone(index, { due: event.target.value })} />
                  </label>
                  <label className="grid gap-1.5">
                    <FieldLabel label="Percent" />
                    <input className="input" type="number" min="0.1" max="100" step="0.1" inputMode="decimal" value={milestone.percent} onChange={(event) => updateMilestone(index, { percent: event.target.value })} />
                  </label>
                  <label className={`flex items-center gap-2 pb-2 text-sm ${stripeReady ? 'text-gray-700' : 'text-gray-500'}`}>
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 disabled:bg-gray-100"
                      checked={Boolean(milestone.payable)}
                      disabled={!stripeReady}
                      onChange={(event) => updateMilestone(index, { payable: event.target.checked })}
                    />
                    Online pay
                  </label>
                  <button type="button" className="btn-icon btn-icon-tonal justify-self-end" aria-label="Remove payment milestone" onClick={() => setMilestones((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                    <Icon name="close" className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <p className={`pf-row-title ${paymentTotalOk ? 'text-green-700' : 'text-red-700'}`}>Configured total: {Math.round(paymentTotal * 10) / 10}%</p>
            <Button type="submit" isLoading={saving === 'schedule'} className="w-full sm:w-fit">Save Schedule</Button>
          </form>
        </Card>

        <Card id="estimator-settings" padding="lg" className="scroll-mt-20">
          <CardHeader title="Estimator Setup" description="Keep labor production and paint product costs current before sending live estimates." />
          <div className="grid gap-3">
            <ActionCard href="/materials" title="Paint products and costs" copy="Enter cost per gallon/unit, coverage, supplier, SKU, and markup." />
            <ActionCard href="/production-rates" title="Production rates" copy="Tune sqft/hr, linear ft/hr, labor rate, coats, and prep defaults." />
          </div>
        </Card>

        <Card id="lead-intake-settings" padding="lg" className="scroll-mt-20">
          <CardHeader
            title="Website Lead Intake"
            description="Connect website forms, landing pages, Zapier, Make, or another CRM into Crewmodo without giving them app access."
          />
          {leadIntake ? (
            <form className="grid gap-5" onSubmit={saveLeadIntake}>
              <div className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="pf-meta">Webhook endpoint</p>
                    <p className="mt-1 break-all font-mono text-sm text-gray-950">{leadIntake.endpointUrl}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                    <Button as="a" href="/developers/lead-intake" variant="ghost" size="sm" leftIcon={<Icon name="file-text" className="h-4 w-4" />}>
                      Developer docs
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => copyText(leadIntake.endpointUrl, 'Lead endpoint copied')}>
                      Copy endpoint
                    </Button>
                  </div>
                </div>
                <p className="pf-helper">Use this URL as the POST target from the contractor website or automation tool. Crewmodo creates the lead, source, activity, audit log, and notification.</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3">
                  <input
                    type="checkbox"
                    className="mt-1 rounded border-gray-300"
                    checked={leadIntake.enabled}
                    onChange={(event) => setLeadIntake({ ...leadIntake, enabled: event.target.checked })}
                  />
                  <span>
                    <span className="pf-row-title block">Accept website leads</span>
                    <span className="pf-copy block">Turn this off if a form is being abused or a contractor wants to pause intake.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3">
                  <input
                    type="checkbox"
                    className="mt-1 rounded border-gray-300"
                    checked={leadIntake.requireSecret}
                    onChange={(event) => setLeadIntake({ ...leadIntake, requireSecret: event.target.checked })}
                  />
                  <span>
                    <span className="pf-row-title block">Require server secret</span>
                    <span className="pf-copy block">Best for server-to-server tools. Do not place this secret in public website JavaScript.</span>
                  </span>
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <FieldLabel label="Default source" help="Used when the incoming form does not send a source. Examples: Website form, Google landing page, Meta lead ad." />
                  <input
                    className="input"
                    maxLength={100}
                    value={leadIntake.defaultSource || ''}
                    onChange={(event) => setLeadIntake({ ...leadIntake, defaultSource: event.target.value })}
                    placeholder="Website form"
                  />
                </label>
                <label className="grid gap-1.5">
                  <FieldLabel label="Test email" help="Used only for the test lead button below. Pick an address you can easily find and delete later." />
                  <input
                    className="input"
                    type="email"
                    inputMode="email"
                    value={testLeadEmail}
                    onChange={(event) => setTestLeadEmail(event.target.value)}
                  />
                </label>
              </div>

              <label className="grid gap-1.5">
                <FieldLabel label="Allowed website domains" help="Optional. Add one domain per line. If populated, browser submissions must originate from these domains or their subdomains." />
                <textarea
                  className="input min-h-28 font-mono text-sm"
                  value={allowedDomainsText}
                  onChange={(event) => setAllowedDomainsText(event.target.value)}
                  placeholder="example.com&#10;landing.example.com"
                />
                <span className="pf-meta">Leave blank for automation tools or if the contractor website is still being configured.</span>
              </label>

              <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="pf-row-title">Server secret</p>
                    <p className="pf-copy mt-1">Send as <code className="rounded bg-gray-100 px-1 py-0.5">x-crewmodo-lead-secret</code> when “Require server secret” is enabled.</p>
                    <p className="mt-2 break-all font-mono text-xs text-gray-700">{leadIntake.secret || 'Save settings to generate a secret.'}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button type="button" variant="secondary" size="sm" disabled={!leadIntake.secret} onClick={() => copyText(leadIntake.secret, 'Lead secret copied')}>
                      Copy
                    </Button>
                    <Button type="button" variant="ghost" size="sm" isLoading={saving === 'lead-secret'} onClick={rotateLeadSecret}>
                      Rotate
                    </Button>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 rounded-lg border border-blue-100 bg-blue-50/60 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="pf-row-title">Copy/paste website snippet</p>
                    <p className="pf-copy mt-1">This is a starter form for a contractor website. Use the server secret only from backend code, not this browser snippet.</p>
                  </div>
                  <Button type="button" variant="secondary" size="sm" onClick={() => copyText(leadEmbedSnippet, 'Embed snippet copied')}>
                    Copy snippet
                  </Button>
                </div>
                <textarea className="input min-h-56 font-mono text-xs" readOnly value={leadEmbedSnippet} />
              </div>

              <div className="flex flex-col gap-2 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <Button type="submit" isLoading={saving === 'lead-intake'} className="w-full sm:w-fit">Save Lead Intake</Button>
                <Button type="button" variant="secondary" isLoading={saving === 'lead-test'} onClick={submitTestLead} className="w-full sm:w-fit">
                  Send Test Lead
                </Button>
              </div>
            </form>
          ) : (
            <p className="pf-copy">Lead intake settings could not be loaded.</p>
          )}
        </Card>

        <Card id="legal-settings" padding="lg" className="scroll-mt-20">
          <CardHeader title="Contract Terms & Disclosures" description="Configure company-reviewed language shown to customers before they sign a proposal. Crewmodo stores the accepted snapshot in estimate activity." />
          <form className="grid gap-4" onSubmit={saveLegal}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5">
                <FieldLabel label="Jurisdiction" />
                <input className="input" maxLength={80} value={legal.jurisdiction || ''} onChange={(event) => setLegal({ ...legal, jurisdiction: event.target.value })} placeholder="WA" />
              </label>
              <label className="grid gap-1.5">
                <FieldLabel label="Registration/license number" />
                <input className="input" maxLength={120} value={legal.contractorRegistrationNumber || ''} onChange={(event) => setLegal({ ...legal, contractorRegistrationNumber: event.target.value })} placeholder="Contractor registration #" />
              </label>
            </div>
            <label className="grid gap-1.5">
              <FieldLabel label="Bond/insurance summary" />
              <input className="input" maxLength={120} value={legal.bondAmount || ''} onChange={(event) => setLegal({ ...legal, bondAmount: event.target.value })} placeholder="Bonded and insured per state requirements" />
            </label>
            <label className="grid gap-1.5">
              <FieldLabel label="Contract terms" />
              <textarea className="input min-h-44" maxLength={12000} value={legal.contractTerms || ''} onChange={(event) => setLegal({ ...legal, contractTerms: event.target.value })} placeholder="Scope, payment terms, change orders, warranty, access, and exclusions." />
            </label>
            <div className="grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 rounded border-gray-300" checked={Boolean(legal.disclosureEnabled)} onChange={(event) => setLegal({ ...legal, disclosureEnabled: event.target.checked })} />
                <span>
                  <span className="pf-row-title block">Show statutory disclosure before signature</span>
                  <span className="pf-copy block">Use for state-required notices, lien disclosures, cancellation language, or other contractor-specific legal copy.</span>
                </span>
              </label>
              <label className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 rounded border-gray-300" checked={Boolean(legal.disclosureRequired)} onChange={(event) => setLegal({ ...legal, disclosureRequired: event.target.checked })} />
                <span>
                  <span className="pf-row-title block">Require customer acknowledgement</span>
                  <span className="pf-copy block">Customers must check an acknowledgement box before the signature modal opens.</span>
                </span>
              </label>
            </div>
            <label className="grid gap-1.5">
              <FieldLabel label="Disclosure title" />
              <input className="input" maxLength={255} value={legal.disclosureTitle || ''} onChange={(event) => setLegal({ ...legal, disclosureTitle: event.target.value })} placeholder="Required disclosure" />
            </label>
            <label className="grid gap-1.5">
              <FieldLabel label="Disclosure text" />
              <textarea className="input min-h-36" maxLength={12000} value={legal.disclosureText || ''} onChange={(event) => setLegal({ ...legal, disclosureText: event.target.value })} placeholder="Paste the exact disclosure language your company wants customers to acknowledge." />
            </label>
            <label className="grid gap-1.5">
              <FieldLabel label="Internal legal review note" />
              <input className="input" maxLength={1000} value={legal.legalReviewNote || ''} onChange={(event) => setLegal({ ...legal, legalReviewNote: event.target.value })} />
            </label>
            <Button type="submit" isLoading={saving === 'legal'} className="w-full sm:w-fit">Save Terms</Button>
          </form>
        </Card>

        <Card id="operations-settings" padding="lg" className="scroll-mt-20">
          <CardHeader title="Operations Setup" description="Configure the workflows that crew leads and office admins use every day." />
          <div className="grid gap-3">
            <ActionCard href="/team" title="Team and roles" copy="Manage active crew members, roles, rates, and time clock policies." />
            <ActionCard href="/calendar" title="Calendar scheduling" copy="Schedule jobs by day and connect Google Calendar when ready." />
            <ActionCard href="/templates" title="Templates" copy="Reusable estimate, message, and follow-up language." />
            <ActionCard href="/email-templates" title="Email templates" copy="Proposal emails, future drips, thank-yous, and change-order communication." />
            <ActionCard href="/notifications" title="Notifications" copy="Review messages, accepted estimates, and browser alert readiness." />
          </div>
        </Card>

        <Card id="integrations-settings" padding="lg" className="scroll-mt-20">
          <CardHeader title="Connectors" />
          <div className="grid gap-3">
            {[
              ['Stripe', connectors.stripe],
              ['QuickBooks', connectors.quickbooks],
              ['Google Calendar', connectors.calendar],
            ].map(([label, status]) => (
              <div key={label as string} className="flex flex-col gap-1 rounded-lg border border-gray-200 p-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium text-gray-950">{label}</span>
                <span className="pf-copy">{status}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-3">
            <ActionCard href="/payments/stripe" title="Stripe payments" copy="Collect deposits and customer payments." />
            <ActionCard href="/billing" title="Billing" copy="Manage the Crewmodo subscription and account status." />
            <ActionCard href="/notifications" title="Browser notifications" copy="Enable alerts for new messages and accepted estimates." />
          </div>
        </Card>

        <Card id="review-links-settings" padding="lg" className="scroll-mt-20">
          <CardHeader title="Review Links" />
          <form className="grid gap-4" onSubmit={saveReviews}>
            <label className="grid gap-1.5">
              <FieldLabel label="Google Business review URL" help="The direct Google review link customers use after a completed job. Crewmodo can send happy customers here after they rate the project highly." />
              <input className="input" type="url" inputMode="url" autoComplete="url" value={settings.googleReviewUrl || ''} onChange={(event) => setSettings({ ...settings, googleReviewUrl: event.target.value })} placeholder="https://g.page/r/..." />
            </label>
            <label className="grid gap-1.5">
              <FieldLabel label="Yelp review URL" help="Optional Yelp review destination for customers who prefer Yelp or for future review-request routing by source, city, or campaign." />
              <input className="input" type="url" inputMode="url" autoComplete="url" value={settings.yelpReviewUrl || ''} onChange={(event) => setSettings({ ...settings, yelpReviewUrl: event.target.value })} placeholder="Optional" />
            </label>
            <Button type="submit" isLoading={saving === 'reviews'} className="w-full sm:w-fit">Save</Button>
          </form>
        </Card>
      </div>
    </main>
  );
}
