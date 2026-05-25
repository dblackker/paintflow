import { Card, CardContent } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Table } from '@/components/Table';

export function ProductionRates() {
  const rates = [
    { task: 'Prep walls', rate: 30, unit: 'sq ft/hr' },
    { task: 'Paint walls', rate: 150, unit: 'sq ft/hr' },
    { task: 'Paint trim', rate: 50, unit: 'linear ft/hr' },
    { task: 'Paint doors', rate: 2, unit: 'doors/hr' },
    { task: 'Caulking', rate: 100, unit: 'linear ft/hr' },
  ];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Production Rates</h1>
        <Button>Add Rate</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <thead>
              <tr className="border-b">
                <th className="text-left p-4">Task</th>
                <th className="text-left p-4">Rate</th>
                <th className="text-left p-4">Unit</th>
                <th className="text-left p-4"></th>
              </tr>
            </thead>
            <tbody>
              {rates.map(rate => (
                <tr key={rate.task} className="border-b">
                  <td className="p-4 font-medium">{rate.task}</td>
                  <td className="p-4">{rate.rate}</td>
                  <td className="p-4">{rate.unit}</td>
                  <td className="p-4"><Button variant="ghost" size="sm">Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
