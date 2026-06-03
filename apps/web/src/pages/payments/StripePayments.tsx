import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { ServiceErrorState } from '@/components/ServiceErrorState';
import { apiJson } from '@/lib/api';

interface StripeStatus {
  connected?: boolean;
  accountId?: string | null;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  detailsSubmitted?: boolean;
  onboardingComplete?: boolean;
  connectedAt?: string | null;
  updatedAt?: string | null;
}

function formatDate(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function setupState(status: StripeStatus | null) {
  if (!status?.connected) {
    return {
      label: 'Not connected',
      badge: 'warning' as const,
      title: 'Create your Stripe Express account',
      copy: 'Connect Stripe before collecting card payments, deposits, or invoice payments from customers.',
      cta: 'Start Stripe setup',
    };
  }

  if (!status.onboardingComplete) {
    return {
      label: 'Setup incomplete',
      badge: 'warning' as const,
      title: 'Finish Stripe onboarding',
      copy: 'A Stripe account was started, but Stripe still needs details before Crewmodo can collect customer payments for this workspace.',
      cta: 'Continue Stripe setup',
    };
  }

  return {
    label: 'Ready for payments',
    badge: 'success' as const,
    title: 'Stripe is ready',
    copy: 'Customer payments can be routed through your connected Stripe account.',
    cta: 'Refresh setup link',
  };
}

function StatusRow({ label, complete }: { label: string; complete: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <span className="pf-copy">{label}</span>
      <Badge variant={complete ? 'success' : 'warning'} size="sm">{complete ? 'Complete' : 'Needed'}</Badge>
    </div>
  );
}

export function StripePayments() {
  const [status, setStatus] = useState<StripeStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [action, setAction] = useState<'connect' | 'dashboard' | 'disconnect' | ''>('');
  const [error, setError] = useState<unknown>(null);

  const state = useMemo(() => setupState(status), [status]);
  const canOpenDashboard = Boolean(status?.connected && status.onboardingComplete);

  useEffect(() => {
    void loadStatus();
  }, []);

  async function loadStatus() {
    setIsLoading(true);
    setError(null);
    try {
      const payload = await apiJson<{ data?: StripeStatus }>('/v1/stripe/status');
      setStatus(payload.data || null);
    } catch (err) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }

  async function startOnboarding() {
    setAction('connect');
    try {
      const payload = await apiJson<{ url?: string }>('/v1/stripe/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
      });
      if (!payload.url) throw new Error('Stripe setup link was not returned.');
      window.location.href = payload.url;
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to start Stripe setup', 'error');
      setAction('');
    }
  }

  async function openDashboard() {
    if (!canOpenDashboard) {
      window.showToast?.('Finish Stripe setup before opening the Stripe dashboard.', 'error');
      return;
    }

    setAction('dashboard');
    try {
      const payload = await apiJson<{ url?: string }>('/v1/stripe/dashboard', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      if (!payload.url) throw new Error('Stripe dashboard link was not returned.');
      window.location.href = payload.url;
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to open Stripe dashboard', 'error');
      setAction('');
    }
  }

  async function disconnect() {
    if (!status?.connected) return;
    const confirmed = window.confirm('Disconnect Stripe for this workspace? Customer card payments will be unavailable until setup is completed again.');
    if (!confirmed) return;

    setAction('disconnect');
    try {
      await apiJson('/v1/stripe/disconnect', {
        method: 'POST',
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      window.showToast?.('Stripe disconnected', 'success');
      await loadStatus();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to disconnect Stripe', 'error');
    } finally {
      setAction('');
    }
  }

  if (error) {
    return (
      <main className="mx-auto max-w-4xl px-1 pb-24 sm:px-0">
        <ServiceErrorState error={error} pageName="Stripe payments" title="Stripe setup is unavailable" onRetry={loadStatus} compact />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-5 px-1 pb-24 sm:px-0">
      <p className="pf-page-copy">
        Connect a Stripe Express account so customers can pay deposits, invoices, and change orders online.
      </p>

      {isLoading ? (
        <Card>
          <CardContent className="flex items-center gap-3">
            <Icon name="loader" className="h-4 w-4 animate-spin text-[var(--pf-primary)]" />
            <span className="pf-copy">Checking Stripe setup...</span>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="pf-kicker">Payment account</p>
                  <h1 className="pf-section-title mt-1">{state.title}</h1>
                  <p className="pf-copy mt-1">{state.copy}</p>
                </div>
                <Badge variant={state.badge}>{state.label}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              {status?.accountId && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <p className="pf-meta">Stripe account</p>
                  <p className="pf-row-title mt-1">{status.accountId}</p>
                  {(status.updatedAt || status.connectedAt) && (
                    <p className="pf-meta mt-1">Last checked {formatDate(status.updatedAt || status.connectedAt)}</p>
                  )}
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-3">
                <StatusRow label="Business details" complete={Boolean(status?.detailsSubmitted)} />
                <StatusRow label="Card charges" complete={Boolean(status?.chargesEnabled)} />
                <StatusRow label="Payouts" complete={Boolean(status?.payoutsEnabled)} />
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" isLoading={action === 'connect'} onClick={startOnboarding}>
                  {state.cta}
                </Button>
                <Button type="button" variant="secondary" isLoading={action === 'dashboard'} disabled={!canOpenDashboard} onClick={openDashboard}>
                  Manage in Stripe
                </Button>
                {status?.connected && (
                  <Button type="button" variant="dangerSubtle" isLoading={action === 'disconnect'} onClick={disconnect}>
                    Disconnect
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="How customer payments work" />
            <CardContent className="grid gap-3">
              <div className="flex gap-3">
                <Icon name="credit-card" className="mt-0.5 h-5 w-5 shrink-0 text-[var(--pf-primary)]" />
                <div>
                  <p className="pf-row-title">Stripe handles card collection</p>
                  <p className="pf-copy">Crewmodo creates secure checkout links for accepted estimates, change orders, and invoices.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <Icon name="calendar" className="mt-0.5 h-5 w-5 shrink-0 text-[var(--pf-primary)]" />
                <div>
                  <p className="pf-row-title">Payment schedules remain configurable</p>
                  <p className="pf-copy">Deposits and milestone payments are configured in Settings and can still be recorded manually for cash, check, or ACH.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </main>
  );
}
