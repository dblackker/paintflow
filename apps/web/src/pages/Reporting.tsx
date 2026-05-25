import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/Card';
import { StatCard } from '@/components/StatCard';

export function Reporting() {
  const stats = [
    { title: 'Total Revenue', value: '$542,000', subtitle: 'YTD' },
    { title: 'Avg Job Value', value: '$3,850', subtitle: 'Per job' },
    { title: 'Close Rate', value: '68%', subtitle: 'Estimates won' },
  ];

  const reports = [
    { name: 'Revenue Report', desc: 'Monthly revenue breakdown', path: '/reports' },
    { name: 'Lead Sources', desc: 'Where your leads come from', path: '/reporting/lead-sources' },
    { name: 'Production Report', desc: 'Crew productivity and costs', path: '/reports/production' },
    { name: 'Customer Report', desc: 'Customer lifetime value', path: '/reports/customers' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-bold mb-6">Reporting</h1>
      
      <div className="grid md:grid-cols-3 gap-4 mb-8">
        {stats.map(stat => <StatCard key={stat.title} {...stat} />)}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {reports.map(report => (
          <Link key={report.name} to={report.path}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <h3 className="font-semibold">{report.name}</h3>
                <p className="text-sm text-gray-600 mt-1">{report.desc}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
