import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/Tabs';
import { apiJson, formatAddress, formatMoney, formatPhone, labelize } from '@/lib/api';

interface Lead {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  status?: string | null;
  source?: string | null;
  createdAt?: string | null;
  notes?: string | null;
}

interface Estimate {
  id: string;
  status?: string | null;
  total?: number | string | null;
  createdAt?: string | null;
  sentAt?: string | null;
  signedAt?: string | null;
  customerPreviewUrl?: string | null;
}

interface Job {
  id: string;
  name?: string | null;
  status?: string | null;
  budget?: number | string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
}

interface Activity {
  id: string;
  action?: string | null;
  type?: string | null;
  description?: string | null;
  createdAt?: string | null;
}

interface Message {
  id: string;
  direction?: string | null;
  body?: string | null;
  createdAt?: string | null;
}

interface Payment {
  id: string;
  amount?: number | string | null;
  status?: string | null;
  method?: string | null;
  receivedAt?: string | null;
}

interface LeadDetailResponse {
  data: {
    customer: Lead;
    estimates: Estimate[];
    jobs: Job[];
    messages: Message[];
    payments: Payment[];
    activities?: Activity[];
    activity?: Activity[];
    photos?: {
      estimates?: unknown[];
      jobs?: unknown[];
    };
  };
}

function formatDate(value?: string | null, withTime = false) {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(new Date(value));
}

function estimateTotal(estimate: Estimate) {
  return Number(estimate.total || 0);
}

export function LeadDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<LeadDetailResponse['data'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    setIsLoading(true);
    apiJson<LeadDetailResponse>(`/v1/leads/${id}`)
      .then((response) => {
        if (!mounted) return;
        setDetail(response.data);
        setError('');
      })
      .catch((err: Error) => {
        if (!mounted) return;
        setError(err.message || 'Failed to load customer');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [id]);

  const activity = useMemo(() => [...(detail?.activities || []), ...(detail?.activity || [])]
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 20), [detail]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-56 rounded bg-gray-200" />
          <div className="h-32 rounded-xl bg-gray-200" />
        </div>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
        <Card className="border-red-200 bg-red-50 text-red-800">{error || 'Customer not found'}</Card>
      </div>
    );
  }

  const lead = detail.customer;
  const address = formatAddress(lead);

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="truncate text-2xl font-semibold tracking-tight text-gray-950">{lead.name}</h2>
            <StatusBadge status={String(lead.status || 'new')} />
          </div>
          <div className="space-y-1 text-sm text-gray-600">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {lead.phone && <span>{formatPhone(lead.phone)}</span>}
              {lead.email && <span>{lead.email}</span>}
            </div>
            {address && <div>{address}</div>}
            <div>{[lead.source && `Source: ${labelize(lead.source)}`, `Created ${formatDate(lead.createdAt)}`].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/estimates/production?leadId=${lead.id}`}>
            <Button>Create estimate</Button>
          </Link>
          <Link to={`/sms?leadId=${lead.id}`}>
            <Button variant="secondary">Message</Button>
          </Link>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="estimates">Estimates</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="messages">Messages</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader title="Contact" />
              <dl className="space-y-3 text-sm">
                <div><dt className="text-gray-500">Phone</dt><dd className="font-medium text-gray-950">{lead.phone ? formatPhone(lead.phone) : 'Not recorded'}</dd></div>
                <div><dt className="text-gray-500">Email</dt><dd className="font-medium text-gray-950">{lead.email || 'Not recorded'}</dd></div>
                <div><dt className="text-gray-500">Address</dt><dd className="font-medium text-gray-950">{address || 'Not recorded'}</dd></div>
              </dl>
            </Card>
            <Card>
              <CardHeader title="Customer history" />
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><p className="text-2xl font-semibold text-gray-950">{detail.estimates.length}</p><p className="text-gray-500">Estimates</p></div>
                <div><p className="text-2xl font-semibold text-gray-950">{detail.jobs.length}</p><p className="text-gray-500">Jobs</p></div>
                <div><p className="text-2xl font-semibold text-gray-950">{detail.payments.length}</p><p className="text-gray-500">Payments</p></div>
                <div><p className="text-2xl font-semibold text-gray-950">{detail.messages.length}</p><p className="text-gray-500">Messages</p></div>
              </div>
            </Card>
            <Card>
              <CardHeader title="Photos" />
              <p className="text-sm text-gray-600">
                {(detail.photos?.estimates?.length || 0) + (detail.photos?.jobs?.length || 0)} photos attached across estimates and jobs.
              </p>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="estimates">
          <div className="grid gap-3">
            {detail.estimates.length === 0 ? <Card>No estimates yet.</Card> : detail.estimates.map((estimate) => (
              <Card key={estimate.id} padding="md">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/estimates/${estimate.id}`} className="font-semibold text-gray-950 hover:text-blue-700">Estimate</Link>
                      <StatusBadge status={String(estimate.status || 'draft')} />
                    </div>
                    <p className="mt-1 text-sm text-gray-500">Created {formatDate(estimate.createdAt)} · Sent {formatDate(estimate.sentAt)} · Signed {formatDate(estimate.signedAt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span className="text-sm font-semibold text-gray-950">{formatMoney(estimateTotal(estimate))}</span>
                    <Link to={`/estimates/${estimate.id}`}><Button variant="secondary" size="sm">Details</Button></Link>
                    {estimate.customerPreviewUrl && <a href={estimate.customerPreviewUrl} target="_blank" rel="noreferrer"><Button as="span" variant="ghost" size="sm">Preview link</Button></a>}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="jobs">
          <div className="grid gap-3">
            {detail.jobs.length === 0 ? <Card>No jobs yet.</Card> : detail.jobs.map((job) => (
              <Card key={job.id} padding="md">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/jobs/${job.id}`} className="font-semibold text-gray-950 hover:text-blue-700">{job.name || 'Job'}</Link>
                      <StatusBadge status={String(job.status || 'scheduled')} />
                    </div>
                    <p className="mt-1 text-sm text-gray-500">Starts {formatDate(job.scheduledStartAt)} · Ends {formatDate(job.scheduledEndAt)}</p>
                  </div>
                  <span className="text-sm font-semibold text-gray-950">{formatMoney(job.budget || 0)}</span>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="payments">
          <div className="grid gap-3">
            {detail.payments.length === 0 ? <Card>No payments recorded.</Card> : detail.payments.map((payment) => (
              <Card key={payment.id} padding="md">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-950">{formatMoney(payment.amount || 0)}</p>
                    <p className="text-sm text-gray-500">{labelize(payment.method)} · {formatDate(payment.receivedAt, true)}</p>
                  </div>
                  <StatusBadge status={String(payment.status || 'recorded')} />
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="messages">
          <div className="grid gap-3">
            {detail.messages.length === 0 ? <Card>No messages yet.</Card> : detail.messages.slice(0, 20).map((message) => (
              <Card key={message.id} padding="md">
                <p className="text-sm font-semibold text-gray-950">{labelize(message.direction)} message</p>
                <p className="mt-1 text-sm text-gray-600">{message.body || 'No body'}</p>
                <p className="mt-2 text-xs text-gray-500">{formatDate(message.createdAt, true)}</p>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="activity">
          <div className="grid gap-3">
            {activity.length === 0 ? <Card>No activity yet.</Card> : activity.map((item) => (
              <Card key={item.id} padding="md">
                <p className="text-sm font-semibold text-gray-950">{labelize(item.action || item.type || 'Activity')}</p>
                {item.description && <p className="mt-1 text-sm text-gray-600">{item.description}</p>}
                <p className="mt-2 text-xs text-gray-500">{formatDate(item.createdAt, true)}</p>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
