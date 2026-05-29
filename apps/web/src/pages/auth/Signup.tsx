import { FormEvent, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardContent } from '@/components/Card';
import { Input, Select } from '@/components/Input';
import { API_URL } from '@/lib/api';

type PlanKey = 'starter' | 'pro' | 'enterprise';

const plans: Array<{
  key: PlanKey;
  name: string;
  price: number;
  users: string;
  bestFor: string;
  features: string[];
  popular?: boolean;
}> = [
  {
    key: 'starter',
    name: 'Starter',
    price: 49,
    users: '1-3 users',
    bestFor: 'Owner-operators and small crews getting organized.',
    features: ['Lead pipeline', 'Production estimates', 'E-signatures', 'Payments', 'Basic reports'],
  },
  {
    key: 'pro',
    name: 'Pro',
    price: 149,
    users: 'Up to 10 users',
    bestFor: 'Growing painting companies running sales and operations.',
    features: ['Everything in Starter', 'Crew time tracking', 'Job costing', 'Email templates', 'Advanced reports'],
    popular: true,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    price: 399,
    users: 'Unlimited users',
    bestFor: 'Multi-crew operators that need deeper controls and support.',
    features: ['Everything in Pro', 'Unlimited users', 'White-labeling', 'API access', 'Priority support'],
  },
];

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

function recommendedPlan(teamSize: string): PlanKey {
  if (teamSize === '1-3') return 'starter';
  if (teamSize === '11+') return 'enterprise';
  return 'pro';
}

function messageClass(tone: 'error' | 'info' | 'success') {
  if (tone === 'error') return 'border-red-200 bg-red-50 text-red-800';
  if (tone === 'success') return 'border-green-200 bg-green-50 text-green-800';
  return 'border-blue-200 bg-blue-50 text-blue-900';
}

export function Signup() {
  const [searchParams] = useSearchParams();
  const initialPlan = (searchParams.get('plan') as PlanKey | null) || 'pro';
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    companyName: '',
    teamSize: '4-10',
    plan: plans.some((plan) => plan.key === initialPlan) ? initialPlan : 'pro',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'info' | 'success'; text: string; href?: string } | null>(
    searchParams.get('checkout') === 'canceled'
      ? { tone: 'info', text: 'Checkout was canceled. Your workspace is not active until payment information is added for the trial.' }
      : null,
  );

  const selectedPlan = useMemo(() => plans.find((plan) => plan.key === formData.plan) || plans[1], [formData.plan]);
  const suggestedPlan = recommendedPlan(formData.teamSize);

  function update(key: keyof typeof formData, value: string) {
    setFormData((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch(`${API_URL}/v1/auth/signup`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(formData),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.error || 'Could not start your trial.');
      }

      if (payload.existingAccount) {
        setMessage({
          tone: 'info',
          text: 'If this email already has a workspace, use sign in to receive a one-time link.',
        });
        return;
      }

      if (payload.devToken) {
        setMessage({
          tone: 'success',
          text: 'Development signup created. Use this shortcut to continue.',
          href: `${API_URL}/v1/auth/verify?token=${payload.devToken}`,
        });
      }

      if (payload.checkoutUrl) {
        window.location.href = payload.checkoutUrl;
        return;
      }

      throw new Error('Stripe checkout is not configured yet.');
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <Link to="/" className="text-xl font-bold text-blue-700">Crewmodo</Link>
            <Link to="/login" className="btn-text btn-sm">Sign in</Link>
          </div>

          <div className="mt-8">
            <p className="pf-kicker">14-day free trial</p>
            <h1 className="pf-page-title mt-2">Set up your painting company workspace</h1>
            <p className="pf-page-copy mt-2">
              Add payment information now so the trial can continue automatically. You can cancel from billing at any time.
            </p>
          </div>

          {message && (
            <div className={`mt-5 rounded-lg border p-4 ${messageClass(message.tone)}`}>
              <p className="pf-copy text-current">{message.text}</p>
              {message.href && <a className="btn-text mt-2 justify-start p-0 text-current underline" href={message.href}>Continue setup</a>}
            </div>
          )}

          <form className="mt-6 grid gap-5" onSubmit={submit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Your name" required autoComplete="name" value={formData.name} onChange={(event) => update('name', event.target.value)} placeholder="Alex Morgan" />
              <Input label="Work email" required type="email" inputMode="email" autoComplete="email" value={formData.email} onChange={(event) => update('email', event.target.value)} placeholder="alex@company.com" />
              <Input label="Company name" required autoComplete="organization" value={formData.companyName} onChange={(event) => update('companyName', event.target.value)} placeholder="Morgan Painting Co." />
              <Input label="Phone number" type="tel" inputMode="numeric" autoComplete="tel" value={formData.phone} onChange={(event) => update('phone', maskPhone(event.target.value))} placeholder="(555) 123-4567" />
              <Select label="Team size" value={formData.teamSize} onChange={(event) => update('teamSize', event.target.value)}>
                <option value="1-3">1-3 users</option>
                <option value="4-10">4-10 users</option>
                <option value="11+">11+ users</option>
              </Select>
              <Select label="Plan" value={formData.plan} onChange={(event) => update('plan', event.target.value)}>
                {plans.map((plan) => <option key={plan.key} value={plan.key}>{plan.name} - ${plan.price}/mo</option>)}
              </Select>
            </div>

            {suggestedPlan !== formData.plan && (
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-950">
                Based on your team size, {plans.find((plan) => plan.key === suggestedPlan)?.name} may fit better.
                <button type="button" className="ml-2 font-semibold underline" onClick={() => update('plan', suggestedPlan)}>Use recommendation</button>
              </div>
            )}

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <p className="pf-row-title">{selectedPlan.name}</p>
                {selectedPlan.popular && <Badge variant="info" size="sm">Most common</Badge>}
                <span className="pf-meta">{selectedPlan.users}</span>
              </div>
              <p className="pf-copy mt-1">{selectedPlan.bestFor}</p>
              <p className="mt-3">
                <span className="pf-section-title">${selectedPlan.price}</span>
                <span className="pf-copy">/month after 14 days</span>
              </p>
            </div>

            <Button type="submit" size="lg" fullWidth isLoading={isSubmitting}>
              Add payment info and start trial
            </Button>
            <p className="pf-meta text-center">
              Secure checkout is handled by Stripe. Crewmodo does not store card numbers.
            </p>
          </form>
        </section>

        <aside className="grid gap-4">
          {plans.map((plan) => (
            <Card key={plan.key} padding="sm" className={formData.plan === plan.key ? 'border-blue-500 ring-1 ring-blue-500' : ''}>
              <CardContent>
                <button type="button" className="w-full text-left" onClick={() => update('plan', plan.key)}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="pf-row-title">{plan.name}</p>
                      <p className="pf-meta">{plan.users}</p>
                    </div>
                    <p className="font-semibold text-gray-950">${plan.price}/mo</p>
                  </div>
                  <ul className="mt-3 grid gap-1">
                    {plan.features.slice(0, 4).map((feature) => <li key={feature} className="pf-helper">- {feature}</li>)}
                  </ul>
                </button>
              </CardContent>
            </Card>
          ))}
        </aside>
      </div>
    </main>
  );
}
