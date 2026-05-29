import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { apiJson, formatMoney, labelize } from '@/lib/api';
import { PLAN_DEFINITIONS, PLAN_ORDER } from '@crewmodo/core';

interface Plan {
  id?: string;
  name?: string | null;
  price?: number | string | null;
  features?: {
    displayName?: string;
    featureCopy?: string[];
    seatCopy?: string;
  } | null;
}

interface Subscription {
  id?: string;
  status?: string | null;
  currentPeriodEnd?: string | null;
  plan?: Plan | null;
}

const planCards = PLAN_ORDER.map((key) => PLAN_DEFINITIONS[key]);

function formatDate(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function planDisplayName(planName?: string | null) {
  if (!planName) return 'Starter';
  const match = planCards.find((plan) => plan.key === planName.toLowerCase() || plan.displayName.toLowerCase() === planName.toLowerCase());
  return match?.displayName || labelize(planName);
}

function planPrice(planName?: string | null, fallback?: number | string | null) {
  if (fallback !== null && fallback !== undefined && fallback !== '') return Number(fallback);
  const match = planCards.find((plan) => plan.key === planName?.toLowerCase() || plan.displayName.toLowerCase() === planName?.toLowerCase());
  return Number(match?.price || 79);
}

function isTrialStatus(status?: string | null) {
  return ['trial', 'trialing', 'trial_pending_payment'].includes(String(status || '').toLowerCase());
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
    <Card className={`relative flex flex-col ${plan.key === 'pro' ? 'border-blue-600 ring-1 ring-blue-600' : ''}`}>
      {plan.key === 'pro' && (
        <span className="absolute right-4 top-0 rounded-b-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
          Popular
        </span>
      )}
      <div className="min-h-20">
        <div className="flex items-center gap-2">
          <h3 className="pf-section-title">{plan.displayName}</h3>
          {isCurrent && <Badge variant="success" size="sm">Current</Badge>}
        </div>
        <p className="pf-copy mt-1">{plan.audience}</p>
      </div>
      <div className="my-5">
        <span className="pf-page-title">{formatMoney(Number(plan.price), false)}</span>
        <span className="pf-copy">/month</span>
      </div>
      <ul className="mb-6 flex-1 space-y-2">
        {plan.featureCopy.map((feature) => (
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
        {isCurrent ? 'Current plan' : `Choose ${plan.displayName}`}
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
  const currentPlanName = subscription?.plan?.features?.displayName || planDisplayName(currentPlan);
  const currentPlanKey = currentPlan?.toLowerCase() || 'starter';
  const currentPlanPrice = planPrice(currentPlan, subscription?.plan?.price);
  const billingDate = subscription?.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : '';
  const isTrial = isTrialStatus(subscription?.status);
  const needsPaymentInfo = subscription?.status === 'trial_pending_payment';

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
    if (currentPlan?.toLowerCase() === plan && !needsPaymentInfo) return;
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
      <p className="pf-page-copy">Manage your Crewmodo plan, payment method, invoices, and cancellation from one place.</p>

      <Card>
        <CardHeader title="Current Plan" description="This subscription is for Crewmodo software access. Customer deposits and contractor payouts are handled separately." />
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
            <p className="pf-row-title">Starter trial pending</p>
            <p className="pf-copy mt-1">
              Add payment information to start the 14-day trial. Starter will be the subscribed product after the trial ends unless you choose a different plan. The first charge happens 14 days after payment information is added.
            </p>
            <Button type="button" size="sm" className="mt-4" isLoading={checkoutPlan === 'starter'} onClick={() => subscribe('starter')}>
              Add payment info
            </Button>
          </div>
        )}
        {!isLoading && !error && subscription && (
          <div className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="pf-section-title">{currentPlanName}</p>
                  <Badge variant={subscription.status === 'active' ? 'success' : 'warning'}>{labelize(subscription.status || 'active')}</Badge>
                </div>
                <p className="pf-copy mt-1">
                  {formatMoney(currentPlanPrice, false)}/month
                  {billingDate ? ` - ${isTrial ? 'Trial ends' : 'Renews'} ${billingDate}` : ''}
                </p>
              </div>
              {needsPaymentInfo ? (
                <Button type="button" isLoading={checkoutPlan === currentPlanKey} onClick={() => subscribe(currentPlanKey)}>
                  Add payment info
                </Button>
              ) : (
                <Button type="button" variant="secondary" isLoading={isPortalLoading} onClick={manageBilling}>
                  Manage billing
                </Button>
              )}
            </div>

            {isTrial ? (
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
                <p className="pf-row-title text-blue-950">{currentPlanName} starts after the free trial</p>
                <p className="pf-copy mt-1 text-blue-900">
                  Your free trial ends {billingDate || 'after 14 days'}. The first charge will happen when the trial ends, and the subscribed product will be {currentPlanName} at {formatMoney(currentPlanPrice, false)}/month.
                </p>
                {needsPaymentInfo && (
                  <p className="pf-meta mt-2 text-blue-900">
                    Payment information is still needed before the trial can continue automatically.
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                <p className="pf-row-title">Next billing date</p>
                <p className="pf-copy mt-1">
                  {billingDate ? `Your next ${formatMoney(currentPlanPrice, false)} charge is scheduled for ${billingDate}.` : 'Your next billing date will appear here after Stripe confirms the subscription period.'}
                </p>
              </div>
            )}
          </div>
        )}
        <p className="pf-meta mt-4">
          Manage billing opens Stripe's secure customer page for this Crewmodo subscription. From there you can update the card, view invoices, change or cancel the subscription, and handle billing history.
        </p>
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
