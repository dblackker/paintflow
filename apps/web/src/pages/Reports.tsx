import { Card, CardContent } from '@/components/Card';
import { StatCard } from '@/components/StatCard';

export function Reports() {
  const stats = [
    { title: 'Revenue', value: '$45,200', subtitle: 'This month' },
    { title: 'Jobs Completed', value: '12', subtitle: '+3 from last month' },
    { title: 'Avg Job Size', value: '$3,767', subtitle: 'Per job' },
    { title: 'Win Rate', value: '68%', subtitle: 'Estimates won' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold mb-6">Reports</h1>
      
      <div className="grid md:grid-cols-4 gap-4 mb-8">
        {stats.map(stat => <StatCard key={stat.title} {...stat} />)}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-6">
            <h3 className="font-semibold mb-4">Revenue by Month</h3>
            <div className="h-48 bg-gray-50 rounded flex items-end justify-around p-4">
              {[40, 60, 80, 55, 70, 90].map((h, i) => (
                <div key={i} className="bg-blue-600 w-12 rounded-t" style={{ height: `${h}%` }}></div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h3 className="font-semibold mb-4">Jobs by Status</h3>
            <div className="space-y-3">
              {[
                { status: 'Completed', count: 12, color: 'bg-green-600' },
                { status: 'In Progress', count: 5, color: 'bg-blue-600' },
                { status: 'Scheduled', count: 8, color: 'bg-yellow-600' },
              ].map(item => (
                <div key={item.status} className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${item.color}`}></div>
                  <span className="flex-1">{item.status}</span>
                  <span className="font-medium">{item.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
