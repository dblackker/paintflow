import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Table } from '@/components/Table';

export function Billing() {
  const invoices = [
    { id: 'INV-001', customer: 'John Smith', amount: 4485.60, status: 'paid', date: '2024-01-20' },
    { id: 'INV-002', customer: 'Jane Doe', amount: 7200.00, status: 'sent', date: '2024-01-22' },
    { id: 'INV-003', customer: 'Bob Johnson', amount: 3200.00, status: 'overdue', date: '2024-01-10' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Billing</h2>
          <p className="text-gray-600 mt-1">Manage invoices and payments</p>
        </div>
        <Button>Create Invoice</Button>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mb-5">
        <Card><CardContent className="p-4"><p className="text-sm text-gray-600">Outstanding</p><p className="text-2xl font-bold">$10,400</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-gray-600">Paid This Month</p><p className="text-2xl font-bold">$4,485</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-sm text-gray-600">Overdue</p><p className="text-2xl font-bold text-red-600">$3,200</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader title="Recent Invoices" />
        <CardContent>
          <Table>
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Invoice</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Customer</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {invoices.map(inv => (
                <tr key={inv.id}>
                  <td className="px-4 py-3 text-sm font-medium">{inv.id}</td>
                  <td className="px-4 py-3 text-sm">{inv.customer}</td>
                  <td className="px-4 py-3 text-sm text-right">${inv.amount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={inv.status === 'paid' ? 'success' : inv.status === 'overdue' ? 'danger' : 'default'}>
                      {inv.status.toUpperCase()}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
