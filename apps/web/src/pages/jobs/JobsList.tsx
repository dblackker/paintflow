import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';

interface Job {
  id: string;
  customerName: string;
  address: string;
  status: 'scheduled' | 'in_progress' | 'completed' | 'on_hold';
  startDate: string;
  crew: string;
  totalValue: number;
}

export function JobsList() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setTimeout(() => {
      setJobs([
        {
          id: '1',
          customerName: 'John Smith',
          address: '123 Main St, Seattle, WA',
          status: 'in_progress',
          startDate: '2024-01-20',
          crew: 'Crew A',
          totalValue: 4485.60,
        },
        {
          id: '2',
          customerName: 'Jane Doe',
          address: '456 Oak Ave, Bellevue, WA',
          status: 'scheduled',
          startDate: '2024-01-25',
          crew: 'Crew B',
          totalValue: 7200.00,
        },
      ]);
      setIsLoading(false);
    }, 500);
  }, []);

  const filteredJobs = jobs.filter(job =>
    job.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    job.address.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const formatMoney = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
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

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Jobs</h2>
          <p className="text-gray-600 mt-1">Manage active painting projects</p>
        </div>
        <Button>Schedule Job</Button>
      </div>

      <div className="mb-4">
        <Input
          placeholder="Search jobs by customer or address..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {filteredJobs.length === 0 ? (
        <Card>
          <CardContent className="p-12">
            <EmptyState
              title="No jobs found"
              description="Schedule your first job to get started."
              action={<Button>Schedule Job</Button>}
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredJobs.map((job) => (
            <Card key={job.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <Link to={`/jobs/${job.id}`} className="block">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-semibold text-gray-900">{job.customerName}</h3>
                        <Badge variant={
                          job.status === 'completed' ? 'success' :
                          job.status === 'in_progress' ? 'info' :
                          job.status === 'on_hold' ? 'warning' : 'default'
                        }>
                          {job.status.replace('_', ' ').toUpperCase()}
                        </Badge>
                      </div>
                      <p className="text-sm text-gray-600">{job.address}</p>
                      <div className="flex gap-4 mt-2 text-xs text-gray-500">
                        <span>Start: {new Date(job.startDate).toLocaleDateString()}</span>
                        <span>Crew: {job.crew}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold text-gray-900">{formatMoney(job.totalValue)}</p>
                    </div>
                  </div>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
