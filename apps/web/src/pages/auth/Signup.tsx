import { FormEvent, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { Input, Select } from '@/components/Input';
import { API_URL } from '@/lib/api';
import { PLAN_DEFINITIONS, PLAN_ORDER, type PlanKey } from '@crewmodo/core';

const plans = PLAN_ORDER.map((key) => PLAN_DEFINITIONS[key]);

const trialDetails = [
  'No charge today',
  'Secure checkout starts the 14-day trial',
  'You return signed in automatically',
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
  const [redirectingToCheckout, setRedirectingToCheckout] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'info' | 'success'; text: string; href?: string } | null>(
    searchParams.get('checkout') === 'canceled'
      ? { tone: 'info', text: 'Checkout was canceled. Your workspace is saved, but the trial is not active yet. Submit this form again to reopen secure checkout.' }
      : null,
  );

  const selectedPlan = useMemo(() => PLAN_DEFINITIONS[formData.plan], [formData.plan]);
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
          text: 'If this email has a Crewmodo workspace, we sent a one-time sign-in link. Check your inbox to continue.',
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
        setRedirectingToCheckout(true);
        setMessage({
          tone: 'success',
          text: payload.resumedSignup
            ? 'Workspace found. Reopening secure checkout so you can activate the trial.'
            : 'Workspace reserved. Opening secure checkout to start your trial.',
        });
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
    <main className="min-h-screen bg-gray-50 px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex items-center justify-between gap-3 py-2">
          <Link to="/" className="inline-flex items-center gap-2 text-lg font-bold text-blue-700">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-[var(--pf-primary)] text-sm font-bold text-white">C</span>
            Crewmodo
          </Link>
          <Link to="/login" className="btn-text btn-sm">Sign in</Link>
        </header>

        <div className="grid gap-5 py-4 lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-start lg:py-8">
          <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="max-w-2xl">
              <Badge variant="info" size="sm">14-day free trial</Badge>
              <h1 className="pf-page-title mt-4">Start your contractor workspace</h1>
              <p className="pf-page-copy mt-2">
                Create your workspace, add payment information through Stripe, and return signed in to finish setup. You will not be charged today.
              </p>
            </div>

            <div className="mt-5 grid gap-2 sm:grid-cols-3">
              {trialDetails.map((detail) => (
                <div key={detail} className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                  <Icon name="check" className="h-4 w-4 shrink-0 text-[var(--pf-primary)]" />
                  <span className="pf-helper text-blue-950">{detail}</span>
                </div>
              ))}
            </div>

            {message && (
              <div className={`mt-5 rounded-lg border p-4 ${messageClass(message.tone)}`}>
                <p className="pf-copy text-current">{message.text}</p>
                {message.href && <a className="btn-text mt-2 justify-start p-0 text-current underline" href={message.href}>Continue setup</a>}
              </div>
            )}

            <form className="mt-6 grid gap-6" onSubmit={submit}>
              <section aria-labelledby="workspace-details-title" className="grid gap-4">
                <div>
                  <h2 id="workspace-details-title" className="pf-section-title">Workspace details</h2>
                  <p className="pf-copy mt-1">Use the owner or office email that should receive billing, setup, and sign-in messages.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input label="Your name" required autoComplete="name" value={formData.name} onChange={(event) => update('name', event.target.value)} placeholder="Alex Morgan" />
                  <Input label="Work email" required type="email" inputMode="email" autoComplete="email" value={formData.email} onChange={(event) => update('email', event.target.value)} placeholder="alex@company.com" />
                  <Input label="Company name" required autoComplete="organization" value={formData.companyName} onChange={(event) => update('companyName', event.target.value)} placeholder="Morgan Contracting Co." />
                  <Input label="Phone number" type="tel" inputMode="numeric" autoComplete="tel" value={formData.phone} onChange={(event) => update('phone', maskPhone(event.target.value))} placeholder="(555) 123-4567" />
                  <Select label="Team size" value={formData.teamSize} onChange={(event) => update('teamSize', event.target.value)} helperText="Used to recommend a starting plan. You can change this later.">
                    <option value="1-3">1-3 users</option>
                    <option value="4-10">4-10 users</option>
                    <option value="11+">11+ users</option>
                  </Select>
                </div>
              </section>

              <section aria-labelledby="trial-plan-title" className="grid gap-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 id="trial-plan-title" className="pf-section-title">Trial plan</h2>
                    <p className="pf-copy mt-1">Starter is enough for very small teams. Growth is usually the right first trial for crews tracking time and job cost.</p>
                  </div>
                  {suggestedPlan !== formData.plan && (
                    <button type="button" className="btn-text btn-sm" onClick={() => update('plan', suggestedPlan)}>
                      Use recommended plan
                    </button>
                  )}
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  {plans.map((plan) => {
                    const selected = formData.plan === plan.key;
                    return (
                      <button
                        key={plan.key}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => update('plan', plan.key)}
                        className={`rounded-lg border bg-white p-4 text-left shadow-sm transition hover:border-[var(--pf-primary)] hover:bg-blue-50 ${selected ? 'border-[var(--pf-primary)] ring-2 ring-[rgb(26_86_148_/_0.18)]' : 'border-gray-200'}`}
                      >
                        <div className="flex min-h-8 items-start justify-between gap-3">
                          <div>
                            <p className="pf-row-title">{plan.displayName}</p>
                            <p className="pf-meta">{plan.seatCopy}</p>
                          </div>
                          {plan.key === 'pro' && <Badge variant="info" size="sm">Common</Badge>}
                        </div>
                        <p className="mt-3">
                          <span className="pf-section-title">${plan.price}</span>
                          <span className="pf-meta">/mo after trial</span>
                        </p>
                        <p className="pf-copy mt-2">{plan.audience}</p>
                      </button>
                    );
                  })}
                </div>
              </section>

              <div className="rounded-md border-l-4 border-[var(--pf-primary)] bg-blue-50 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="pf-meta font-semibold uppercase tracking-normal text-blue-900">Selected plan</p>
                    <p className="pf-row-title mt-1 text-blue-950">{selectedPlan.displayName} starts after the free trial</p>
                    <p className="pf-copy mt-1 text-blue-900">
                      Stripe stores the payment method and starts the trial. First charge is ${selectedPlan.price}/month after day 14 unless you cancel.
                    </p>
                  </div>
                  <p className="pf-section-title shrink-0 text-blue-950">${selectedPlan.price}/mo</p>
                </div>
              </div>

              <Button type="submit" size="lg" fullWidth isLoading={isSubmitting || redirectingToCheckout} rightIcon={<Icon name="arrow-right" className="h-4 w-4" />}>
                {redirectingToCheckout ? 'Opening secure checkout' : 'Continue to secure checkout'}
              </Button>
              <p className="pf-meta text-center">
                No magic link is required during signup. After checkout, Stripe sends you back signed in. If you leave before finishing, use this same email to resume checkout or request a sign-in link.
              </p>
            </form>
          </section>

          <aside className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm lg:sticky lg:top-5">
            <p className="pf-section-title">What happens after signup</p>
            <ol className="mt-4 grid gap-4">
              {[
                ['1', 'Secure checkout', 'Stripe stores payment information and starts the free trial.'],
                ['2', 'Automatic sign-in', 'You return to Crewmodo signed in. A welcome email is sent for your records.'],
                ['3', 'Workspace setup', 'Add business info, production rates, paint products, and review links.'],
              ].map(([step, title, copy]) => (
                <li key={step} className="flex gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-50 text-sm font-semibold text-blue-950">{step}</span>
                  <span>
                    <span className="pf-row-title block">{title}</span>
                    <span className="pf-copy block">{copy}</span>
                  </span>
                </li>
              ))}
            </ol>

            <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="pf-row-title">Included in the trial</p>
              <ul className="mt-3 grid gap-2">
                {selectedPlan.featureCopy.map((feature) => (
                  <li key={feature} className="flex items-center gap-2">
                    <Icon name="check" className="h-4 w-4 shrink-0 text-[var(--pf-success)]" />
                    <span className="pf-copy">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
