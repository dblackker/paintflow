import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Badge } from '@/components/Badge';
import { EmptyState } from '@/components/EmptyState';

interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  status: 'new' | 'contacted' | 'qualified' | 'quoted' | 'won' | 'lost';
  source: string;
  createdAt: string;
  estimatedValue?: number;
}

export function Leads() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setTimeout(() => {
      setLeads([
        {
          id: '1',
          name: 'John Smith',
          phone: '(206) 555-0100',
          email: 'john@email.com',
          address: '123 Main St, Seattle, WA',
          status: 'quoted',
          source: 'Website',
          createdAt: '2024-01-10',
          estimatedValue: 4500,
        },
        {
          id: '2',
          name: 'Jane Doe',
          phone: '(425) 555-0200',
          email: 'jane@email.com',
          address: '456 Oak Ave, Bellevue, WA',
          status: 'qualified',
          source: 'Referral',
          createdAt: '2024-01-12',
          estimatedValue: 7200,
        },
      ]);
      setIsLoading(false);
    }, 500);
  }, []);

  const filteredLeads = leads.filter(lead =>
    lead.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    lead.phone.includes(searchQuery)
  );

  if (isLoading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-5 sm:py-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Leads</h2>
          <p className="text-gray-600 mt-1">Track potential customers</p>
        </div>
        <Button>Add Lead</Button>
      </div>

      <div className="mb-4">
        <Input
          placeholder="Search leads..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {filteredLeads.length === 0 ? (
        <Card><CardContent className="p-12"><EmptyState title="No leads" description="Add your first lead to get started." action={<Button>Add Lead</Button>} /></CardContent></Card>
      ) : (
        <div className="space-y-3">
          {filteredLeads.map((lead) => (
            <Card key={lead.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-1">
                      <h3 className="font-semibold text-gray-900">{lead.name}</h3>
                      <Badge variant={lead.status === 'won' ? 'success' : lead.status === 'quoted' ? 'info' : 'default'}>
                        {lead.status.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-600">{lead.phone} • {lead.email}</p>
                    <p className="text-sm text-gray-600 mt-1">{lead.address}</p>
                    <p className="text-xs text-gray-500 mt-2">Source: {lead.source} • {lead.createdAt}</p>
                  </div>
                  {lead.estimatedValue && (
                    <div className="text-right">
                      <p className="text-lg font-semibold">${lead.estimatedValue.toLocaleString()}</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
