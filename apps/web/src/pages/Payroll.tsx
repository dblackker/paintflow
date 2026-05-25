import { Card, CardContent } from '@/components/Card';
import { Button } from '@/components/Button';
import { Table } from '@/components/Table';
import { StatCard } from '@/components/StatCard';

export function Payroll() {
  const stats = [
    { title: 'Total Payroll', value: '$12,450', subtitle: 'This period' },
    { title: 'Hours', value: '192', subtitle: 'Total hours' },
    { title: 'Employees', value: '8', subtitle: 'Active' },
  ];

  const employees = [
    { name: 'Mike Chen', hours: 40, rate: 35, total: 1400 },
    { name: 'Emily Davis', hours: 38, rate: 32, total: 1216 },
    { name: 'Tom Wilson', hours: 40, rate: 28, total: 1120 },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Payroll</h1>
        <Button>Run Payroll</Button>
      </div>
      
      <div className="grid md:grid-cols-3 gap-4 mb-8">
        {stats.map(stat => <StatCard key={stat.title} {...stat} />)}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <thead>
              <tr className="border-b">
                <th className="text-left p-4">Employee</th>
                <th className="text-left p-4">Hours</th>
                <th className="text-left p-4">Rate</th>
                <th className="text-left p-4">Total</th>
              </tr>
            </thead>
            <tbody>
              {employees.map(emp => (
                <tr key={emp.name} className="border-b">
                  <td className="p-4 font-medium">{emp.name}</td>
                  <td className="p-4">{emp.hours}</td>
                  <td className="p-4">${emp.rate}/hr</td>
                  <td className="p-4 font-medium">${emp.total}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
