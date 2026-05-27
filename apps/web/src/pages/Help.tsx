import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/Card';
import { Icon } from '@/components/Icon';

export function Help() {
  const sections = [
    { id: 'getting-started', icon: 'check', title: 'Getting Started', desc: 'Set up your account and send your first estimate' },
    { id: 'estimates', icon: 'file-text', title: 'Estimates', desc: 'Create and send painting proposals' },
    { id: 'scheduling', icon: 'calendar', title: 'Scheduling', desc: 'Manage jobs and calendar' },
    { id: 'billing', icon: 'credit-card', title: 'Billing', desc: 'Stripe, QuickBooks, and payments' },
  ];

  return (
    <div className="mx-auto max-w-4xl py-6 sm:py-8">
      <main>
        <h1 className="pf-page-title mb-8">Help Center</h1>
        
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {sections.map(section => (
            <a key={section.id} href={`#${section.id}`}>
              <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-6">
                  <h3 className="pf-row-title mb-2 flex items-center gap-2"><Icon name={section.icon} className="h-4 w-4 text-blue-700" />{section.title}</h3>
                  <p className="pf-copy">{section.desc}</p>
                </CardContent>
              </Card>
            </a>
          ))}
        </div>

        <Card className="mb-8">
          <CardContent className="p-8">
            <h2 className="text-2xl font-bold mb-4">Getting Started</h2>
            <h3 className="font-semibold mt-6 mb-2">1. Sign up</h3>
            <p className="text-gray-700 mb-4">Go to <Link to="/signup" className="text-blue-600">paintflow.app/signup</Link> and enter your email. We'll send you a magic link to sign in — no password needed.</p>
            <h3 className="font-semibold mt-6 mb-2">2. Complete onboarding</h3>
            <p className="text-gray-700 mb-4">Set your company name, logo, and default pricing. This takes 2 minutes.</p>
            <h3 className="font-semibold mt-6 mb-2">3. Create your first estimate</h3>
            <p className="text-gray-700 mb-4">Click "New Estimate" → Add customer info → Set Good/Better/Best prices → Send via email.</p>
            <h3 className="font-semibold mt-6 mb-2">4. Get paid</h3>
            <p className="text-gray-700">Connect Stripe from Payments → Stripe. Stripe hosted onboarding will create one and collect business details.</p>
          </CardContent>
        </Card>

        <Card className="mb-8">
          <CardContent className="p-8">
            <h2 className="text-2xl font-bold mb-4">Estimates</h2>
            <h3 className="font-semibold mt-6 mb-2">Good/Better/Best pricing</h3>
            <p className="text-gray-700 mb-4">Offer three tiers to increase average job value by 20-30%:</p>
            <ul className="list-disc ml-6 space-y-2 text-gray-700">
              <li><strong>Good:</strong> Basic paint, 1 coat, standard prep</li>
              <li><strong>Better:</strong> Premium paint, 2 coats, full prep</li>
              <li><strong>Best:</strong> Premium + extras (caulking, minor repairs)</li>
            </ul>
            <h3 className="font-semibold mt-6 mb-2">E-signatures</h3>
            <p className="text-gray-700">Customers sign estimates online. No printing or scanning.</p>
          </CardContent>
        </Card>

        <Card className="mb-8">
          <CardContent className="p-8">
            <h2 className="text-2xl font-bold mb-4">Scheduling</h2>
            <p className="text-gray-700 mb-4">Drag jobs from the unscheduled list to your calendar. Syncs with Google Calendar automatically.</p>
            <h3 className="font-semibold mt-6 mb-2">Crew management</h3>
            <p className="text-gray-700">Assign crews to jobs. They get SMS notifications with details.</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-8">
            <h2 className="text-2xl font-bold mb-4">Billing</h2>
            <h3 className="font-semibold mt-6 mb-2">Stripe integration</h3>
            <p className="text-gray-700 mb-4">Accept credit cards, ACH, and Apple Pay. Deposits go to your bank in 2-3 days.</p>
            <h3 className="font-semibold mt-6 mb-2">QuickBooks sync</h3>
            <p className="text-gray-700">Invoices sync automatically. No double entry.</p>
            <h3 className="font-semibold mt-6 mb-2">Customer portal</h3>
            <p className="text-gray-700">Customers view estimates, pay invoices, and see job progress.</p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
