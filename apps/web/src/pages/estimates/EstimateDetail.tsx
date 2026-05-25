import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Tabs } from '@/components/Tabs';
import { Table } from '@/components/Table';

interface EstimateItem {
  id: string;
  description: string;
  qty: number;
  unit: string;
  laborHours: number;
  materialCost: number;
  total: number;
}

interface Estimate {
  id: string;
  customerName: string;
  address: string;
  phone: string;
  email: string;
  status: 'draft' | 'sent' | 'approved' | 'declined';
  items: EstimateItem[];
  laborRate: number;
  markupPercent: number;
  taxRate: number;
  subtotal: number;
  tax: number;
  total: number;
  depositPercent: number;
  depositAmount: number;
  createdAt: string;
  sentAt?: string;
  notes?: string;
}

export function EstimateDetail() {
  const { id } = useParams<{ id: string }>();
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Mock API call
    setTimeout(() => {
      setEstimate({
        id: id || '1',
        customerName: 'John Smith',
        address: '123 Main St, Seattle, WA 98101',
        phone: '(206) 555-0100',
        email: 'john.smith@email.com',
        status: 'sent',
        laborRate: 65,
        markupPercent: 30,
        taxRate: 0.092,
        subtotal: 4107.69,
        tax: 377.91,
        total: 4485.60,
        depositPercent: 50,
        depositAmount: 2242.80,
        createdAt: '2024-01-15',
        sentAt: '2024-01-15',
        notes: 'Customer wants work completed before end of month. Preferred start date is Jan 25.',
        items: [
          {
            id: '1',
            description: 'Prep, patching, masking, and setup',
            qty: 1,
            unit: 'project',
            laborHours: 4,
            materialCost: 150,
            total: 410,
          },
          {
            id: '2',
            description: 'Paint living room walls (2 coats)',
            qty: 450,
            unit: 'sq ft',
            laborHours: 8,
            materialCost: 280,
            total: 800,
          },
          {
            id: '3',
            description: 'Paint bedroom walls (2 coats)',
            qty: 380,
            unit: 'sq ft',
            laborHours: 7,
            materialCost: 240,
            total: 695,
          },
          {
            id: '4',
            description: 'Paint ceilings',
            qty: 830,
            unit: 'sq ft',
            laborHours: 6,
            materialCost: 180,
            total: 570,
          },
          {
            id: '5',
            description: 'Paint trim and doors',
            qty: 1,
            unit: 'project',
            laborHours: 12,
            materialCost: 200,
            total: 980,
          },
          {
            id: '6',
            description: 'Cleanup and touch-ups',
            qty: 1,
            unit: 'project',
            laborHours: 2,
            materialCost: 0,
            total: 130,
          },
        ],
      });
      setIsLoading(false);
    }, 500);
  }, [id]);

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-64 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

  if (!estimate) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
        <div className="text-center py-12 bg-white rounded-lg border">
          <p className="text-red-600 font-medium">Estimate not found</p>
        </div>
      </div>
    );
  }

  const tabItems = [
    { id: 'details', label: 'Details' },
    { id: 'photos', label: 'Photos' },
    { id: 'activity', label: 'Activity' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-gray-900">Estimate #{estimate.id}</h2>
            <Badge variant={
              estimate.status === 'approved' ? 'success' :
              estimate.status === 'sent' ? 'info' :
              estimate.status === 'declined' ? 'danger' : 'default'
            }>
              {estimate.status.toUpperCase()}
            </Badge>
          </div>
          <p className="text-gray-600 mt-1">{estimate.customerName}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm">Edit</Button>
          <Button variant="secondary" size="sm">Duplicate</Button>
          <Button size="sm">Send to Customer</Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-5">
        <section className="space-y-4">
          <Card>
            <CardContent className="p-5">
              <div className="grid sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-600">Customer</p>
                  <p className="font-medium">{estimate.customerName}</p>
                </div>
                <div>
                  <p className="text-gray-600">Phone</p>
                  <p className="font-medium">{estimate.phone}</p>
                </div>
                <div>
                  <p className="text-gray-600">Address</p>
                  <p className="font-medium">{estimate.address}</p>
                </div>
                <div>
                  <p className="text-gray-600">Email</p>
                  <p className="font-medium">{estimate.email}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Scope of Work" />
            <CardContent>
              <Table>
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Rate</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {estimate.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 text-sm">{item.description}</td>
                      <td className="px-4 py-3 text-sm text-right">{item.qty} {item.unit}</td>
                      <td className="px-4 py-3 text-sm text-right">{formatMoney(item.total / item.qty)}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium">{formatMoney(item.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </CardContent>
          </Card>

          {estimate.notes && (
            <Card>
              <CardHeader title="Notes" />
              <CardContent>
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{estimate.notes}</p>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader title="Timeline" />
            <CardContent>
              <Tabs items={tabItems} defaultActive="details">
                <div id="details" className="space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-2 h-2 bg-blue-600 rounded-full mt-2"></div>
                    <div>
                      <p className="text-sm font-medium">Estimate created</p>
                      <p className="text-xs text-gray-600">{formatDate(estimate.createdAt)}</p>
                    </div>
                  </div>
                  {estimate.sentAt && (
                    <div className="flex items-start gap-3">
                      <div className="w-2 h-2 bg-blue-600 rounded-full mt-2"></div>
                      <div>
                        <p className="text-sm font-medium">Sent to customer</p>
                        <p className="text-xs text-gray-600">{formatDate(estimate.sentAt)}</p>
                      </div>
                    </div>
                  )}
                </div>
                <div id="photos" className="py-8 text-center text-gray-500">
                  No photos yet
                </div>
                <div id="activity" className="py-8 text-center text-gray-500">
                  No activity yet
                </div>
              </Tabs>
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-20 self-start">
          <Card>
            <CardHeader title="Pricing Summary" />
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="font-medium">{formatMoney(estimate.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Tax ({(estimate.taxRate * 100).toFixed(1)}%)</span>
                  <span className="font-medium">{formatMoney(estimate.tax)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t text-base font-semibold">
                  <span>Total</span>
                  <span>{formatMoney(estimate.total)}</span>
                </div>
                <div className="flex justify-between text-blue-600 pt-2">
                  <span>Deposit ({estimate.depositPercent}%)</span>
                  <span className="font-medium">{formatMoney(estimate.depositAmount)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <Button fullWidth size="sm">View Customer Proposal</Button>
              <Link to={`/jobs/${estimate.id}`}>
                <Button variant="secondary" fullWidth size="sm" className="mt-2">
                  Convert to Job
                </Button>
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
