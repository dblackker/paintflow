import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';

export function StripePayments() {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold mb-6">Stripe Payments</h1>
      
      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-xl font-semibold">Account Status</h2>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            <div>
              <p className="font-medium">Connected</p>
              <p className="text-sm text-gray-600">Payouts enabled • Live mode</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <h2 className="text-xl font-semibold">Payment Methods</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <p className="font-medium">Credit Cards</p>
              <p className="text-sm text-gray-600">Visa, Mastercard, Amex</p>
            </div>
            <span className="text-green-600">✓ Enabled</span>
          </div>
          <div className="flex justify-between items-center">
            <div>
              <p className="font-medium">ACH Bank Transfer</p>
              <p className="text-sm text-gray-600">1-3 business days</p>
            </div>
            <span className="text-green-600">✓ Enabled</span>
          </div>
          <div className="flex justify-between items-center">
            <div>
              <p className="font-medium">Apple Pay / Google Pay</p>
              <p className="text-sm text-gray-600">One-tap payments</p>
            </div>
            <span className="text-green-600">✓ Enabled</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">Settings</h2>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="secondary">Manage in Stripe Dashboard</Button>
          <Button variant="ghost">Disconnect Account</Button>
        </CardContent>
      </Card>
    </div>
  );
}
