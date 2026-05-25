import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/Tabs';
import { apiJson, formatAddress, formatMoney, formatPhone, labelize } from '@/lib/api';

interface JobCostingResponse {
  data: {
    job: {
      id: string;
      name?: string | null;
      status?: string | null;
      budget?: number | string | null;
      estimateId?: string | null;
      leadId?: string | null;
      leadName?: string | null;
      leadEmail?: string | null;
      leadPhone?: string | null;
      leadStreetAddress?: string | null;
      leadCity?: string | null;
      leadState?: string | null;
      leadPostalCode?: string | null;
      completedAt?: string | null;
    };
    revenue: { contract: number; approvedChangeOrders: number; total: number };
    costs: { labor: number; materials: number; supplies: number; expenses: number; total: number };
    production: { laborHours: number; averageLaborRate: number };
    budget: { estimatedMaterials?: number | null; materialVariance?: number | null; remainingGrossProfit: number };
    profitability: { grossProfit: number; grossMargin: number; costToRevenue: number };
    lists: {
      costs: Array<{ id: string; category?: string | null; description?: string | null; quantity?: string | number | null; totalCost?: string | number | null }>;
      changeOrders: Array<{ id: string; title?: string | null; status?: string | null; amount?: string | number | null }>;
      materialPurchases: Array<{ id: string; vendor?: string | null; totalCost?: string | number | null; purchasedAt?: string | null }>;
    };
  };
}

function formatDate(value?: string | null) {
  if (!value) return 'Not recorded';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function formatPercent(value: number) {
  return `${Number(value || 0).toFixed(1)}%`;
}

export function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<JobCostingResponse['data'] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    setIsLoading(true);
    apiJson<JobCostingResponse>(`/v1/jobs/${id}/costing`)
      .then((response) => {
        if (!mounted) return;
        setDetail(response.data);
        setError('');
      })
      .catch((err: Error) => {
        if (!mounted) return;
        setError(err.message || 'Failed to load job');
      })
      .finally(() => {
        if (mounted) setIsLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [id]);

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
        <Card className="border-red-200 bg-red-50 text-red-800">{error || 'Job not found'}</Card>
      </div>
    );
  }

  const { job } = detail;
  const address = formatAddress(job);

  return (
    <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="truncate text-2xl font-semibold tracking-tight text-gray-950">{job.name || job.leadName || 'Job detail'}</h2>
            <StatusBadge status={String(job.status || 'scheduled')} />
          </div>
          <div className="space-y-1 text-sm text-gray-600">
            {job.leadName && <Link to={`/leads/${job.leadId}`} className="font-medium text-gray-800 hover:text-blue-700">{job.leadName}</Link>}
            {address && <div>{address}</div>}
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {job.leadPhone && <span>{formatPhone(job.leadPhone)}</span>}
              {job.leadEmail && <span>{job.leadEmail}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {job.estimateId && <Link to={`/estimates/${job.estimateId}`}><Button variant="secondary">Estimate</Button></Link>}
          <Link to="/time"><Button>Log time</Button></Link>
        </div>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card padding="sm"><p className="text-xs font-medium text-gray-500">Revenue</p><p className="mt-1 text-xl font-semibold text-gray-950">{formatMoney(detail.revenue.total)}</p></Card>
        <Card padding="sm"><p className="text-xs font-medium text-gray-500">Actual cost</p><p className="mt-1 text-xl font-semibold text-gray-950">{formatMoney(detail.costs.total)}</p></Card>
        <Card padding="sm"><p className="text-xs font-medium text-gray-500">Gross margin</p><p className="mt-1 text-xl font-semibold text-gray-950">{formatPercent(detail.profitability.grossMargin)}</p></Card>
        <Card padding="sm"><p className="text-xs font-medium text-gray-500">Labor hours</p><p className="mt-1 text-xl font-semibold text-gray-950">{Number(detail.production.laborHours || 0).toLocaleString()}</p></Card>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="costs">Costs</TabsTrigger>
          <TabsTrigger value="change-orders">Change orders</TabsTrigger>
          <TabsTrigger value="materials">Materials</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Job economics" />
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-gray-500">Contract</dt><dd className="font-semibold text-gray-950">{formatMoney(detail.revenue.contract)}</dd></div>
                <div><dt className="text-gray-500">Change orders</dt><dd className="font-semibold text-gray-950">{formatMoney(detail.revenue.approvedChangeOrders)}</dd></div>
                <div><dt className="text-gray-500">Gross profit</dt><dd className="font-semibold text-gray-950">{formatMoney(detail.profitability.grossProfit)}</dd></div>
                <div><dt className="text-gray-500">Cost to revenue</dt><dd className="font-semibold text-gray-950">{formatPercent(detail.profitability.costToRevenue)}</dd></div>
              </dl>
            </Card>
            <Card>
              <CardHeader title="Production" />
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-gray-500">Labor cost</dt><dd className="font-semibold text-gray-950">{formatMoney(detail.costs.labor)}</dd></div>
                <div><dt className="text-gray-500">Average labor rate</dt><dd className="font-semibold text-gray-950">{formatMoney(detail.production.averageLaborRate)}</dd></div>
                <div><dt className="text-gray-500">Estimated materials</dt><dd className="font-semibold text-gray-950">{detail.budget.estimatedMaterials == null ? 'Not estimated' : formatMoney(detail.budget.estimatedMaterials)}</dd></div>
                <div><dt className="text-gray-500">Completed</dt><dd className="font-semibold text-gray-950">{formatDate(job.completedAt)}</dd></div>
              </dl>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="costs">
          <div className="grid gap-3">
            {detail.lists.costs.length === 0 ? <Card>No costs recorded.</Card> : detail.lists.costs.map((cost) => (
              <Card key={cost.id} padding="md">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-950">{cost.description || labelize(cost.category)}</p>
                    <p className="text-sm text-gray-500">{labelize(cost.category)} · Qty {Number(cost.quantity || 0).toLocaleString()}</p>
                  </div>
                  <span className="font-semibold text-gray-950">{formatMoney(cost.totalCost || 0)}</span>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="change-orders">
          <div className="grid gap-3">
            {detail.lists.changeOrders.length === 0 ? <Card>No change orders.</Card> : detail.lists.changeOrders.map((order) => (
              <Card key={order.id} padding="md">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-gray-950">{order.title || 'Change order'}</p>
                    <StatusBadge status={String(order.status || 'draft')} />
                  </div>
                  <span className="font-semibold text-gray-950">{formatMoney(order.amount || 0)}</span>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="materials">
          <div className="grid gap-3">
            {detail.lists.materialPurchases.length === 0 ? <Card>No material purchases.</Card> : detail.lists.materialPurchases.map((purchase) => (
              <Card key={purchase.id} padding="md">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-gray-950">{purchase.vendor || 'Material purchase'}</p>
                    <p className="text-sm text-gray-500">{formatDate(purchase.purchasedAt)}</p>
                  </div>
                  <span className="font-semibold text-gray-950">{formatMoney(purchase.totalCost || 0)}</span>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
