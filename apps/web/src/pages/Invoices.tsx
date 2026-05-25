import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/Card';
import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/Badge';
import { Table } from '@/components/Table';
import { EmptyState } from '@/components/EmptyState';

interface Invoice {
  id: string;
  number: string;
  customer: string;
  amount: number;
  status: 'draft' | 'sent' | 'paid' | 'overdue';
  dueDate: string;
}

export function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);

  useEffect(() => {
    setInvoices([
      { id: '1', number: 'INV-001', customer: 'John Smith', amount: 450000, status: 'sent', dueDate: '2024-02-15' },
      { id: '2', number: 'INV-002', customer: 'Jane Doe', amount: 720000, status: 'paid', dueDate: '2024-02-10' },
      { id: '3', number: 'INV-003', customer: 'Bob Johnson', amount: 320000, status: 'overdue', dueDate: '2024-01-20' },
    ]);
  }, []);

  const formatMoney = (cents: number) => `$${(cents / 100).toLocaleString()}`;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Invoices</h1>
        <Button>New Invoice</Button>
      </div>

      {invoices.length === 0 ? (
        <EmptyState title="No invoices yet" description="Create your first invoice" action={{ label: 'New Invoice', onClick: () => {} }} />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <thead>
                <tr className="border-b">
                  <th className="text-left p-4">Invoice #</th>
                  <th className="text-left p-4">Customer</th>
                  <th className="text-left p-4">Amount</th>
                  <th className="text-left p-4">Status</th>
                  <th className="text-left p-4">Due Date</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(invoice => (
                  <tr key={invoice.id} className="border-b hover:bg-gray-50">
                    <td className="p-4 font-medium">{invoice.number}</td>
                    <td className="p-4">{invoice.customer}</td>
                    <td className="p-4">{formatMoney(invoice.amount)}</td>
                    <td className="p-4"><StatusBadge status={invoice.status} /></td>
                    <td className="p-4">{invoice.dueDate}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
