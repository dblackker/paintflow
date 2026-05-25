import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Tabs } from '@/components/Tabs';

export function JobDetail() {
  const { id } = useParams();
  const [job, setJob] = useState<any>(null);

  useEffect(() => {
    setTimeout(() => {
      setJob({
        id,
        customerName: 'John Smith',
        address: '123 Main St, Seattle, WA',
        status: 'in_progress',
        startDate: '2024-01-20',
        endDate: '2024-01-24',
        crew: 'Crew A',
        foreman: 'Mike Johnson',
        totalValue: 4485.60,
      });
    }, 300);
  }, [id]);

  if (!job) return <div className="p-8">Loading...</div>;

  const tabItems = [
    { id: 'overview', label: 'Overview' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'materials', label: 'Materials' },
    { id: 'photos', label: 'Photos' },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
      <div className="mb-5">
        <Link to="/jobs" className="text-blue-600 hover:text-blue-700 text-sm">← Back to Jobs</Link>
        <div className="flex items-center gap-3 mt-2">
          <h2 className="text-2xl font-bold text-gray-900">Job #{job.id}</h2>
          <Badge variant="info">IN PROGRESS</Badge>
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          <Tabs items={tabItems} defaultActive="overview">
            <div id="overview" className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4 text-sm">
                <div><p className="text-gray-600">Customer</p><p className="font-medium">{job.customerName}</p></div>
                <div><p className="text-gray-600">Address</p><p className="font-medium">{job.address}</p></div>
                <div><p className="text-gray-600">Crew</p><p className="font-medium">{job.crew}</p></div>
                <div><p className="text-gray-600">Foreman</p><p className="font-medium">{job.foreman}</p></div>
                <div><p className="text-gray-600">Start Date</p><p className="font-medium">{job.startDate}</p></div>
                <div><p className="text-gray-600">End Date</p><p className="font-medium">{job.endDate}</p></div>
              </div>
            </div>
            <div id="schedule" className="py-8 text-center text-gray-500">Schedule coming soon</div>
            <div id="materials" className="py-8 text-center text-gray-500">Materials tracking coming soon</div>
            <div id="photos" className="py-8 text-center text-gray-500">Photos coming soon</div>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
