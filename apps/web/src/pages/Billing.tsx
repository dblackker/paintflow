import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { apiJson, formatMoney, labelize } from '@/lib/api';

interface Plan {
  id?: string;
  name?: string | null;
  price?: number | string | null;
}

interface Subscription {
  id?: string;
  status?: string | null;
  currentPeriodEnd?: string | null;
  plan?: Plan | null;
}

const planCards = [
  {
    key: 'starter',
    name: 'Starter',
    price: 49,
    copy: 'Best for a small owner-operator getting organized.',
    features: ['Up to 3 team members', '100 leads/month', 'E-signatures', 'Basic reports'],
  },
  {
    key: 'pro',
    name: 'Pro',
    price: 149,
    copy: 'For growing painting companies running sales and operations in one place.',
    features: ['Unlimited team', 'Unlimited leads', 'QuickBooks sync', 'Advanced reporting', 'Priority support'],
    popular: true,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    price: 399,
    copy: 'For larger operators that need branding, access controls, and support.',
    features: ['Everything in Pro', 'White-label', 'API access', 'Dedicated CSM'],
  },
];

function formatDate(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function PlanCard({
  plan,
  currentPlan,
  isLoading,
  onSubscribe,
}: {
  plan: typeof planCards[number];
  currentPlan?: string | null;
  isLoading: boolean;
  onSubscribe: (plan: string) => void;
}) {
  const isCurrent = currentPlan?.toLowerCase() === plan.key;
  return (
    <Card className={`relative flex flex-col ${plan.popular ? 'border-blue-600 ring-1 ring-blue-600' : ''}`}>
      {plan.popular && (
        <span className="absolute right-4 top-0 rounded-b-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
          Popular
        </span>
      )}
      <div className="min-h-20">
        <div className="flex items-center gap-2">
          <h3 className="pf-section-title">{plan.name}</h3>
          {isCurrent && <Badge variant="success" size="sm">Current</Badge>}
        </div>
        <p className="pf-copy mt-1">{plan.copy}</p>
      </div>
      <div className="my-5">
        <span className="pf-page-title">{formatMoney(plan.price, false)}</span>
        <span className="pf-copy">/month</span>
      </div>
      <ul className="mb-6 flex-1 space-y-2">
        {plan.features.map((feature) => (
          <li key={feature} className="flex gap-2 text-sm text-gray-700">
            <Icon name="plus" className="mt-0.5 h-4 w-4 rotate-45 text-green-600" />
            <span>{feature}</span>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        fullWidth
        variant={isCurrent ? 'secondary' : 'primary'}
        isLoading={isLoading}
        onClick={() => onSubscribe(plan.key)}
      >
        {plan.key === 'enterprise' ? 'Contact sales' : isCurrent ? 'Current plan' : `Choose ${plan.name}`}
      </Button>
    </Card>
  );
}

export function Billing() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isPortalLoading, setIsPortalLoading] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState('');
  const [error, setError] = useState('');

  const currentPlan = useMemo(() => subscription?.plan?.name || null, [subscription]);

  useEffect(() => {
    loadSubscription();
  }, []);

  async function loadSubscription() {
    setIsLoading(true);
    setError('');
    try {
      const payload = await apiJson<{ data?: Subscription | null }>('/v1/billing/subscription');
      setSubscription(payload.data || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subscription');
    } finally {
      setIsLoading(false);
    }
  }

  async function subscribe(plan: string) {
    if (plan === 'enterprise') {
      window.location.href = 'mailto:sales@paintflow.app';
      return;
    }
    if (currentPlan?.toLowerCase() === plan) return;
    setCheckoutPlan(plan);
    try {
      const payload = await apiJson<{ url?: string }>('/v1/billing/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      });
      if (!payload.url) throw new Error('Checkout is not configured yet');
      window.location.href = payload.url;
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to start checkout', 'error');
    } finally {
      setCheckoutPlan('');
    }
  }

  async function manageBilling() {
    setIsPortalLoading(true);
    try {
      const payload = await apiJson<{ url?: string }>('/v1/billing/portal', { method: 'POST' });
      if (!payload.url) throw new Error('Billing portal is not configured yet');
      window.location.href = payload.url;
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Failed to open billing portal', 'error');
    } finally {
      setIsPortalLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-1 pb-24 sm:px-0">
      <p className="pf-page-copy">Manage your PaintFlow plan and subscription billing.</p>

      <Card>
        <CardHeader title="Current Plan" description="Subscription billing is separate from customer deposits and contractor Stripe Connect payouts." />
        {isLoading && (
          <div className="space-y-2">
            <div className="h-5 w-1/3 animate-pulse rounded bg-gray-200" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-gray-100" />
          </div>
        )}
        {!isLoading && error && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-red-100 bg-red-50 p-4">
            <p className="pf-copy text-red-700">{error}</p>
            <Button type="button" variant="secondary" size="sm" onClick={loadSubscription}>Retry</Button>
          </div>
        )}
        {!isLoading && !error && !subscription && (
          <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
            <p className="pf-row-title">Free trial</p>
            <p className="pf-copy mt-1">No active subscription. You are on a 14-day free trial.</p>
          </div>
        )}
        {!isLoading && !error && subscription && (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="pf-section-title">{subscription.plan?.name || 'PaintFlow plan'}</p>
                <Badge variant={subscription.status === 'active' ? 'success' : 'warning'}>{labelize(subscription.status || 'active')}</Badge>
              </div>
              <p className="pf-copy mt-1">
                {formatMoney(subscription.plan?.price, false)}/month
                {subscription.currentPeriodEnd ? ` · Renews ${formatDate(subscription.currentPeriodEnd)}` : ''}
              </p>
            </div>
            <Button type="button" variant="secondary" isLoading={isPortalLoading} onClick={manageBilling}>
              Manage billing
            </Button>
          </div>
        )}
      </Card>

      <div>
        <h2 className="pf-section-title mb-3">Upgrade Your Plan</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {planCards.map((plan) => (
            <PlanCard
              key={plan.key}
              plan={plan}
              currentPlan={currentPlan}
              isLoading={checkoutPlan === plan.key}
              onSubscribe={subscribe}
            />
          ))}
        </div>
      </div>
    </main>
  );
}
