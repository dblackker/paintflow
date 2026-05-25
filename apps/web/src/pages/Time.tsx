import { Card, CardContent } from '@/components/Card';
import { Button } from '@/components/Button';
import { Table } from '@/components/Table';

export function Time() {
  const timeEntries = [
    { id: '1', employee: 'Mike Chen', job: '123 Main St', hours: 8, date: '2024-02-01' },
    { id: '2', employee: 'Emily Davis', job: '456 Oak Ave', hours: 7.5, date: '2024-02-01' },
    { id: '3', employee: 'Tom Wilson', job: '123 Main St', hours: 8, date: '2024-02-01' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Time Tracking</h1>
        <Button>Add Time</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <thead>
              <tr className="border-b">
                <th className="text-left p-4">Employee</th>
                <th className="text-left p-4">Job</th>
                <th className="text-left p-4">Hours</th>
                <th className="text-left p-4">Date</th>
              </tr>
            </thead>
            <tbody>
              {timeEntries.map(entry => (
                <tr key={entry.id} className="border-b">
                  <td className="p-4 font-medium">{entry.employee}</td>
                  <td className="p-4">{entry.job}</td>
                  <td className="p-4">{entry.hours}</td>
                  <td className="p-4">{entry.date}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
