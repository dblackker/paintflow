import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { StatusBadge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';

interface Estimate {
  id: string;
  customerName: string;
  address: string;
  contact: string;
  status: string;
  totalCents: number;
  sentAt?: string;
  leadId?: string;
}

export function EstimatesList() {
  const [estimates, setEstimates] = useState<Estimate[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // TODO: Fetch from API
    setTimeout(() => {
      setEstimates([
        {
          id: '1',
          customerName: 'John Smith',
          address: '123 Main St, Seattle, WA',
          contact: '(206) 555-0100',
          status: 'sent',
          totalCents: 450000,
          sentAt: '2024-01-15',
          leadId: 'lead-1',
        },
        {
          id: '2',
          customerName: 'Jane Doe',
          address: '456 Oak Ave, Bellevue, WA',
          contact: '(425) 555-0200',
          status: 'approved',
          totalCents: 720000,
          sentAt: '2024-01-10',
          leadId: 'lead-2',
        },
      ]);
      setIsLoading(false);
    }, 500);
  }, []);

  const filteredEstimates = estimates.filter(estimate => {
    const matchesSearch = !searchQuery || 
      estimate.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      estimate.contact.includes(searchQuery);
    
    const matchesStatus = statusFilter === 'all' || estimate.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: estimates.length,
    sent: estimates.filter(e => e.status === 'sent').length,
    approved: estimates.filter(e => e.status === 'approved').length,
    draft: estimates.filter(e => e.status === 'draft').length,
  };

  const formatMoney = (cents: number) => {
    return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  };

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-48 mb-4" />
          <div className="h-4 bg-gray-200 rounded w-96 mb-8" />
          <div className="grid grid-cols-4 gap-4 mb-8">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 bg-gray-200 rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Estimates</h2>
          <p className="text-gray-600 mt-1">Track sent, accepted, and declined painting proposals.</p>
        </div>
        <Link to="/estimates/production">
          <Button>Start estimate</Button>
        </Link>
      </div>

      {/* Estimate Type Cards */}
      <div className="grid md:grid-cols-2 gap-3 mb-4">
        <Link to="/estimates/production">
          <Card hoverable padding="md" className="h-full">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <h3 className="text-base font-semibold text-gray-900">Production estimate</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Use measured surfaces, prep levels, production rates, labor, paint products, and templates.
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-blue-50 text-blue-700 px-3 py-1 text-xs font-medium">
                Default
              </span>
            </div>
          </Card>
        </Link>
        
        <Link to="/estimates/new">
          <Card hoverable padding="md" className="h-full">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <h3 className="text-base font-semibold text-gray-900">Quick line-item estimate</h3>
                <p className="text-sm text-gray-600 mt-1">
                  Build a simple estimate from manually entered scope items when takeoff detail is not needed.
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-gray-100 text-gray-700 px-3 py-1 text-xs font-medium">
                Simple
              </span>
            </div>
          </Card>
        </Link>
      </div>

      {/* Filters */}
      <Card padding="md" className="mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-3">
          <Input
            type="search"
            placeholder="Search customer, phone, or email"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'sent', label: 'Sent' },
              { value: 'approved', label: 'Approved' },
              { value: 'declined', label: 'Declined' },
              { value: 'draft', label: 'Draft' },
            ]}
          />
        </div>
        
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
            <div className="text-sm text-gray-600">Total</div>
          </div>
          <div className="bg-blue-50 rounded-lg p-3">
            <div className="text-2xl font-bold text-blue-600">{stats.sent}</div>
            <div className="text-sm text-gray-600">Sent</div>
          </div>
          <div className="bg-green-50 rounded-lg p-3">
            <div className="text-2xl font-bold text-green-600">{stats.approved}</div>
            <div className="text-sm text-gray-600">Approved</div>
          </div>
          <div className="bg-yellow-50 rounded-lg p-3">
            <div className="text-2xl font-bold text-yellow-600">{stats.draft}</div>
            <div className="text-sm text-gray-600">Draft</div>
          </div>
        </div>
      </Card>

      {/* Estimates List */}
      {filteredEstimates.length === 0 ? (
        <EmptyState
          icon={<Icon name="file-text" className="w-8 h-8" />}
          title="No estimates found"
          description="Get started by creating your first estimate."
          action={{
            label: 'Start estimate',
            onClick: () => window.location.href = '/estimates/production'
          }}
        />
      ) : (
        <div className="grid gap-3">
          {filteredEstimates.map((estimate) => (
            <Card key={estimate.id} hoverable padding="md">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-base font-semibold text-gray-900 truncate">
                      {estimate.customerName}
                    </h3>
                    <StatusBadge status={estimate.status} />
                  </div>
                  <p className="text-sm text-gray-600 truncate">{estimate.address}</p>
                  <p className="text-sm text-gray-500 mt-1">{estimate.contact}</p>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold text-gray-900">
                    {formatMoney(estimate.totalCents)}
                  </div>
                  {estimate.sentAt && (
                    <div className="text-xs text-gray-500 mt-1">
                      Sent {new Date(estimate.sentAt).toLocaleDateString()}
                    </div>
                  )}
                  <div className="flex gap-2 mt-3">
                    <Link to={`/estimates/${estimate.id}`}>
                      <Button variant="secondary" size="sm">View</Button>
                    </Link>
                    <Link to={`/estimates/production?estimateId=${estimate.id}`}>
                      <Button variant="ghost" size="sm">Edit</Button>
                    </Link>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
