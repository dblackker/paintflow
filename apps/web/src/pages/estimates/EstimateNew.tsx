import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { apiJson, formatMoney, formatPhone } from '@/lib/api';

interface Lead {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  streetAddress?: string;
  city?: string;
  state?: string;
}

interface ScopeItem {
  id: string;
  desc: string;
  qty: number;
  unit: string;
  laborHours: number;
  materialCost: number;
}

interface OrgSettings {
  defaultLaborRate?: number | string | null;
  materialMarkupPercent?: number | string | null;
  salesTaxRate?: number | string | null;
  depositPercent?: number | string | null;
}

interface LeadsResponse {
  data?: Lead[];
}

interface SettingsResponse {
  data?: OrgSettings;
}

interface EstimateResponse {
  data?: {
    id: string;
  };
}

function apiErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return 'Request failed';
}

function numeric(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function EstimateNew() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialLeadId = searchParams.get('leadId') || '';

  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState(initialLeadId);
  const [items, setItems] = useState<ScopeItem[]>([
    { id: '1', desc: 'Prep, patching, masking, and setup', qty: 1, unit: 'project', laborHours: 4, materialCost: 1 },
    { id: '2', desc: 'Paint walls and ceilings', qty: 1, unit: 'area', laborHours: 8, materialCost: 1 },
  ]);
  const [settings, setSettings] = useState<OrgSettings>({
    defaultLaborRate: 65,
    materialMarkupPercent: 30,
    salesTaxRate: 0.092,
    depositPercent: 50,
  });
  const [notes, setNotes] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function loadSetup() {
      setIsLoading(true);
      setLoadError('');
      try {
        const [leadsPayload, settingsPayload] = await Promise.all([
          apiJson<LeadsResponse>('/v1/leads?status=all&limit=200'),
          apiJson<SettingsResponse>('/v1/settings/org'),
        ]);
        if (cancelled) return;
        const loadedLeads = leadsPayload.data || [];
        setLeads(loadedLeads);
        if (initialLeadId && loadedLeads.some((lead) => lead.id === initialLeadId)) {
          setSelectedLeadId(initialLeadId);
        }
        setSettings({
          defaultLaborRate: numeric(settingsPayload.data?.defaultLaborRate, 65),
          materialMarkupPercent: numeric(settingsPayload.data?.materialMarkupPercent, 30),
          salesTaxRate: numeric(settingsPayload.data?.salesTaxRate, 0.092),
          depositPercent: numeric(settingsPayload.data?.depositPercent, 50),
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(apiErrorMessage(err));
          window.showToast?.('Failed to load estimate setup', 'error');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    void loadSetup();
    return () => {
      cancelled = true;
    };
  }, []);

  const addItem = () => {
    const newItem: ScopeItem = {
      id: Date.now().toString(),
      desc: '',
      qty: 1,
      unit: 'item',
      laborHours: 0,
      materialCost: 0,
    };
    setItems([...items, newItem]);
  };

  const updateItem = (id: string, field: keyof ScopeItem, value: any) => {
    setItems(items.map(item => 
      item.id === id ? { ...item, [field]: value } : item
    ));
  };

  const removeItem = (id: string) => {
    setItems(items.filter(item => item.id !== id));
  };

  const calculateItemTotal = (item: ScopeItem) => {
    const laborCost = item.laborHours * numeric(settings.defaultLaborRate, 65);
    const materialCost = item.materialCost * (1 + numeric(settings.materialMarkupPercent, 30) / 100);
    const itemTotal = laborCost + materialCost;
    return item.qty * itemTotal;
  };

  const totals = items.reduce((acc, item) => {
    const laborHours = item.qty * item.laborHours;
    const laborCost = laborHours * numeric(settings.defaultLaborRate, 65);
    const materialCost = item.materialCost * (1 + numeric(settings.materialMarkupPercent, 30) / 100) * item.qty;
    const subtotal = laborCost + materialCost;
    
    return {
      laborHours: acc.laborHours + laborHours,
      laborCost: acc.laborCost + laborCost,
      materialCost: acc.materialCost + materialCost,
      subtotal: acc.subtotal + subtotal,
    };
  }, { laborHours: 0, laborCost: 0, materialCost: 0, subtotal: 0 });

  const tax = totals.subtotal * numeric(settings.salesTaxRate, 0.092);
  const total = totals.subtotal + tax;
  const deposit = total * (numeric(settings.depositPercent, 50) / 100);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!selectedLeadId) {
      window.showToast?.('Select a customer first', 'error');
      return;
    }
    if (!items.some((item) => item.desc.trim() && item.qty > 0 && calculateItemTotal(item) > 0)) {
      window.showToast?.('Add at least one priced scope item', 'error');
      return;
    }

    setIsSubmitting(true);

    try {
      const payload = await apiJson<EstimateResponse>('/v1/estimates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          leadId: selectedLeadId,
          packages: [{
            name: 'proposal',
            subtotal: totals.subtotal,
            tax,
            total,
            items: items
              .filter((item) => item.desc.trim() && item.qty > 0 && calculateItemTotal(item) > 0)
              .map((item) => ({
                desc: item.desc.trim(),
                qty: item.qty,
                rate: Number(((item.laborHours * numeric(settings.defaultLaborRate, 65)) + (item.materialCost * (1 + numeric(settings.materialMarkupPercent, 30) / 100))).toFixed(2)),
                category: item.unit || 'item',
                notes: [
                  `${item.qty} ${item.unit || 'item'}`,
                  `${item.laborHours} labor hours`,
                  `${formatMoney(item.materialCost)} materials before markup`,
                  notes.trim(),
                ].filter(Boolean).join('; '),
              })),
          }],
        }),
      });
      const estimateId = payload.data?.id;
      window.showToast?.('Estimate created. Opening it now.', 'success');
      navigate(estimateId ? `/estimates/${estimateId}` : '/estimates');
    } catch (err) {
      window.showToast?.(apiErrorMessage(err), 'error');
    } finally {
      setIsSubmitting(false);
    }
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

  if (loadError) {
    return (
      <div className="mx-auto max-w-3xl px-1 pb-24 sm:px-0">
        <Card>
          <CardContent className="p-8 text-center">
            <p className="pf-section-title">Estimate setup could not be loaded</p>
            <p className="pf-copy mt-2">{loadError}</p>
            <Button type="button" className="mt-5" onClick={() => window.location.reload()}>Try again</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-1 pb-24 sm:px-0">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <p className="text-gray-600 mt-1">Build one simple proposal from a few priced scope rows.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/estimates/production">
            <Button variant="secondary" size="sm">Use production estimator</Button>
          </Link>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid lg:grid-cols-[1fr_340px] gap-5">
        <section className="space-y-4">
          <Card>
            <CardContent className="p-4 sm:p-5">
              <label className="block text-sm font-medium text-gray-700 mb-2">Customer</label>
              <Select
                value={selectedLeadId}
                onChange={(e) => setSelectedLeadId(e.target.value)}
                required
              >
                <option value="">Select customer...</option>
                {leads.map(lead => (
                  <option key={lead.id} value={lead.id}>
                    {lead.name} {lead.phone ? `(${formatPhone(lead.phone)})` : ''}
                  </option>
                ))}
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Scope Items</h3>
                  <p className="text-sm text-gray-600">Each row calculates: Qty x ((labor hours x labor rate) + materials with markup).</p>
                </div>
                <Button type="button" size="sm" onClick={addItem}>Add Item</Button>
              </div>

              <div className="space-y-3">
                {items.map((item) => (
                  <div key={item.id} className="grid gap-2 sm:grid-cols-[1fr_90px_110px_120px_120px_auto] items-end border rounded-lg p-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                      <Input
                        value={item.desc}
                        onChange={(e) => updateItem(item.id, 'desc', e.target.value)}
                        placeholder="Scope item"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Qty</label>
                      <Input
                        type="number"
                        min="0"
                        step="0.25"
                        value={item.qty}
                        onChange={(e) => updateItem(item.id, 'qty', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Scope type</label>
                      <Input
                        value={item.unit}
                        onChange={(e) => updateItem(item.id, 'unit', e.target.value)}
                        placeholder="room, wall, door"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Labor hours</label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.laborHours}
                        onChange={(e) => updateItem(item.id, 'laborHours', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Material $</label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.materialCost}
                        onChange={(e) => updateItem(item.id, 'materialCost', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(item.id)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>

              <div className="mt-3 rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
                Qty is the multiplier for the row. Scope type is descriptive only and helps the customer understand the scope.
              </div>

              <div className="mt-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">Notes</label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Additional notes for this estimate..."
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-20 self-start">
          <Card>
            <CardHeader title="Owner Defaults" />
            <CardContent>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Labor rate</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={numeric(settings.defaultLaborRate, 65)}
                    onChange={(e) => setSettings({ ...settings, defaultLaborRate: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Material markup %</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={numeric(settings.materialMarkupPercent, 30)}
                    onChange={(e) => setSettings({ ...settings, materialMarkupPercent: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Sales tax %</label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={(numeric(settings.salesTaxRate, 0.092) * 100).toFixed(2)}
                    onChange={(e) => setSettings({ ...settings, salesTaxRate: (parseFloat(e.target.value) || 0) / 100 })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Deposit %</label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={numeric(settings.depositPercent, 50)}
                    onChange={(e) => setSettings({ ...settings, depositPercent: parseFloat(e.target.value) || 0 })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader title="Proposal Preview" />
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Labor ({totals.laborHours.toFixed(1)} hrs)</span>
                    <span className="font-medium">{formatMoney(totals.laborCost)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Materials</span>
                  <span className="font-medium">{formatMoney(totals.materialCost)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t">
                  <span className="text-gray-600">Subtotal</span>
                  <span className="font-medium">{formatMoney(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Tax ({(numeric(settings.salesTaxRate, 0.092) * 100).toFixed(1)}%)</span>
                  <span className="font-medium">{formatMoney(tax)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t text-base font-semibold">
                  <span>Total</span>
                  <span>{formatMoney(total)}</span>
                </div>
                <div className="flex justify-between text-blue-600">
                  <span>Deposit ({numeric(settings.depositPercent, 50)}%)</span>
                  <span className="font-medium">{formatMoney(deposit)}</span>
                </div>
              </div>

              <Button
                type="submit"
                fullWidth
                isLoading={isSubmitting}
                className="mt-4"
              >
                {isSubmitting ? 'Creating...' : 'Create Estimate'}
              </Button>
            </CardContent>
          </Card>
        </aside>
      </form>
    </div>
  );
}
