import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card, CardHeader } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Input, Select } from '@/components/Input';
import { ServiceErrorState } from '@/components/ServiceErrorState';
import { apiJson, formatMoney, labelize } from '@/lib/api';

type CatalogTab = 'products' | 'colors';

interface CatalogProduct {
  id: string;
  supplierId: string;
  supplierName?: string | null;
  externalId?: string | null;
  sku?: string | null;
  name?: string | null;
  productLine?: string | null;
  type?: string | null;
  category?: string | null;
  sheens?: string[] | null;
  bases?: string[] | null;
  description?: string | null;
  features?: string[] | null;
  url?: string | null;
  imageUrl?: string | null;
  size?: string | null;
  priceCents?: number | null;
  currency?: string | null;
  pricingTier?: string | null;
  coverageSqFtMin?: number | null;
  coverageSqFtMax?: number | null;
  lastSeenAt?: string | null;
}

interface CatalogColor {
  id: string;
  supplierId: string;
  supplierName?: string | null;
  externalId?: string | null;
  colorCode?: string | null;
  name?: string | null;
  hexCode?: string | null;
  rgbR?: number | null;
  rgbG?: number | null;
  rgbB?: number | null;
  collection?: string | null;
  family?: string | null;
  lrv?: number | null;
  isPopular?: boolean | null;
  lastSeenAt?: string | null;
}

interface ProductColorCompatibility {
  mappingId: string;
  baseRequired?: string | null;
  recommendedUse?: string[] | null;
  color: CatalogColor;
}

interface ColorProductCompatibility {
  mappingId: string;
  baseRequired?: string | null;
  recommendedUse?: string[] | null;
  product: CatalogProduct;
}

interface CatalogStatus {
  latestRun?: {
    status?: string | null;
    suppliers?: string[] | null;
    productsUpserted?: number | null;
    colorsUpserted?: number | null;
    productColorsUpserted?: number | null;
    issues?: Array<{ severity?: string; description?: string }> | null;
    startedAt?: string | null;
    finishedAt?: string | null;
  } | null;
  counts?: {
    productCount?: number | string | null;
    colorCount?: number | string | null;
  } | null;
}

const productTypeOptions = [
  { value: '', label: 'All product types' },
  { value: 'interior', label: 'Interior' },
  { value: 'exterior', label: 'Exterior' },
  { value: 'primer', label: 'Primer' },
  { value: 'stain', label: 'Stain' },
  { value: 'specialty', label: 'Specialty' },
];

function arrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function cents(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed / 100 : null;
}

function dateLabel(value?: string | null) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function productName(product: CatalogProduct) {
  return [product.productLine, product.name].filter(Boolean).join(' - ') || product.name || 'Paint product';
}

function coverageLabel(product: CatalogProduct) {
  if (product.coverageSqFtMin && product.coverageSqFtMax) return `${product.coverageSqFtMin}-${product.coverageSqFtMax} sq ft/gal`;
  if (product.coverageSqFtMax) return `${product.coverageSqFtMax} sq ft/gal`;
  if (product.coverageSqFtMin) return `${product.coverageSqFtMin}+ sq ft/gal`;
  return 'Coverage not listed';
}

function colorLabel(color: CatalogColor) {
  return [color.name, color.colorCode ? `(${color.colorCode})` : ''].filter(Boolean).join(' ') || 'Paint color';
}

function supplierOptions(products: CatalogProduct[], colors: CatalogColor[]) {
  const suppliers = new Map<string, string>();
  products.forEach((product) => suppliers.set(product.supplierId, product.supplierName || product.supplierId));
  colors.forEach((color) => suppliers.set(color.supplierId, color.supplierName || color.supplierId));
  return Array.from(suppliers.entries())
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([value, label]) => ({ value, label }));
}

function familyOptions(colors: CatalogColor[]) {
  return Array.from(new Set(colors.map((color) => color.family).filter(Boolean).map(String)))
    .sort((a, b) => a.localeCompare(b))
    .map((family) => ({ value: family, label: labelize(family) }));
}

function compatibilityUse(value: unknown) {
  const uses = arrayValue(value);
  return uses.length ? uses.map(labelize).join(', ') : 'Any matching use';
}

function ProductSkeleton() {
  return (
    <div className="divide-y divide-gray-200">
      {[0, 1, 2, 3].map((item) => (
        <div key={item} className="p-4">
          <div className="h-4 w-2/3 animate-pulse rounded bg-gray-200" />
          <div className="mt-2 h-3 w-4/5 animate-pulse rounded bg-gray-100" />
          <div className="mt-3 h-8 w-full animate-pulse rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

export function SupplierCatalog() {
  const [tab, setTab] = useState<CatalogTab>('products');
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [colors, setColors] = useState<CatalogColor[]>([]);
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [selectedColor, setSelectedColor] = useState<CatalogColor | null>(null);
  const [productColors, setProductColors] = useState<ProductColorCompatibility[]>([]);
  const [colorProducts, setColorProducts] = useState<ColorProductCompatibility[]>([]);
  const [query, setQuery] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [productType, setProductType] = useState('');
  const [colorFamily, setColorFamily] = useState('');
  const [popularOnly, setPopularOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [compatLoading, setCompatLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    loadCatalog();
  }, []);

  useEffect(() => {
    if (!selectedProduct) return;
    loadProductColors(selectedProduct.id);
  }, [selectedProduct?.id]);

  useEffect(() => {
    if (!selectedColor) return;
    loadColorProducts(selectedColor.id);
  }, [selectedColor?.id]);

  const suppliers = useMemo(() => supplierOptions(products, colors), [products, colors]);
  const families = useMemo(() => familyOptions(colors), [colors]);
  const filteredProducts = useMemo(() => products.filter((product) => {
    const search = query.trim().toLowerCase();
    if (supplierId && product.supplierId !== supplierId) return false;
    if (productType && product.type !== productType) return false;
    if (!search) return true;
    return [product.name, product.productLine, product.sku, product.supplierName].filter(Boolean).join(' ').toLowerCase().includes(search);
  }), [products, productType, query, supplierId]);
  const filteredColors = useMemo(() => colors.filter((color) => {
    const search = query.trim().toLowerCase();
    if (supplierId && color.supplierId !== supplierId) return false;
    if (colorFamily && color.family !== colorFamily) return false;
    if (popularOnly && !color.isPopular) return false;
    if (!search) return true;
    return [color.name, color.colorCode, color.collection, color.family, color.supplierName].filter(Boolean).join(' ').toLowerCase().includes(search);
  }), [colors, colorFamily, popularOnly, query, supplierId]);

  async function loadCatalog() {
    setIsLoading(true);
    setError(null);
    try {
      const [productsRes, colorsRes, statusRes] = await Promise.all([
        apiJson<{ data?: CatalogProduct[] }>('/v1/supplier-catalog/products?limit=100'),
        apiJson<{ data?: CatalogColor[] }>('/v1/supplier-catalog/colors?limit=160'),
        apiJson<{ data?: CatalogStatus }>('/v1/supplier-catalog/status'),
      ]);
      const nextProducts = productsRes.data || [];
      const nextColors = colorsRes.data || [];
      setProducts(nextProducts);
      setColors(nextColors);
      setStatus(statusRes.data || null);
      setSelectedProduct(nextProducts[0] || null);
      setSelectedColor(nextColors[0] || null);
    } catch (err) {
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }

  async function loadProductColors(productId: string) {
    setCompatLoading(true);
    try {
      const payload = await apiJson<{ data?: ProductColorCompatibility[] }>(`/v1/supplier-catalog/products/${productId}/colors`);
      setProductColors(payload.data || []);
    } catch {
      setProductColors([]);
    } finally {
      setCompatLoading(false);
    }
  }

  async function loadColorProducts(colorId: string) {
    setCompatLoading(true);
    try {
      const payload = await apiJson<{ data?: ColorProductCompatibility[] }>(`/v1/supplier-catalog/colors/${colorId}/products`);
      setColorProducts(payload.data || []);
    } catch {
      setColorProducts([]);
    } finally {
      setCompatLoading(false);
    }
  }

  function clearFilters() {
    setQuery('');
    setSupplierId('');
    setProductType('');
    setColorFamily('');
    setPopularOnly(false);
  }

  if (error) {
    return (
      <section className="mx-auto max-w-6xl space-y-5 pb-24">
        <ServiceErrorState error={error} pageName="Supplier catalog" title="Supplier catalog is unavailable" onRetry={loadCatalog} compact />
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-6xl space-y-5 pb-24">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="pf-page-copy max-w-3xl">
          Browse scraped supplier products, color libraries, and product-color availability before adding products to your estimating setup.
        </p>
        <Button variant="secondary" size="sm" onClick={loadCatalog}>
          <Icon name="refresh" className="pf-icon" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Products" value={status?.counts?.productCount ?? products.length} />
        <Metric label="Colors" value={status?.counts?.colorCount ?? colors.length} />
        <Metric label="Last sync" value={dateLabel(status?.latestRun?.finishedAt || status?.latestRun?.startedAt)} help={status?.latestRun?.status ? labelize(status.latestRun.status) : 'No sync run yet'} />
      </div>

      <Card padding="none">
        <div className="border-b p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex rounded-full bg-gray-100 p-1">
              <button type="button" className={`btn-segment ${tab === 'products' ? 'is-active' : ''}`} onClick={() => setTab('products')}>Products</button>
              <button type="button" className={`btn-segment ${tab === 'colors' ? 'is-active' : ''}`} onClick={() => setTab('colors')}>Colors</button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[16rem_12rem_12rem_auto]">
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === 'products' ? 'Search product, line, SKU' : 'Search color, code, family'} />
              <Select value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                <option value="">All suppliers</option>
                {suppliers.map((supplier) => <option key={supplier.value} value={supplier.value}>{supplier.label}</option>)}
              </Select>
              {tab === 'products' ? (
                <Select value={productType} onChange={(event) => setProductType(event.target.value)} options={productTypeOptions} />
              ) : (
                <Select value={colorFamily} onChange={(event) => setColorFamily(event.target.value)}>
                  <option value="">All color families</option>
                  {families.map((family) => <option key={family.value} value={family.value}>{family.label}</option>)}
                </Select>
              )}
              <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button>
            </div>
          </div>
          {tab === 'colors' && (
            <label className="pf-inline-option mt-3">
              <input type="checkbox" checked={popularOnly} onChange={(event) => setPopularOnly(event.target.checked)} />
              Popular colors only
            </label>
          )}
        </div>

        <div className="grid min-h-[34rem] lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="min-w-0 border-b lg:border-b-0 lg:border-r">
            {isLoading ? (
              <ProductSkeleton />
            ) : tab === 'products' ? (
              filteredProducts.length ? (
                <div className="divide-y divide-gray-200">
                  {filteredProducts.map((product) => (
                    <ProductRow key={product.id} product={product} selected={selectedProduct?.id === product.id} onSelect={() => setSelectedProduct(product)} />
                  ))}
                </div>
              ) : (
                <EmptyCatalogState title="No products match these filters." />
              )
            ) : filteredColors.length ? (
              <div className="grid gap-0 divide-y divide-gray-200 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-1 lg:divide-x-0 lg:divide-y">
                {filteredColors.map((color) => (
                  <ColorRow key={color.id} color={color} selected={selectedColor?.id === color.id} onSelect={() => setSelectedColor(color)} />
                ))}
              </div>
            ) : (
              <EmptyCatalogState title="No colors match these filters." />
            )}
          </div>

          <aside className="min-w-0 bg-gray-50/80 p-4">
            {tab === 'products' ? (
              <ProductDetail product={selectedProduct} colors={productColors} loading={compatLoading} />
            ) : (
              <ColorDetail color={selectedColor} products={colorProducts} loading={compatLoading} />
            )}
          </aside>
        </div>
      </Card>
    </section>
  );
}

function Metric({ label, value, help }: { label: string; value: unknown; help?: string }) {
  return (
    <Card padding="sm">
      <p className="pf-label-small">{label}</p>
      <p className="pf-metric mt-1">{typeof value === 'number' ? value.toLocaleString() : String(value || '0')}</p>
      {help && <p className="pf-meta mt-1">{help}</p>}
    </Card>
  );
}

function ProductRow({ product, selected, onSelect }: { product: CatalogProduct; selected: boolean; onSelect: () => void }) {
  const price = cents(product.priceCents);
  const sheens = arrayValue(product.sheens);
  return (
    <button type="button" className={`block w-full p-4 text-left transition hover:bg-blue-50/50 ${selected ? 'bg-blue-50' : 'bg-white'}`} onClick={onSelect}>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="pf-row-title truncate">{productName(product)}</p>
          <p className="pf-copy mt-1">{[product.supplierName, labelize(product.type || ''), product.category ? labelize(product.category) : ''].filter(Boolean).join(' - ')}</p>
          <p className="pf-meta mt-1">{[product.sku ? `SKU ${product.sku}` : '', product.size, coverageLabel(product)].filter(Boolean).join(' - ')}</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1 sm:justify-end">
          {price != null && <Badge variant="info" size="sm">{formatMoney(price)}</Badge>}
          {sheens.slice(0, 3).map((sheen) => <Badge key={sheen} size="sm">{labelize(sheen)}</Badge>)}
        </div>
      </div>
    </button>
  );
}

function ColorRow({ color, selected, onSelect }: { color: CatalogColor; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" className={`flex w-full gap-3 p-4 text-left transition hover:bg-blue-50/50 ${selected ? 'bg-blue-50' : 'bg-white'}`} onClick={onSelect}>
      <ColorSwatch color={color} />
      <div className="min-w-0">
        <p className="pf-row-title truncate">{colorLabel(color)}</p>
        <p className="pf-copy mt-1">{[color.supplierName, color.family ? labelize(color.family) : '', color.collection].filter(Boolean).join(' - ')}</p>
        <p className="pf-meta mt-1">{color.lrv != null ? `LRV ${color.lrv}` : 'LRV not listed'}{color.isPopular ? ' - Popular' : ''}</p>
      </div>
    </button>
  );
}

function ColorSwatch({ color }: { color: CatalogColor }) {
  const fallback = color.hexCode || (color.rgbR != null && color.rgbG != null && color.rgbB != null ? `rgb(${color.rgbR}, ${color.rgbG}, ${color.rgbB})` : '#f3f4f6');
  return <span className="mt-0.5 h-10 w-10 shrink-0 rounded-full border border-gray-300 shadow-sm" style={{ backgroundColor: fallback }} />;
}

function ProductDetail({ product, colors, loading }: { product: CatalogProduct | null; colors: ProductColorCompatibility[]; loading: boolean }) {
  if (!product) return <EmptyCatalogState title="Select a product to see compatible colors." compact />;
  const price = cents(product.priceCents);
  return (
    <div className="space-y-4">
      <div>
        <p className="pf-label-small">{product.supplierName || product.supplierId}</p>
        <h2 className="pf-section-title mt-1">{productName(product)}</h2>
        <p className="pf-copy mt-1">{product.description || 'No product description captured yet.'}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Signal label="Type" value={labelize(product.type || 'Product')} />
        <Signal label="Price" value={price == null ? 'Not captured' : formatMoney(price)} />
        <Signal label="Coverage" value={coverageLabel(product)} />
        <Signal label="Tier" value={labelize(product.pricingTier || 'Retail')} />
      </div>
      <CompatibilitySection title="Compatible colors" loading={loading} empty="No product-color mappings captured yet.">
        {colors.map((item) => (
          <div key={item.mappingId} className="flex gap-3 rounded-lg border bg-white p-3">
            <ColorSwatch color={item.color} />
            <div className="min-w-0">
              <p className="pf-row-title truncate">{colorLabel(item.color)}</p>
              <p className="pf-meta">{[item.color.family ? labelize(item.color.family) : '', item.baseRequired ? `Base: ${item.baseRequired}` : '', compatibilityUse(item.recommendedUse)].filter(Boolean).join(' - ')}</p>
            </div>
          </div>
        ))}
      </CompatibilitySection>
    </div>
  );
}

function ColorDetail({ color, products, loading }: { color: CatalogColor | null; products: ColorProductCompatibility[]; loading: boolean }) {
  if (!color) return <EmptyCatalogState title="Select a color to see compatible products." compact />;
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <ColorSwatch color={color} />
        <div className="min-w-0">
          <p className="pf-label-small">{color.supplierName || color.supplierId}</p>
          <h2 className="pf-section-title mt-1">{colorLabel(color)}</h2>
          <p className="pf-copy mt-1">{[color.family ? labelize(color.family) : '', color.collection].filter(Boolean).join(' - ') || 'No color family captured yet.'}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Signal label="Hex" value={color.hexCode || 'Not captured'} />
        <Signal label="LRV" value={color.lrv == null ? 'Not listed' : color.lrv} />
        <Signal label="Code" value={color.colorCode || 'Not listed'} />
        <Signal label="Popularity" value={color.isPopular ? 'Popular' : 'Standard'} />
      </div>
      <CompatibilitySection title="Available products" loading={loading} empty="No compatible product mappings captured yet.">
        {products.map((item) => (
          <div key={item.mappingId} className="rounded-lg border bg-white p-3">
            <p className="pf-row-title truncate">{productName(item.product)}</p>
            <p className="pf-meta">{[item.product.supplierName, labelize(item.product.type || ''), item.baseRequired ? `Base: ${item.baseRequired}` : '', compatibilityUse(item.recommendedUse)].filter(Boolean).join(' - ')}</p>
          </div>
        ))}
      </CompatibilitySection>
    </div>
  );
}

function Signal({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <p className="pf-label-small">{label}</p>
      <p className="pf-value mt-1">{String(value)}</p>
    </div>
  );
}

function CompatibilitySection({ title, loading, empty, children }: { title: string; loading: boolean; empty: string; children: ReactNode }) {
  const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div>
      <CardHeader className="mb-2" title={title} />
      {loading ? (
        <div className="space-y-2">
          <div className="h-16 animate-pulse rounded-lg bg-gray-200" />
          <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
        </div>
      ) : hasItems ? (
        <div className="space-y-2">{children}</div>
      ) : (
        <p className="pf-supporting rounded-lg border border-dashed bg-white p-3">{empty}</p>
      )}
    </div>
  );
}

function EmptyCatalogState({ title, compact = false }: { title: string; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'min-h-40 p-4' : 'min-h-80 p-6'}`}>
      <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-gray-600">
        <Icon name="paint-bucket" className="h-5 w-5" />
      </span>
      <p className="pf-row-title mt-3">{title}</p>
      <p className="pf-copy mt-1 max-w-sm">Run the supplier catalog sync to hydrate products, colors, and availability mappings.</p>
    </div>
  );
}
