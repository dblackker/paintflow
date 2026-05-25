import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/Card';

export function Help() {
  const sections = [
    { id: 'getting-started', icon: '🚀', title: 'Getting Started', desc: 'Set up your account and send your first estimate' },
    { id: 'estimates', icon: '💰', title: 'Estimates', desc: 'Create Good/Better/Best pricing' },
    { id: 'scheduling', icon: '📅', title: 'Scheduling', desc: 'Manage jobs and calendar' },
    { id: 'billing', icon: '💳', title: 'Billing', desc: 'Stripe, QuickBooks, and payments' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <Link to="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center text-white font-bold">P</div>
              <span className="text-xl font-semibold">PaintFlow</span>
            </Link>
            <Link to="/login" className="text-blue-600 font-medium">Sign In</Link>
          </div>
        </div>
      </nav>
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <h1 className="text-4xl font-bold mb-8">Help Center</h1>
        
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {sections.map(section => (
            <a key={section.id} href={`#${section.id}`}>
              <Card className="h-full hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-2">{section.icon} {section.title}</h3>
                  <p className="text-sm text-gray-600">{section.desc}</p>
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
