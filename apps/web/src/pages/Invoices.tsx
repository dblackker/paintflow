import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/Button';
import { Card, CardContent, CardHeader } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { Input, Select, Textarea } from '@/components/Input';
import { apiJson, formatMoney } from '@/lib/api';

interface PurchaseItem {
  description?: string;
  sku?: string;
  quantity?: number;
  unitCost?: number;
  total?: number;
}

interface MaterialPurchase {
  id: string;
  supplier?: string | null;
  invoiceNumber?: string | null;
  totalAmount?: number | string | null;
  parsedData?: PurchaseItem[] | null;
  createdAt?: string | null;
  invoiceDate?: string | null;
}

interface UploadFormState {
  supplier: string;
  invoiceNumber: string;
  csvData: string;
}

const emptyUploadForm: UploadFormState = {
  supplier: '',
  invoiceNumber: '',
  csvData: '',
};

const supplierOptions = [
  { value: '', label: 'Select supplier...' },
  { value: 'Sherwin-Williams', label: 'Sherwin-Williams' },
  { value: 'Benjamin Moore', label: 'Benjamin Moore' },
  { value: 'Home Depot', label: 'Home Depot' },
  { value: 'Lowes', label: 'Lowes' },
  { value: 'Other', label: 'Other' },
];

const exampleCsv = `Description,SKU,Quantity,Unit Cost,Total
SuperPaint Interior,SW-123,5,65.00,325.00
Primer,SW-456,2,25.00,50.00`;

function formatDate(value?: string | null) {
  if (!value) return 'Not set';
  return new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function PurchaseSkeleton() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((item) => (
        <Card key={item} padding="sm" className="shadow-none">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-1/2 animate-pulse rounded bg-gray-200" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100" />
            </div>
            <div className="h-10 w-24 animate-pulse rounded bg-gray-100" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function PurchaseCard({ purchase }: { purchase: MaterialPurchase }) {
  const items = Array.isArray(purchase.parsedData) ? purchase.parsedData : [];
  return (
    <Card padding="sm">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <p className="pf-row-title">{purchase.supplier || 'Supplier invoice'}</p>
          <p className="pf-copy mt-1">
            Invoice {purchase.invoiceNumber || 'not set'} · {formatDate(purchase.invoiceDate || purchase.createdAt)}
          </p>
          {items.length > 0 && (
            <div className="mt-3 rounded-lg bg-gray-50 p-3">
              <p className="pf-meta">Parsed items</p>
              <div className="mt-2 space-y-1">
                {items.slice(0, 3).map((item, index) => (
                  <div key={`${item.description}-${index}`} className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-gray-700">{item.description || item.sku || 'Material'}</span>
                    <span className="shrink-0 font-medium text-gray-900">{formatMoney(item.total)}</span>
                  </div>
                ))}
                {items.length > 3 && <p className="pf-helper">+{items.length - 3} more items</p>}
              </div>
            </div>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-right">
          <p className="pf-section-title">{formatMoney(purchase.totalAmount)}</p>
          <p className="pf-meta">{items.length} item{items.length === 1 ? '' : 's'}</p>
        </div>
      </div>
    </Card>
  );
}

export function Invoices() {
  const [purchases, setPurchases] = useState<MaterialPurchase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<UploadFormState>(emptyUploadForm);
  const [isUploading, setIsUploading] = useState(false);

  const totalSpend = useMemo(
    () => purchases.reduce((sum, purchase) => sum + numberValue(purchase.totalAmount), 0),
    [purchases],
  );
  const itemCount = useMemo(
    () => purchases.reduce((sum, purchase) => sum + (Array.isArray(purchase.parsedData) ? purchase.parsedData.length : 0), 0),
    [purchases],
  );

  useEffect(() => {
    loadPurchases();
  }, []);

  useEffect(() => {
    document.body.classList.toggle('pf-modal-open', modalOpen);
    return () => document.body.classList.remove('pf-modal-open');
  }, [modalOpen]);

  async function loadPurchases() {
    setIsLoading(true);
    setError('');
    try {
      const payload = await apiJson<{ data?: MaterialPurchase[] }>('/v1/invoices/purchases');
      setPurchases(payload.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load material invoices');
    } finally {
      setIsLoading(false);
    }
  }

  function openUploadModal() {
    setForm(emptyUploadForm);
    setModalOpen(true);
  }

  function closeUploadModal() {
    if (isUploading) return;
    setModalOpen(false);
  }

  async function uploadInvoice(event: FormEvent) {
    event.preventDefault();
    setIsUploading(true);
    try {
      const payload = await apiJson<{ data?: { itemsProcessed?: number; totalAmount?: number } }>('/v1/invoices/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(form),
      });
      window.showToast?.(
        `Processed ${(payload.data?.itemsProcessed || 0).toLocaleString('en-US')} items. Total: ${formatMoney(payload.data?.totalAmount)}`,
        'success',
      );
      setModalOpen(false);
      await loadPurchases();
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-1 pb-24 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="pf-page-copy max-w-2xl">Track supplier invoices and material purchases.</p>
        <Button type="button" size="sm" leftIcon={<Icon name="plus" className="h-4 w-4" />} onClick={openUploadModal}>
          Upload invoice
        </Button>
      </div>

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm text-blue-900">
          Upload supplier invoice CSVs to track material costs and update pricing automatically when SKUs match existing paint products.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Card padding="sm" className="shadow-none">
          <p className="pf-meta">Invoices</p>
          <p className="pf-metric mt-1">{purchases.length}</p>
        </Card>
        <Card padding="sm" className="shadow-none">
          <p className="pf-meta">Items</p>
          <p className="pf-metric mt-1">{itemCount}</p>
        </Card>
        <Card padding="sm" className="shadow-none">
          <p className="pf-meta">Spend</p>
          <p className="pf-metric mt-1">{formatMoney(totalSpend)}</p>
        </Card>
      </div>

      <Card padding="none">
        <CardHeader
          className="mb-0 border-b border-gray-200 px-4 py-3 sm:px-5"
          title="Material Purchases"
          description="Imported supplier invoices can also create job material costs when attached to a job."
        />
        <CardContent className="p-4">
          {isLoading && <PurchaseSkeleton />}

          {!isLoading && error && (
            <div className="p-8 text-center">
              <Icon name="warning" className="mx-auto h-6 w-6 text-red-600" />
              <p className="pf-copy mt-2 text-red-700">{error}</p>
              <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={loadPurchases}>
                Retry
              </Button>
            </div>
          )}

          {!isLoading && !error && !purchases.length && (
            <EmptyState
              icon={<Icon name="file-text" className="h-5 w-5" />}
              title="No invoices uploaded yet."
              description="Paste a supplier CSV to start tracking material purchases and product cost changes."
              action={{ label: 'Upload invoice', onClick: openUploadModal }}
            />
          )}

          {!isLoading && !error && purchases.length > 0 && (
            <div className="space-y-3">
              {purchases.map((purchase) => (
                <PurchaseCard key={purchase.id} purchase={purchase} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {modalOpen && (
        <div
          className="mobile-sheet fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invoice-upload-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeUploadModal();
          }}
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white p-5 shadow-xl sm:rounded-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="invoice-upload-title" className="pf-section-title">Upload Invoice CSV</h2>
                <p className="pf-copy mt-1">CSV columns: Description, SKU, Quantity, Unit Cost, Total.</p>
              </div>
              <button type="button" className="btn-icon" aria-label="Close invoice upload" onClick={closeUploadModal}>
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>

            <form className="space-y-4" onSubmit={uploadInvoice}>
              <Select
                label="Supplier"
                required
                value={form.supplier}
                onChange={(event) => setForm({ ...form, supplier: event.target.value })}
                options={supplierOptions}
              />
              <Input
                label="Invoice #"
                autoComplete="off"
                enterKeyHint="next"
                placeholder="Optional"
                value={form.invoiceNumber}
                onChange={(event) => setForm({ ...form, invoiceNumber: event.target.value })}
              />
              <Textarea
                label="CSV data"
                required
                rows={8}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className="font-mono text-sm"
                placeholder="Paste CSV data here..."
                value={form.csvData}
                onChange={(event) => setForm({ ...form, csvData: event.target.value })}
              />
              <details className="rounded-lg bg-gray-50 p-3">
                <summary className="cursor-pointer text-sm font-medium text-gray-700">Example CSV format</summary>
                <pre className="mt-2 overflow-x-auto rounded bg-white p-2 text-xs text-gray-700">{exampleCsv}</pre>
              </details>
              <div className="mobile-sticky-actions flex flex-col gap-3 pt-2 sm:static sm:m-0 sm:flex-row sm:border-0 sm:bg-transparent sm:p-0">
                <Button type="button" variant="secondary" fullWidth onClick={closeUploadModal}>Cancel</Button>
                <Button type="submit" fullWidth isLoading={isUploading}>Upload</Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
