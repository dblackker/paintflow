import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge, StatusBadge } from '@/components/Badge';

interface PortalData {
  customer: { name: string; email: string };
  estimate?: { id: string; total: number; signedAt?: string; title: string };
  job?: { id: string; name: string; status: string; balance: number };
  changeOrders?: Array<{ id: string; title: string; total: number; status: string; paymentStatus: string }>;
}

export function Portal() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PortalData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTimeout(() => {
      if (!token) {
        setError('Invalid link');
        setIsLoading(false);
        return;
      }
      setData({
        customer: { name: 'John Smith', email: 'john@example.com' },
        job: { id: '1', name: 'Exterior Painting Project', status: 'in_progress', balance: 250000 },
        changeOrders: [
          { id: '1', title: 'Additional Trim Work', total: 85000, status: 'pending', paymentStatus: 'pending' }
        ]
      });
      setIsLoading(false);
    }, 500);
  }, [token]);

  const formatMoney = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

  if (isLoading) return <div className="flex justify-center py-12">Loading...</div>;
  if (error || !data) return <div className="text-center py-12 text-red-600">{error || 'Not found'}</div>;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <h1 className="text-xl font-semibold">Customer Portal</h1>
            <div className="text-sm text-gray-600">{data.customer.name}</div>
          </div>
        </div>
      </nav>
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {data.estimate && !data.estimate.signedAt && (
          <Card className="mb-6">
            <CardContent className="p-6">
              <h2 className="text-2xl font-bold mb-2">{data.estimate.title}</h2>
              <p className="text-3xl font-bold mb-6">{formatMoney(data.estimate.total)}</p>
              <Button className="w-full">Approve Estimate</Button>
            </CardContent>
          </Card>
        )}
        {data.job && (
          <>
            <Card className="mb-6">
              <CardContent className="p-6">
                <h2 className="text-2xl font-bold mb-2">{data.job.name}</h2>
                <Badge>{data.job.status.replace('_', ' ')}</Badge>
              </CardContent>
            </Card>
            {data.changeOrders && data.changeOrders.length > 0 && (
              <Card className="mb-6">
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-4">Change Orders</h3>
                  <div className="space-y-4">
                    {data.changeOrders.map(order => (
                      <div key={order.id} className="border rounded-lg p-4">
                        <div className="flex justify-between items-start">
                          <div>
                            <h4 className="font-medium">{order.title}</h4>
                            <p className="text-sm text-gray-600">{formatMoney(order.total)}</p>
                          </div>
                          <StatusBadge status={order.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
            {data.job.balance > 0 && (
              <Card>
                <CardContent className="p-6">
                  <h3 className="font-semibold mb-4">Outstanding Balance</h3>
                  <p className="text-3xl font-bold mb-4">{formatMoney(data.job.balance)}</p>
                  <Button className="w-full">Pay Now</Button>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </main>
    </div>
  );
}
