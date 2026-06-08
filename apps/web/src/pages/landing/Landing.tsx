import { useEffect } from 'react';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';

const workflow = [
  {
    title: 'Capture the lead',
    copy: 'Track source, jobsite, contact history, reminders, and pipeline stage from the first inquiry.',
    icon: 'kanban',
  },
  {
    title: 'Send the proposal',
    copy: 'Build clear estimates with scope, photos, terms, payment schedule, e-signature, and change orders.',
    icon: 'file-text',
  },
  {
    title: 'Schedule production',
    copy: 'Move accepted work onto the calendar, see multi-day jobs, watch weather, and keep crews aligned.',
    icon: 'calendar',
  },
  {
    title: 'Control job cost',
    copy: 'Log crew time, upload photos, review supplier invoices, and keep margins visible before the job is over.',
    icon: 'bar-chart',
  },
];

const features = [
  ['Sales pipeline', 'Drag leads through the sales process with reasons, follow-ups, and health recommendations.'],
  ['Production estimating', 'Interior and exterior scope, substrates, prep, paint products, options, and customer-ready proposals.'],
  ['Client portal', 'Proposal preview, e-signature, payment schedule visibility, and final signed copies.'],
  ['Crew time tracking', 'Clock in/out, missed punch review, bulk timecards, GPS snapshots, and job assignment checks.'],
  ['Scheduling', 'Week and month calendar views, multi-day jobs, unscheduling, and job-to-calendar workflows.'],
  ['Payments & invoices', 'Deposits, progress payments, manual payments, quick invoices, refunds, and payment history.'],
  ['Supplier costs', 'Stage supplier invoices for review and attribute material costs to the right job.'],
  ['Operations reporting', 'Revenue, margin, pipeline, activity, job status, and lead-source visibility.'],
];

const stats = [
  ['1', 'workspace for sales, field work, and payments'],
  ['14 days', 'to evaluate the workflow before launch'],
  ['Mobile first', 'for estimators, owners, and crew leads'],
];

const faqs = [
  ['Is Crewmodo only for painting contractors?', 'It is currently deepest for painting workflows, but the product direction is broader trade contractor operations.'],
  ['Can crews use it from the field?', 'Yes. Crew members can have a focused time-tracking surface, while crew leads and owners get broader job controls.'],
  ['Does it replace QuickBooks?', 'No. Crewmodo should run the job workflow and sync cleanly with accounting systems rather than become the general ledger.'],
  ['Can customers sign and pay online?', 'Yes, once Stripe is connected. Contractors can also record manual payments like check or cash.'],
];

function BrandMark() {
  return (
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[#1a5694] text-white shadow-sm" aria-hidden="true">
      <svg viewBox="0 0 32 32" className="h-7 w-7" focusable="false">
        <path d="M20.8 9.3A8.3 8.3 0 1 0 21 22.6" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="4.2" />
        <circle cx="22.8" cy="11.2" r="2.5" fill="currentColor" />
        <circle cx="22.8" cy="20.8" r="2.5" fill="currentColor" />
      </svg>
    </span>
  );
}

function ProductPreview() {
  return (
    <div className="rounded-[1.75rem] border border-gray-200 bg-white p-3 shadow-[0_18px_60px_rgba(15,23,42,0.12)]">
      <div className="overflow-hidden rounded-[1.25rem] border border-gray-200 bg-[#f8fafc]">
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <BrandMark />
            <span className="text-sm font-semibold text-gray-950">Crewmodo</span>
          </div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">Live job health</span>
        </div>
        <div className="grid gap-3 p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ['Pipeline', '$84,250', '7 active leads'],
              ['Scheduled', '12 jobs', '3 starting this week'],
              ['Margin', '38.6%', 'actual vs estimate'],
            ].map(([label, value, note]) => (
              <div key={label} className="rounded-xl border border-gray-200 bg-white p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">{label}</p>
                <p className="mt-2 text-xl font-bold text-gray-950">{value}</p>
                <p className="mt-1 text-xs text-gray-500">{note}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-950">Today</p>
                <span className="text-xs font-medium text-[#1a5694]">Schedule</span>
              </div>
              {[
                ['Exterior repaint', 'Maple St', 'Day 2/5', 'bg-blue-50 text-blue-800'],
                ['Kitchen + hall', 'Pine Ave', 'Ready for colors', 'bg-amber-50 text-amber-800'],
                ['Final walkthrough', 'Cedar Ct', 'Payment due', 'bg-emerald-50 text-emerald-800'],
              ].map(([name, location, status, cls]) => (
                <div key={name} className="mb-2 rounded-lg border border-gray-200 bg-gray-50 p-3 last:mb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-gray-950">{name}</p>
                      <p className="mt-0.5 text-xs text-gray-500">{location}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${cls}`}>{status}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <p className="text-sm font-semibold text-gray-950">Recommended</p>
              <div className="mt-3 space-y-2">
                <div className="rounded-lg bg-[#d7e3ff] p-3 text-sm text-[#001b3e]">Follow up with 2 stale estimates.</div>
                <div className="rounded-lg bg-[#caecf9] p-3 text-sm text-[#001f28]">Assign job for one timecard review.</div>
                <div className="rounded-lg bg-[#fff4cf] p-3 text-sm text-[#4b3b00]">Collect deposit before scheduling.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  useEffect(() => {
    const previousTitle = document.title;
    const description = 'Crewmodo is contractor CRM and field operations software for leads, estimates, scheduling, time tracking, job costing, invoices, and payments.';
    document.title = 'Crewmodo | Contractor CRM, estimating, scheduling, and job costing';

    const upsertMeta = (name: string, content: string, property = false) => {
      const selector = property ? `meta[property="${name}"]` : `meta[name="${name}"]`;
      let tag = document.head.querySelector<HTMLMetaElement>(selector);
      if (!tag) {
        tag = document.createElement('meta');
        tag.setAttribute(property ? 'property' : 'name', name);
        document.head.appendChild(tag);
      }
      tag.content = content;
    };

    upsertMeta('description', description);
    upsertMeta('og:title', 'Crewmodo | Contractor CRM and field operations software', true);
    upsertMeta('og:description', description, true);
    upsertMeta('og:type', 'website', true);
    upsertMeta('twitter:card', 'summary_large_image');

    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.dataset.crewmodoLanding = 'true';
    script.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Crewmodo',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, iOS, Android',
      description,
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
        description: '14-day free trial',
      },
    });
    document.head.appendChild(script);

    return () => {
      document.title = previousTitle;
      script.remove();
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#f8fafc] text-gray-950">
      <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur">
        <nav className="mx-auto flex max-w-[118rem] items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-10" aria-label="Public navigation">
          <a href="/" className="flex items-center gap-3" aria-label="Crewmodo home">
            <BrandMark />
            <span className="text-base font-bold text-gray-950">Crewmodo</span>
          </a>
          <div className="hidden items-center gap-6 text-sm font-semibold text-gray-700 md:flex">
            <a href="#workflow" className="hover:text-[#1a5694]">Workflow</a>
            <a href="#features" className="hover:text-[#1a5694]">Features</a>
            <a href="#pricing" className="hover:text-[#1a5694]">Pricing</a>
          </div>
          <div className="flex items-center gap-2">
            <Button as="a" href="/login" variant="ghost" size="sm">Sign in</Button>
            <Button as="a" href="/signup" size="sm">Start trial</Button>
          </div>
        </nav>
      </header>

      <main>
        <section className="mx-auto grid max-w-[118rem] gap-10 px-4 py-10 sm:px-6 sm:py-14 lg:grid-cols-[minmax(0,0.92fr)_minmax(34rem,1.08fr)] lg:items-center lg:px-10 lg:py-20">
          <div>
            <p className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-sm font-semibold text-[#1a5694]">
              Built for trade contractors moving from paper to production-ready systems
            </p>
            <h1 className="mt-5 max-w-4xl text-4xl font-bold leading-[1.05] text-gray-950 sm:text-5xl lg:text-6xl">
              Run leads, estimates, crews, and payments from one contractor command center.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-gray-700">
              Crewmodo helps owners and crew leads manage the full path from first inquiry to final payment: pipeline, proposals, scheduling, field time, job cost, invoices, and customer communication.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Button as="a" href="/signup" size="lg" rightIcon={<Icon name="arrow-right" className="h-4 w-4" />}>
                Start free trial
              </Button>
              <Button as="a" href="#workflow" variant="secondary" size="lg">
                See workflow
              </Button>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {stats.map(([value, label]) => (
                <div key={value} className="rounded-xl border border-gray-200 bg-white p-4">
                  <p className="text-lg font-bold text-gray-950">{value}</p>
                  <p className="mt-1 text-sm leading-5 text-gray-600">{label}</p>
                </div>
              ))}
            </div>
          </div>
          <ProductPreview />
        </section>

        <section id="workflow" className="border-y border-gray-200 bg-white py-12 sm:py-16">
          <div className="mx-auto max-w-[118rem] px-4 sm:px-6 lg:px-10">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.12em] text-[#256475]">Sales to production</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-gray-950 sm:text-4xl">A contractor workflow that stays connected after the estimate is signed.</h2>
              <p className="mt-4 text-base leading-7 text-gray-700">Generic CRMs stop at the sales handoff. Crewmodo keeps jobsite details, schedule dates, timecards, costs, payments, and customer updates tied together.</p>
            </div>
            <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {workflow.map((item, index) => (
                <article key={item.title} className="rounded-2xl border border-gray-200 bg-[#f8fafc] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-[#1a5694] shadow-sm">
                      <Icon name={item.icon} className="h-5 w-5" />
                    </span>
                    <span className="text-sm font-bold text-gray-400">0{index + 1}</span>
                  </div>
                  <h3 className="mt-5 text-lg font-bold text-gray-950">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-600">{item.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="features" className="mx-auto max-w-[118rem] px-4 py-12 sm:px-6 sm:py-16 lg:px-10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-sm font-bold uppercase tracking-[0.12em] text-[#256475]">Operating system</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-gray-950 sm:text-4xl">The daily tools a small or mid-sized crew actually uses.</h2>
            </div>
            <Button as="a" href="/signup" variant="secondary">Start trial</Button>
          </div>
          <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {features.map(([title, copy]) => (
              <article key={title} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="font-bold text-gray-950">{title}</p>
                <p className="mt-2 text-sm leading-6 text-gray-600">{copy}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="bg-[#102033] py-12 text-white sm:py-16">
          <div className="mx-auto grid max-w-[118rem] gap-8 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:px-10">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.12em] text-[#9bd7e8]">Why owners care</p>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Less duplicate entry. More visibility before margin disappears.</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                'Customer profiles keep estimates, jobs, payments, photos, messages, and activity in one place.',
                'Timecards and supplier invoices flow into job cost instead of waiting for bookkeeping cleanup.',
                'Customer-facing proposals stay clear: scope, products, payment schedule, signatures, and final copy.',
                'Setup checklists and recommended actions help teams keep the system healthy after launch.',
              ].map((copy) => (
                <div key={copy} className="rounded-xl border border-white/10 bg-white/10 p-4">
                  <Icon name="check" className="h-5 w-5 text-[#9bd7e8]" />
                  <p className="mt-3 text-sm leading-6 text-white/85">{copy}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="mx-auto max-w-[118rem] px-4 py-12 sm:px-6 sm:py-16 lg:px-10">
          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8 lg:p-10">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-center">
              <div>
                <p className="text-sm font-bold uppercase tracking-[0.12em] text-[#256475]">Trial</p>
                <h2 className="mt-3 text-3xl font-bold tracking-tight text-gray-950 sm:text-4xl">Start with the core workflow, then tune your operation.</h2>
                <p className="mt-4 max-w-2xl text-base leading-7 text-gray-700">
                  Create a workspace, add payment details for the trial, set business defaults, and walk through your first lead-to-proposal-to-job workflow.
                </p>
              </div>
              <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
                <p className="text-sm font-bold text-[#1a5694]">14-day free trial</p>
                <p className="mt-2 text-3xl font-bold text-gray-950">Starter setup</p>
                <p className="mt-2 text-sm leading-6 text-gray-700">Payment method required. No charge today. Cancel before trial ends.</p>
                <Button as="a" href="/signup" className="mt-5 w-full justify-center">Start trial</Button>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[72rem] px-4 pb-14 sm:px-6 sm:pb-20 lg:px-10">
          <h2 className="text-3xl font-bold tracking-tight text-gray-950">Questions contractors ask first</h2>
          <div className="mt-6 grid gap-3">
            {faqs.map(([question, answer]) => (
              <details key={question} className="rounded-xl border border-gray-200 bg-white p-4">
                <summary className="cursor-pointer font-bold text-gray-950">{question}</summary>
                <p className="mt-3 text-sm leading-6 text-gray-600">{answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[118rem] flex-col gap-4 px-4 py-6 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-10">
          <div className="flex items-center gap-3">
            <BrandMark />
            <div>
              <p className="font-bold text-gray-950">Crewmodo</p>
              <p className="text-sm text-gray-500">Contractor CRM and field operations software.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm font-semibold text-gray-600">
            <a href="/login" className="hover:text-[#1a5694]">Sign in</a>
            <a href="/signup" className="hover:text-[#1a5694]">Start trial</a>
            <a href="/privacy" className="hover:text-[#1a5694]">Privacy</a>
            <a href="/terms" className="hover:text-[#1a5694]">Terms</a>
            <a href="mailto:support@crewmodo.com" className="hover:text-[#1a5694]">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
