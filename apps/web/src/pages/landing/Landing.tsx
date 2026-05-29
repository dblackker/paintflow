import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';

const capabilities = [
  ['Lead pipeline', 'Capture inquiries, qualify work, and keep follow-up moving.'],
  ['Production estimates', 'Build proposals with scope, payments, signatures, and change orders.'],
  ['Crew operations', 'Schedule jobs, track time, review costs, and keep production moving.'],
];

export function Landing() {
  return (
    <div className="mx-auto max-w-6xl">
      <section className="grid gap-6 py-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-center lg:py-14">
        <div>
          <p className="pf-meta text-blue-800">Contractor CRM, estimating, scheduling, and job cost</p>
          <h1 className="pf-page-title mt-3 max-w-3xl">Run the sales-to-production workflow from one mobile-ready workspace.</h1>
          <p className="pf-page-copy mt-4 max-w-2xl">
            Crewmodo helps contractors capture leads, send proposals, collect payments, schedule crews, track time, and understand job cost without stitching together spreadsheets and point tools.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button as="a" href="/signup" size="lg" rightIcon={<Icon name="arrow-right" className="h-4 w-4" />}>
              Start free trial
            </Button>
            <Button as="a" href="/login" variant="secondary" size="lg">
              Sign in
            </Button>
          </div>
          <p className="pf-meta mt-3">14-day free trial. Payment setup is required, but you will not be charged today.</p>
        </div>

        <aside className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
          <p className="pf-section-title">Built for day-to-day operations</p>
          <div className="mt-4 grid gap-3">
            {capabilities.map(([title, copy]) => (
              <div key={title} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <p className="pf-row-title">{title}</p>
                <p className="pf-copy mt-1">{copy}</p>
              </div>
            ))}
          </div>
        </aside>
      </section>
    </div>
  );
}
