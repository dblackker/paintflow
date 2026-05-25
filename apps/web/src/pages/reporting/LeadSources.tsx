import { Card, CardContent } from '@/components/Card';
import { Table } from '@/components/Table';

export function LeadSources() {
  const sources = [
    { name: 'Google Ads', leads: 45, revenue: 125000, cost: 15000, roi: '733%' },
    { name: 'Referrals', leads: 32, revenue: 98000, cost: 0, roi: '∞' },
    { name: 'Website', leads: 28, revenue: 76000, cost: 2000, roi: '3700%' },
    { name: 'Facebook', leads: 18, revenue: 42000, cost: 8000, roi: '425%' },
    { name: 'Yelp', leads: 12, revenue: 28000, cost: 5000, roi: '460%' },
  ];

  const formatMoney = (cents: number) => `$${(cents / 100).toLocaleString()}`;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold mb-6">Lead Sources</h1>
      
      <Card>
        <CardContent className="p-0">
          <Table>
            <thead>
              <tr className="border-b">
                <th className="text-left p-4">Source</th>
                <th className="text-left p-4">Leads</th>
                <th className="text-left p-4">Revenue</th>
                <th className="text-left p-4">Cost</th>
                <th className="text-left p-4">ROI</th>
              </tr>
            </thead>
            <tbody>
              {sources.map(source => (
                <tr key={source.name} className="border-b">
                  <td className="p-4 font-medium">{source.name}</td>
                  <td className="p-4">{source.leads}</td>
                  <td className="p-4">{formatMoney(source.revenue)}</td>
                  <td className="p-4">{formatMoney(source.cost)}</td>
                  <td className="p-4 font-medium">{source.roi}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
