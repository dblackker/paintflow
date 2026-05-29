import { PointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { StatusBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Modal, ModalFooter } from '@/components/Modal';
import { Toast } from '@/components/Toast';
import { API_URL, formatMoney, labelize } from '@/lib/api';
import { PAYMENT_UNAVAILABLE_TOAST, paymentErrorMessage } from '@/lib/paymentMessages';

type EstimateStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'canceled' | 'superseded' | 'voided' | string;

interface EstimateLineItem {
  desc?: string;
  qty?: number | string;
  rate?: number | string;
  category?: string;
  kind?: string;
  customerVisible?: boolean;
  optional?: boolean;
  roomName?: string;
  surfaceName?: string;
  notes?: string;
  labor?: {
    coats?: number | string;
    prepLevel?: string;
    applicationMethod?: string;
    ceilingColorSeparation?: string;
    ceilingColorSeparationHours?: number | string;
  };
  material?: {
    name?: string;
    brand?: string;
    supplier?: string;
    colorName?: string;
    colorCode?: string;
    status?: string;
    customerSelection?: {
      catalogColorId?: string | null;
      supplierId?: string | null;
      supplierName?: string | null;
      notes?: string | null;
      selectedAt?: string | null;
    } | null;
  };
}

interface EstimatePackage {
  name?: string;
  subtotal?: number | string;
  discount?: number | string;
  tax?: number | string;
  total?: number | string;
  items?: EstimateLineItem[];
  lineItems?: EstimateLineItem[];
}

interface PaymentScheduleItem {
  key?: string;
  label: string;
  due?: string;
  percent?: number | string;
  amount?: number | string;
  paidAmount?: number | string;
  status?: string;
  payable?: boolean;
}

interface LegalSettings {
  jurisdiction?: string;
  contractorRegistrationNumber?: string;
  bondAmount?: string;
  contractTerms?: string;
  disclosureEnabled?: boolean;
  disclosureRequired?: boolean;
  disclosureTitle?: string;
  disclosureText?: string;
}

interface EstimatePhoto {
  id?: string;
  url?: string;
  thumbnailUrl?: string;
  caption?: string;
  createdAt?: string;
}

interface PublicEstimate {
  id: string;
  status: EstimateStatus;
  packages?: EstimatePackage[];
  total?: number | string;
  createdAt?: string;
  updatedAt?: string;
  sentAt?: string;
  signedName?: string;
  signedAt?: string;
  contractorSignature?: {
    name?: string | null;
    email?: string | null;
    title?: string | null;
    companyName?: string | null;
    signedAt?: string | null;
    capacity?: string | null;
  } | null;
  paymentSummary?: {
    paidAmount?: number | string;
    paymentCount?: number;
    balanceDue?: number | string;
  };
  paymentSchedule?: PaymentScheduleItem[];
  paymentTerms?: string;
  legal?: LegalSettings;
  photos?: EstimatePhoto[];
  branding?: {
    logoUrl?: string | null;
    primaryColor?: string | null;
    companyName?: string | null;
  } | null;
}

interface SelectedOption {
  desc?: string;
  qty: number;
  rate: number;
  category?: string;
}

interface ScopeGroup {
  name: string;
  area: string;
  items: Array<{ item: EstimateLineItem; parts: ScopeParts }>;
}

interface ScopeParts {
  area: string;
  space: string;
  surface: string;
  label: string;
}

interface CatalogColor {
  id: string;
  supplierId: string;
  supplierName?: string | null;
  name: string;
  colorCode?: string | null;
  hexCode?: string | null;
  family?: string | null;
  collection?: string | null;
  lrv?: number | string | null;
}

interface ColorDraft {
  colorName: string;
  colorCode: string;
  supplierId?: string;
  supplierName?: string;
  catalogColorId?: string;
  notes?: string;
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value: unknown) {
  return formatMoney(num(value));
}

function packageItems(pkg?: EstimatePackage | null) {
  return Array.isArray(pkg?.items) ? pkg.items : Array.isArray(pkg?.lineItems) ? pkg.lineItems : [];
}

function textParagraphs(value?: string) {
  return String(value || '')
    .split(/\n{2,}|\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function applicationLabel(value?: string) {
  const labels: Record<string, string> = {
    brush_roll: 'Brush & roll',
    spray_backroll: 'Spray & back-roll',
    spray_only: 'Spray only',
  };
  return labels[String(value || '')] || labelize(value || '');
}

function ceilingColorMode(item: EstimateLineItem) {
  return String(item.labor?.ceilingColorSeparation || '').toLowerCase();
}

function titleCaseScope(value?: string) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(\s+|,|\/|-)/)
    .map((part) => (/^[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join('')
    .replace(/\bAnd\b/g, 'and');
}

function cleanScopeLabel(value?: string) {
  return String(value || '')
    .replace(/\s*,?\s*(spray\s*(and|&|-|\/)\s*back-?roll|spray\/back-?roll|brush\s*(and|&)\s*roll|spray only)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function scopeParts(item: EstimateLineItem): ScopeParts {
  const [area = 'Project', rawLabel = item.desc || 'Scope item'] = String(item.desc || '').split(/:\s(.+)/);
  const label = cleanScopeLabel(rawLabel || area);
  const surfaceMatch = label.match(/^(.*)\s+(walls?|ceilings?|trim|doors?|cabinets?|siding|soffits?|fascia|corner boards?)$/i);
  const surface = item.surfaceName || (surfaceMatch ? surfaceMatch[2].trim() : label.trim());
  const normalizedArea = item.roomName || area.trim() || 'Project';
  return {
    area: normalizedArea,
    space: normalizedArea || surfaceMatch?.[1]?.trim() || 'Project',
    surface: titleCaseScope(surface).replace(/^(Interior|Exterior)\s+/i, ''),
    label: titleCaseScope(label).replace(/^(Interior|Exterior)\s+/i, ''),
  };
}

function surfaceRole(item: EstimateLineItem) {
  const parts = scopeParts(item);
  const text = `${parts.surface} ${parts.label} ${item.surfaceName || ''} ${item.category || ''}`.toLowerCase();
  if (/ceil/.test(text)) return 'ceilings';
  if (/wall/.test(text)) return 'walls';
  if (/trim|baseboard|casing|crown|corner/.test(text)) return 'trim';
  if (/door/.test(text)) return 'doors';
  if (/soffit|eave/.test(text)) return 'soffits';
  if (/fascia/.test(text)) return 'fascia';
  if (/siding|body/.test(text)) return 'siding';
  return text.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'surface';
}

function ceilingColorRuleLabel(item: EstimateLineItem) {
  if (surfaceRole(item) !== 'ceilings') return '';
  const mode = ceilingColorMode(item);
  if (/separate|different/.test(mode)) return 'Different ceiling color included';
  if (/same/.test(mode)) return 'Same color as walls';
  return 'Ceiling color selected separately';
}

function groupScopeBySpace(items: EstimateLineItem[]): ScopeGroup[] {
  const groups = new Map<string, ScopeGroup>();
  items.forEach((item) => {
    const parts = scopeParts(item);
    const key = parts.space || parts.area;
    if (!groups.has(key)) groups.set(key, { name: key, area: parts.area, items: [] });
    groups.get(key)!.items.push({ item, parts });
  });
  return Array.from(groups.values());
}

function itemMaterial(item: EstimateLineItem) {
  if (!item.material?.name) return 'Paint: TBD';
  const product = [item.material.brand, item.material.name].filter(Boolean).join(' ');
  const color = [item.material.colorName, item.material.colorCode].filter(Boolean).join(' ');
  return `Paint: ${product}${color ? `, ${color}` : ''}`;
}

function customerScopeDetail(item: EstimateLineItem) {
  if (item.kind === 'line_item') return item.notes || 'Additional project item';
  const parts = [
    item.labor?.coats ? `${num(item.labor.coats)} coat${num(item.labor.coats) === 1 ? '' : 's'}` : '',
    item.labor?.prepLevel ? `${labelize(item.labor.prepLevel)} prep` : '',
    item.labor?.applicationMethod ? applicationLabel(item.labor.applicationMethod) : '',
    ceilingColorRuleLabel(item),
  ].filter(Boolean);
  return parts.join(' | ') || 'Included in project scope';
}

function productSummary(items: EstimateLineItem[]) {
  const products = new Map<string, { product: string; color: string; spaces: Set<string> }>();
  items.forEach((item) => {
    if (!item.material?.name) return;
    const product = [item.material.brand, item.material.name].filter(Boolean).join(' ');
    const color = [item.material.colorName, item.material.colorCode].filter(Boolean).join(' ') || 'Color TBD';
    const key = `${product}|${color}`;
    if (!products.has(key)) products.set(key, { product, color, spaces: new Set() });
    products.get(key)!.spaces.add(scopeParts(item).space);
  });
  return Array.from(products.values()).map((product) => ({
    ...product,
    spaces: Array.from(product.spaces).filter(Boolean),
  }));
}

function pricingBreakdown(pkg: EstimatePackage, selectedOptions: SelectedOption[]) {
  const baseTotal = num(pkg.total);
  const discount = num(pkg.discount);
  const baseTax = num(pkg.tax);
  const rawSubtotal = num(pkg.subtotal);
  const baseSubtotal = rawSubtotal > 0 && Math.abs((rawSubtotal - discount + baseTax) - baseTotal) < 0.02
    ? rawSubtotal
    : Math.max(baseTotal - baseTax + discount, 0);
  const taxableBase = Math.max(baseSubtotal - discount, 0);
  const taxRate = taxableBase > 0 ? baseTax / taxableBase : 0;
  const options = selectedOptions.reduce((sum, item) => sum + item.qty * item.rate, 0);
  const optionTax = Math.round(options * taxRate * 100) / 100;
  const totalTax = baseTax + optionTax;
  return {
    baseSubtotal,
    discount,
    baseTax,
    taxRate,
    options,
    optionTax,
    totalTax,
    baseTotal,
    total: baseTotal + options + optionTax,
  };
}

function nextDuePayment(schedule: PaymentScheduleItem[]) {
  return schedule.find((item) => item.payable && item.status !== 'paid' && num(item.amount) > num(item.paidAmount)) || null;
}

function adjustedPaymentSchedule(estimate: PublicEstimate, total: number) {
  const schedule = Array.isArray(estimate.paymentSchedule) ? estimate.paymentSchedule : [];
  let remainingPaid = num(estimate.paymentSummary?.paidAmount);
  return schedule.map((item, index) => {
    const amount = Math.round(total * (num(item.percent) / 100) * 100) / 100;
    const paidAmount = Math.min(remainingPaid, amount);
    remainingPaid = Math.max(remainingPaid - paidAmount, 0);
    return {
      ...item,
      amount,
      paidAmount,
      status: paidAmount >= amount - 0.01 ? 'paid' : index === 0 || item.payable ? 'due' : 'upcoming',
    };
  });
}

function selectedOptionsFromIndexes(pkg: EstimatePackage | null, indexes: Set<number>): SelectedOption[] {
  if (!pkg) return [];
  return packageItems(pkg)
    .filter((item) => item.optional && item.customerVisible !== false)
    .filter((_, index) => indexes.has(index))
    .map((item) => ({
      desc: item.desc,
      qty: num(item.qty, 1),
      rate: num(item.rate),
      category: item.category || 'option',
    }));
}

function colorOptionLabel(color: CatalogColor) {
  return [color.name, color.colorCode ? `(${color.colorCode})` : ''].filter(Boolean).join(' ') || 'Paint color';
}

function colorDraftFromItem(item: EstimateLineItem): ColorDraft {
  return {
    colorName: item.material?.colorName || '',
    colorCode: item.material?.colorCode || '',
    supplierId: item.material?.customerSelection?.supplierId || undefined,
    supplierName: item.material?.customerSelection?.supplierName || item.material?.supplier || item.material?.brand || undefined,
    catalogColorId: item.material?.customerSelection?.catalogColorId || undefined,
    notes: item.material?.customerSelection?.notes || '',
  };
}

function materialProductLabel(item: EstimateLineItem) {
  return [item.material?.brand, item.material?.name].filter(Boolean).join(' ') || 'Selected paint product';
}

function colorGroupKey(item: EstimateLineItem) {
  const role = surfaceRole(item);
  const mode = ceilingColorMode(item);
  const pricingRole = role === 'ceilings' && /same/.test(mode) ? 'walls' : role;
  return [
    item.material?.brand || '',
    item.material?.name || '',
    item.material?.supplier || '',
    pricingRole,
  ].join('|').toLowerCase() || 'selected-paint-product';
}

function useBodyTitle(title?: string | null) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

export function EstimateDetail() {
  const { id } = useParams<{ id: string }>();
  const isSuccessReturn = window.location.pathname.endsWith('/success');
  const [estimate, setEstimate] = useState<PublicEstimate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedOptionIndexes, setSelectedOptionIndexes] = useState<Set<number>>(new Set());
  const [showTerms, setShowTerms] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [acknowledgedDisclosure, setAcknowledgedDisclosure] = useState(false);
  const [colorDrafts, setColorDrafts] = useState<Record<number, ColorDraft>>({});
  const [colorSuggestions, setColorSuggestions] = useState<CatalogColor[]>([]);
  const [colorQuery, setColorQuery] = useState('');
  const [useGroupedColors, setUseGroupedColors] = useState(false);
  const [isSavingColors, setIsSavingColors] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [hasSignature, setHasSignature] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [isPaying, setIsPaying] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(
    isSuccessReturn ? { tone: 'success', text: 'Payment complete. Your contractor has been notified.' } : null,
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  const primaryColor = estimate?.branding?.primaryColor || '#2563eb';
  const brandTitle = estimate?.branding?.companyName ? `${estimate.branding.companyName} - Estimate` : 'Estimate - PaintFlow';
  useBodyTitle(brandTitle);

  useEffect(() => {
    loadEstimate();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const handle = window.setTimeout(async () => {
      try {
        const query = colorQuery.trim();
        const response = await fetch(`${API_URL}/v1/estimates/${id}/color-options${query ? `?q=${encodeURIComponent(query)}` : ''}`, { credentials: 'include' });
        if (!response.ok) return;
        const payload = await response.json() as { data?: CatalogColor[] };
        setColorSuggestions(payload.data || []);
      } catch {
        setColorSuggestions([]);
      }
    }, colorQuery.trim() ? 180 : 0);
    return () => window.clearTimeout(handle);
  }, [colorQuery, id]);

  useEffect(() => {
    if (!showSignature) return;
    const frame = window.requestAnimationFrame(resizeCanvas);
    return () => window.cancelAnimationFrame(frame);
  }, [showSignature]);

  async function loadEstimate() {
    if (!id) return;
    setIsLoading(true);
    setLoadError('');
    try {
      const response = await fetch(`${API_URL}/v1/estimates/${id}/public`, { credentials: 'include' });
      if (!response.ok) {
        setLoadError('Estimate not found or expired.');
        return;
      }
      const payload = await response.json() as { data?: PublicEstimate };
      if (!payload.data) {
        setLoadError('Estimate not found or expired.');
        return;
      }
      setEstimate(payload.data);
      setSelectedOptionIndexes(new Set());
      setShowTerms(false);
      setShowSignature(false);
      setAcknowledgedDisclosure(false);
    } catch {
      setLoadError('Estimate not found or expired.');
    } finally {
      setIsLoading(false);
    }
  }

  const selectedPackage = useMemo(() => {
    const packages = estimate?.packages || [];
    return packages.find((pkg) => pkg.name === 'proposal')
      || packages.find((pkg) => /better|recommended/i.test(pkg.name || ''))
      || packages[0]
      || null;
  }, [estimate]);

  const packageEntries = useMemo(
    () => packageItems(selectedPackage).map((item, index) => ({ item, index })),
    [selectedPackage],
  );
  const visibleEntries = useMemo(
    () => packageEntries.filter(({ item }) => item.customerVisible !== false),
    [packageEntries],
  );
  const visibleItems = visibleEntries.map(({ item }) => item);
  const baseItems = visibleItems.filter((item) => !item.optional);
  const optionalItems = visibleItems.filter((item) => item.optional);
  const colorTargets = visibleEntries.filter(({ item }) => !item.optional && Boolean(item.material?.name));
  const selectedOptions = useMemo(
    () => selectedOptionsFromIndexes(selectedPackage, selectedOptionIndexes),
    [selectedPackage, selectedOptionIndexes],
  );
  const breakdown = selectedPackage ? pricingBreakdown(selectedPackage, selectedOptions) : null;
  const paymentSchedule = estimate && breakdown ? adjustedPaymentSchedule(estimate, breakdown.total).filter((item) => num(item.percent) > 0) : [];
  const nextPayment = nextDuePayment(paymentSchedule);
  const products = productSummary(baseItems);
  const scopeGroups = groupScopeBySpace(baseItems);
  const legal = estimate?.legal || {};
  const photos = estimate?.photos || [];
  const colorDraftTargetKey = colorTargets.map(({ index, item }) => `${index}:${item.material?.colorName || ''}:${item.material?.colorCode || ''}`).join('|');
  const allColorTargetsSelected = colorTargets.length > 0 && colorTargets.every(({ index }) => colorDrafts[index]?.colorName?.trim());
  const colorGroups = useMemo(() => {
    const groups = new Map<string, {
      key: string;
      product: string;
      indexes: number[];
      targets: Array<{ item: EstimateLineItem; index: number; parts: ScopeParts }>;
    }>();
    colorTargets.forEach(({ item, index }) => {
      const key = colorGroupKey(item);
      if (!groups.has(key)) {
        groups.set(key, { key, product: materialProductLabel(item), indexes: [], targets: [] });
      }
      const group = groups.get(key)!;
      group.indexes.push(index);
      group.targets.push({ item, index, parts: scopeParts(item) });
    });
    return Array.from(groups.values());
  }, [colorTargets]);

  useEffect(() => {
    setColorDrafts((current) => {
      const next = { ...current };
      colorTargets.forEach(({ index, item }) => {
        if (!next[index]) next[index] = colorDraftFromItem(item);
      });
      Object.keys(next).forEach((key) => {
        if (!colorTargets.some(({ index }) => String(index) === key)) delete next[Number(key)];
      });
      return next;
    });
  }, [colorDraftTargetKey]);

  function inactiveMessage(status: EstimateStatus) {
    if (status === 'canceled') {
      return {
        title: 'This estimate has been canceled.',
        copy: 'Please contact your contractor if you have questions or need a revised proposal.',
        tone: 'red',
      };
    }
    if (status === 'voided') {
      return {
        title: 'This agreement has been voided.',
        copy: 'The signed copy is preserved in the contractor record, but this agreement is no longer active. Please contact your contractor for next steps.',
        tone: 'red',
      };
    }
    if (status === 'superseded') {
      return {
        title: 'This agreement has been superseded.',
        copy: 'A revised agreement replaced this signed copy. Please use the latest proposal link from your contractor.',
        tone: 'amber',
      };
    }
    return null;
  }

  function toggleOption(index: number) {
    setSelectedOptionIndexes((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function updateColorDraft(itemIndex: number, patch: Partial<ColorDraft>) {
    setColorDrafts((current) => ({
      ...current,
      [itemIndex]: {
        ...(current[itemIndex] || { colorName: '', colorCode: '' }),
        ...patch,
      },
    }));
  }

  function updateColorDrafts(itemIndexes: number[], patch: Partial<ColorDraft>) {
    setColorDrafts((current) => {
      const next = { ...current };
      itemIndexes.forEach((itemIndex) => {
        next[itemIndex] = {
          ...(next[itemIndex] || { colorName: '', colorCode: '' }),
          ...patch,
        };
      });
      return next;
    });
  }

  function applySuggestedColor(itemIndex: number, value: string) {
    const suggestion = colorSuggestions.find((color) => colorOptionLabel(color) === value || color.name === value || color.colorCode === value);
    if (!suggestion) {
      updateColorDraft(itemIndex, { colorName: value, catalogColorId: undefined });
      setColorQuery(value);
      return;
    }
    updateColorDraft(itemIndex, {
      colorName: suggestion.name,
      colorCode: suggestion.colorCode || '',
      supplierId: suggestion.supplierId,
      supplierName: suggestion.supplierName || suggestion.supplierId,
      catalogColorId: suggestion.id,
    });
    setColorQuery(suggestion.name);
  }

  function applySuggestedColorToIndexes(itemIndexes: number[], value: string) {
    const suggestion = colorSuggestions.find((color) => colorOptionLabel(color) === value || color.name === value || color.colorCode === value);
    if (!suggestion) {
      updateColorDrafts(itemIndexes, { colorName: value, catalogColorId: undefined });
      setColorQuery(value);
      return;
    }
    updateColorDrafts(itemIndexes, {
      colorName: suggestion.name,
      colorCode: suggestion.colorCode || '',
      supplierId: suggestion.supplierId,
      supplierName: suggestion.supplierName || suggestion.supplierId,
      catalogColorId: suggestion.id,
    });
    setColorQuery(suggestion.name);
  }

  function toggleGroupedColors(checked: boolean) {
    setUseGroupedColors(checked);
    if (!checked) return;
    setColorDrafts((current) => {
      const next = { ...current };
      colorGroups.forEach((group) => {
        const sourceIndex = group.indexes.find((index) => current[index]?.colorName?.trim()) ?? group.indexes[0];
        const source = current[sourceIndex] || colorDraftFromItem(group.targets[0]?.item);
        group.indexes.forEach((index) => {
          next[index] = { ...(next[index] || { colorName: '', colorCode: '' }), ...source };
        });
      });
      return next;
    });
  }

  async function submitColorSelections() {
    if (!id || !selectedPackage || !allColorTargetsSelected) return;
    setIsSavingColors(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_URL}/v1/estimates/${id}/color-selections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          packageName: selectedPackage.name || 'proposal',
          selections: colorTargets.map(({ index }) => ({
            itemIndex: index,
            colorName: colorDrafts[index]?.colorName || '',
            colorCode: colorDrafts[index]?.colorCode || '',
            supplierId: colorDrafts[index]?.supplierId || '',
            supplierName: colorDrafts[index]?.supplierName || '',
            catalogColorId: colorDrafts[index]?.catalogColorId || undefined,
            notes: colorDrafts[index]?.notes || '',
          })),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Unable to save color selections');
      setMessage({ tone: 'success', text: 'Color selections sent to your contractor.' });
      await loadEstimate();
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to save color selections.' });
    } finally {
      setIsSavingColors(false);
    }
  }

  function openTerms() {
    if (!estimate?.contractorSignature?.signedAt) {
      setMessage({ tone: 'error', text: 'Contractor signature is pending. Ask the contractor to countersign this proposal before signing.' });
      return;
    }
    setMessage(null);
    setAcknowledgedDisclosure(false);
    setShowTerms(true);
  }

  function acceptTerms() {
    if (legal.disclosureEnabled && legal.disclosureRequired && !acknowledgedDisclosure) {
      setMessage({ tone: 'error', text: 'Please acknowledge the required disclosure before signing.' });
      return;
    }
    setShowTerms(false);
    setShowSignature(true);
  }

  function resizeCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, rect.width * ratio);
    canvas.height = 144 * ratio;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.lineWidth = 2;
    context.lineCap = 'round';
    context.strokeStyle = '#111827';
    setHasSignature(false);
  }

  function pointerPosition(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const point = pointerPosition(event);
    drawingRef.current = true;
    context.beginPath();
    context.moveTo(point.x, point.y);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    const point = pointerPosition(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    setHasSignature(true);
  }

  function stopDrawing() {
    drawingRef.current = false;
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  }

  async function submitSignature() {
    if (!id || !selectedPackage) return;
    const name = signerName.trim();
    if (!name) {
      setMessage({ tone: 'error', text: 'Please enter your full name.' });
      return;
    }
    if (!hasSignature || !canvasRef.current) {
      setMessage({ tone: 'error', text: 'Please add your signature.' });
      return;
    }
    setIsSigning(true);
    setMessage(null);
    try {
      const response = await fetch(`${API_URL}/v1/estimates/${id}/sign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          name,
          signatureData: canvasRef.current.toDataURL(),
          packageName: selectedPackage.name || 'proposal',
          selectedOptions,
          acknowledgedDisclosure,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Failed to sign estimate');
      setShowSignature(false);
      setMessage({ tone: 'success', text: 'Proposal signed. Any payment due is shown below.' });
      setEstimate((current) => current ? {
        ...current,
        signedName: name,
        signedAt: payload.data?.signedAt || new Date().toISOString(),
      } : current);
    } catch (error) {
      setMessage({ tone: 'error', text: error instanceof Error ? error.message : 'Failed to process signature.' });
    } finally {
      setIsSigning(false);
    }
  }

  async function startCheckout(milestoneKey?: string) {
    if (!id || !selectedPackage) return;
    setIsPaying(milestoneKey || 'next');
    setMessage(null);
    try {
      const response = await fetch(`${API_URL}/v1/payments/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          estimateId: id,
          packageName: selectedPackage.name || 'proposal',
          selectedOptions,
          milestoneKey,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 409) {
        throw new Error(PAYMENT_UNAVAILABLE_TOAST);
      }
      if (!response.ok || !payload.checkoutUrl) throw new Error(payload.error || 'Failed to create payment checkout');
      window.location.href = payload.checkoutUrl;
    } catch (error) {
      const text = paymentErrorMessage(error, 'Failed to start payment.');
      window.showToast?.(text, 'error');
      setIsPaying('');
    }
  }

  if (isLoading) {
    return (
      <>
        <Toast />
        <main className="min-h-screen bg-gray-50 px-3 py-4 sm:px-6 sm:py-10">
          <div className="mx-auto max-w-5xl rounded-lg border bg-white p-8 text-center">
            <div className="mx-auto h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
            <p className="mt-4 text-gray-600">Loading estimate...</p>
          </div>
        </main>
      </>
    );
  }

  if (loadError || !estimate || !selectedPackage || !visibleItems.length) {
    return (
      <>
        <Toast />
        <main className="min-h-screen bg-gray-50 px-3 py-4 sm:px-6 sm:py-10">
          <section className="mx-auto max-w-3xl rounded-lg border bg-white p-8 text-center">
            <p className="font-medium text-red-700">{loadError || 'Estimate not found or expired.'}</p>
          </section>
        </main>
      </>
    );
  }

  const inactive = inactiveMessage(estimate.status);
  if (inactive) {
    return (
      <>
        <Toast />
        <main className="min-h-screen bg-gray-50 px-3 py-4 sm:px-6 sm:py-10">
          <section className={`mx-auto max-w-3xl rounded-lg border bg-white p-8 ${inactive.tone === 'amber' ? 'border-amber-200' : 'border-red-200'}`}>
            <StatusBadge status={estimate.status} />
            <p className={`mt-4 font-semibold ${inactive.tone === 'amber' ? 'text-amber-800' : 'text-red-700'}`}>{inactive.title}</p>
            <p className="mt-2 text-sm text-gray-600">{inactive.copy}</p>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
    <Toast />
    <main className="min-h-screen bg-gray-50 px-3 py-4 sm:px-6 sm:py-10">
      <section className="mx-auto max-w-5xl space-y-5">
        {message && (
          <div className={`rounded-lg border p-3 text-sm ${
            message.tone === 'success' ? 'border-green-200 bg-green-50 text-green-800'
              : message.tone === 'error' ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-blue-200 bg-blue-50 text-blue-800'
          }`}>
            {message.text}
          </div>
        )}

        <article className="rounded-lg border bg-white p-4 shadow-sm sm:p-8">
          <header className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <BrandBlock estimate={estimate} />
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-semibold text-gray-950">Painting Proposal</h1>
                {estimate.signedAt && <StatusBadge status="signed" />}
              </div>
              <p className="mt-2 text-gray-600">Review the project scope, selected products, terms, and total investment.</p>
            </div>
            <div className="sm:text-right">
              <p className="text-sm text-gray-600">Estimate #</p>
              <p className="font-mono text-gray-950">{estimate.id.slice(0, 8)}</p>
            </div>
          </header>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <section className="min-w-0 space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Included Scope</h2>
                <p className="mt-1 text-sm text-gray-600">Organized by space. Pricing is shown as one project total.</p>
              </div>

              <div className="space-y-2">
                {scopeGroups.length ? scopeGroups.map((group) => (
                  <section key={group.name} className="overflow-hidden rounded-lg border bg-white">
                    <div className="flex items-center justify-between gap-3 border-b bg-gray-50 px-3 py-2">
                      <h3 className="font-semibold text-gray-950">{group.name}</h3>
                      <span className="text-xs text-gray-500">{group.items.length} substrate{group.items.length === 1 ? '' : 's'}</span>
                    </div>
                    <div className="divide-y">
                      {group.items.map(({ item, parts }) => (
                        <div key={`${item.desc}-${parts.surface}`} className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[8rem_1fr] sm:items-start">
                          <p className="font-medium text-gray-900">{parts.surface}</p>
                          <p className="text-gray-600">
                            {customerScopeDetail(item)}
                            <span className="mx-1 text-gray-300"> | </span>
                            {itemMaterial(item)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                )) : (
                  <p className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-600">No included scope lines are visible on this proposal.</p>
                )}
              </div>

              {optionalItems.length > 0 && !estimate.signedAt && (
                <section className="rounded-lg border bg-white p-4">
                  <h2 className="text-lg font-semibold text-gray-900">Optional Add-ons</h2>
                  <p className="mt-1 text-sm text-gray-600">Select any optional scope you want included before approval. These options update the accepted total and payment schedule.</p>
                  <div className="mt-3 space-y-2">
                    {optionalItems.map((item, index) => (
                      <label key={`${item.desc}-${index}`} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-start sm:justify-between">
                        <span className="flex min-w-0 gap-3">
                          <input
                            type="checkbox"
                            className="mt-1 rounded border-gray-300"
                            checked={selectedOptionIndexes.has(index)}
                            onChange={() => toggleOption(index)}
                          />
                          <span className="min-w-0">
                            <span className="block font-medium text-gray-900">{scopeParts(item).label || item.desc}</span>
                            <span className="mt-1 block text-sm text-gray-600">{customerScopeDetail(item)} | {itemMaterial(item)}</span>
                          </span>
                        </span>
                        <span className="font-semibold text-gray-900">{money(num(item.qty, 1) * num(item.rate))}</span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              <section className="rounded-lg border bg-white p-4">
                <h2 className="text-lg font-semibold text-gray-900">Paint Products & Colors</h2>
                <div className="mt-3 space-y-3">
                  {products.length ? products.map((product) => (
                    <div key={`${product.product}-${product.color}`} className="rounded-md bg-gray-50 p-3">
                      <p className="font-medium text-gray-900">{product.product}</p>
                      <p className="text-sm text-gray-600">{product.color}</p>
                      {product.spaces.length > 0 && <p className="mt-1 text-xs text-gray-500">Used in: {product.spaces.join(', ')}</p>}
                    </div>
                  )) : (
                    <p className="rounded-md bg-gray-50 p-3 text-sm text-gray-600">Paint product and color selections will be confirmed before ordering and production.</p>
                  )}
                </div>
              </section>

              {colorTargets.length > 0 && (
                <section className="rounded-lg border bg-white p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Confirm Colors</h2>
                      <p className="mt-1 text-sm text-gray-600">Choose from the supplier color library or type the exact swatch name and code you have.</p>
                    </div>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${allColorTargetsSelected ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
                      {colorTargets.filter(({ index }) => colorDrafts[index]?.colorName?.trim()).length}/{colorTargets.length} selected
                    </span>
                  </div>
                  <datalist id="customer-paint-color-options">
                    {colorSuggestions.map((color) => (
                      <option key={color.id} value={colorOptionLabel(color)}>
                        {[color.supplierName, color.family, color.collection].filter(Boolean).join(' - ')}
                      </option>
                    ))}
                  </datalist>
                  {colorTargets.length > 1 && (
                    <label className="mt-4 flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50 p-3 text-sm text-blue-950">
                      <input
                        type="checkbox"
                        className="mt-1 rounded border-blue-300"
                        checked={useGroupedColors}
                        onChange={(event) => toggleGroupedColors(event.target.checked)}
                      />
                      <span>
                        <span className="block font-medium">Use one color for matching paint groups</span>
                        <span className="mt-1 block text-blue-800">Ceilings stay separate unless this proposal prices them to match the walls.</span>
                      </span>
                    </label>
                  )}
                  <div className="mt-4 space-y-3">
                    {useGroupedColors ? colorGroups.map((group) => {
                      const draft = colorDrafts[group.indexes[0]] || colorDraftFromItem(group.targets[0].item);
                      const spaces = Array.from(new Set(group.targets.map((target) => `${target.parts.space} - ${target.parts.surface}`)));
                      return (
                        <div key={group.key} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <div className="mb-3">
                            <p className="font-medium text-gray-950">{group.product}</p>
                            <p className="mt-1 text-sm text-gray-600">Applies to {group.targets.length} substrate{group.targets.length === 1 ? '' : 's'}: {spaces.slice(0, 5).join(', ')}{spaces.length > 5 ? `, +${spaces.length - 5} more` : ''}</p>
                            {group.targets.some((target) => ceilingColorRuleLabel(target.item)) && (
                              <p className="mt-1 text-xs font-medium text-amber-800">
                                {Array.from(new Set(group.targets.map((target) => ceilingColorRuleLabel(target.item)).filter(Boolean))).join(' | ')}
                              </p>
                            )}
                          </div>
                          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                            <label>
                              <span className="pf-field-label">Color name</span>
                              <input
                                className="input mt-1"
                                list="customer-paint-color-options"
                                value={draft.colorName}
                                onChange={(event) => applySuggestedColorToIndexes(group.indexes, event.target.value)}
                                onFocus={(event) => setColorQuery(event.currentTarget.value)}
                                placeholder="Search library or type swatch name"
                                autoComplete="off"
                              />
                            </label>
                            <label>
                              <span className="pf-field-label">Color code</span>
                              <input
                                className="input mt-1"
                                value={draft.colorCode}
                                onChange={(event) => updateColorDrafts(group.indexes, { colorCode: event.target.value })}
                                placeholder="SW 7005, OC-17"
                                autoComplete="off"
                              />
                            </label>
                          </div>
                          <label className="mt-2 block">
                            <span className="pf-field-label">Note for contractor</span>
                            <input
                              className="input mt-1"
                              value={draft.notes || ''}
                              onChange={(event) => updateColorDrafts(group.indexes, { notes: event.target.value })}
                              placeholder="Optional: confirm sample location or special request"
                              autoComplete="off"
                            />
                          </label>
                        </div>
                      );
                    }) : colorTargets.map(({ item, index }) => {
                      const parts = scopeParts(item);
                      const draft = colorDrafts[index] || colorDraftFromItem(item);
                      return (
                        <div key={`${index}-${item.desc}`} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <div className="mb-3">
                            <p className="font-medium text-gray-950">{parts.space} - {parts.surface}</p>
                            <p className="mt-1 text-sm text-gray-600">{materialProductLabel(item)}</p>
                            {ceilingColorRuleLabel(item) && <p className="mt-1 text-xs font-medium text-amber-800">{ceilingColorRuleLabel(item)}</p>}
                          </div>
                          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                            <label>
                              <span className="pf-field-label">Color name</span>
                              <input
                                className="input mt-1"
                                list="customer-paint-color-options"
                                value={draft.colorName}
                                onChange={(event) => applySuggestedColor(index, event.target.value)}
                                onFocus={(event) => setColorQuery(event.currentTarget.value)}
                                placeholder="Search library or type swatch name"
                                autoComplete="off"
                              />
                            </label>
                            <label>
                              <span className="pf-field-label">Color code</span>
                              <input
                                className="input mt-1"
                                value={draft.colorCode}
                                onChange={(event) => updateColorDraft(index, { colorCode: event.target.value })}
                                placeholder="SW 7005, OC-17"
                                autoComplete="off"
                              />
                            </label>
                          </div>
                          <label className="mt-2 block">
                            <span className="pf-field-label">Note for contractor</span>
                            <input
                              className="input mt-1"
                              value={draft.notes || ''}
                              onChange={(event) => updateColorDraft(index, { notes: event.target.value })}
                              placeholder="Optional: confirm finish, sample location, or special request"
                              autoComplete="off"
                            />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                  <Button
                    className="mt-4 w-full sm:w-auto"
                    onClick={() => void submitColorSelections()}
                    disabled={!allColorTargetsSelected}
                    isLoading={isSavingColors}
                  >
                    Send Color Selections
                  </Button>
                  {!allColorTargetsSelected && (
                    <p className="mt-2 text-sm text-gray-600">Select a color for every listed substrate before sending.</p>
                  )}
                </section>
              )}
            </section>

            {breakdown && (
              <aside className="self-start rounded-lg border bg-gray-50 p-5">
                <PriceSummary
                  breakdown={breakdown}
                  showOptions={optionalItems.length > 0}
                  paymentSchedule={paymentSchedule}
                  paymentTerms={estimate.paymentTerms}
                  primaryColor={primaryColor}
                />
                <p className="mt-4 text-sm text-gray-600">Includes labor, selected paint products, prep, listed materials{optionalItems.length ? ', selected options,' : ''} and applicable tax.</p>
              </aside>
            )}
          </div>
        </article>

        <ActionPanel
          estimate={estimate}
          nextPayment={nextPayment}
          selectedTotal={breakdown?.total || 0}
          primaryColor={primaryColor}
          isPaying={isPaying}
          onApprove={openTerms}
          onPay={startCheckout}
        />

        <SignatureSummary estimate={estimate} />

        <LegalPanel legal={legal} />

        {photos.length > 0 && (
          <section className="rounded-lg border bg-white shadow-sm">
            <div className="border-b p-5">
              <h2 className="font-semibold text-gray-900">Project Photos</h2>
              <p className="mt-1 text-sm text-gray-600">Photos included by your contractor for proposal context.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3 lg:grid-cols-4">
              {photos.map((photo) => (
                <a key={photo.id || photo.url} href={photo.url || photo.thumbnailUrl || '#'} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border bg-gray-50">
                  <img src={photo.thumbnailUrl || photo.url} alt={photo.caption || 'Project photo'} className="aspect-square w-full object-cover" />
                  {photo.caption && <p className="p-2 text-xs text-gray-600">{photo.caption}</p>}
                </a>
              ))}
            </div>
          </section>
        )}

        <p className="pb-4 text-center text-sm text-gray-600">Questions? Reply to the estimate email or call your contractor.</p>
      </section>

      <Modal isOpen={showTerms} onClose={() => setShowTerms(false)} title="Terms and Conditions" size="lg">
        <div className="space-y-4 text-sm text-gray-700">
          <ContractorLegalSummary legal={legal} />
          <LegalText value={legal.contractTerms} emptyText="Contract terms will be provided by the contractor." />
          {legal.disclosureEnabled && legal.disclosureText && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
              <p className="font-semibold">{legal.disclosureTitle || 'Required disclosure'}</p>
              <div className="mt-2 space-y-2"><LegalText value={legal.disclosureText} /></div>
            </div>
          )}
          {legal.disclosureEnabled && legal.disclosureRequired && (
            <label className="block rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
              <span className="flex items-start gap-3">
                <input type="checkbox" className="mt-1 rounded border-amber-300" checked={acknowledgedDisclosure} onChange={(event) => setAcknowledgedDisclosure(event.target.checked)} />
                <span>I have reviewed and acknowledge the required disclosure above.</span>
              </span>
            </label>
          )}
        </div>
        <ModalFooter className="-mx-6 -mb-4 mt-6">
          <button className="btn-secondary" onClick={() => setShowTerms(false)}>Cancel</button>
          <button className="btn-primary" onClick={acceptTerms}>I agree</button>
        </ModalFooter>
      </Modal>

      <Modal isOpen={showSignature} onClose={() => setShowSignature(false)} title="Sign Proposal" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-600">By signing, you agree to the terms and selected scope.</p>
          <label className="block">
            <span className="form-label">Full name</span>
            <input className="input mt-1" value={signerName} onChange={(event) => setSignerName(event.target.value)} autoComplete="name" enterKeyHint="done" placeholder="Your full name" />
          </label>
          <div>
            <span className="form-label">Signature</span>
            <canvas
              ref={canvasRef}
              className="mt-1 h-36 w-full touch-none rounded-lg border bg-gray-50"
              onPointerDown={startDrawing}
              onPointerMove={draw}
              onPointerUp={stopDrawing}
              onPointerCancel={stopDrawing}
              onPointerLeave={stopDrawing}
            />
            <button type="button" className="btn-text btn-sm mt-2" onClick={clearSignature}>Clear signature</button>
          </div>
        </div>
        <ModalFooter className="-mx-6 -mb-4 mt-6">
          <button className="btn-secondary" onClick={() => {
            setShowSignature(false);
            setShowTerms(true);
          }}>Back</button>
          <button className="btn-primary" disabled={isSigning} onClick={submitSignature}>{isSigning ? 'Signing...' : 'Sign proposal'}</button>
        </ModalFooter>
      </Modal>
    </main>
    </>
  );
}

function BrandBlock({ estimate }: { estimate: PublicEstimate }) {
  if (!estimate.branding?.companyName && !estimate.branding?.logoUrl) return null;
  return (
    <div className="mb-5">
      {estimate.branding.logoUrl && <img src={estimate.branding.logoUrl} className="mb-3 h-12" alt={`${estimate.branding.companyName || 'Contractor'} logo`} />}
      {estimate.branding.companyName && <p className="text-sm font-semibold text-gray-700">{estimate.branding.companyName}</p>}
    </div>
  );
}

function PriceSummary({
  breakdown,
  showOptions,
  paymentSchedule,
  paymentTerms,
  primaryColor,
}: {
  breakdown: ReturnType<typeof pricingBreakdown>;
  showOptions: boolean;
  paymentSchedule: PaymentScheduleItem[];
  paymentTerms?: string;
  primaryColor: string;
}) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Project investment</p>
        <p className="mt-1 text-3xl font-semibold text-gray-950">{money(breakdown.total)}</p>
      </div>
      <div className="space-y-2 border-y py-3 text-sm">
        <div className="flex justify-between gap-4"><span className="text-gray-600">Base scope subtotal</span><span className="font-medium text-gray-900">{money(breakdown.baseSubtotal)}</span></div>
        {breakdown.discount > 0 && <div className="flex justify-between gap-4 text-green-700"><span>Discount</span><span className="font-medium">-{money(breakdown.discount)}</span></div>}
        {showOptions && <div className="flex justify-between gap-4"><span className="text-gray-600">Selected options</span><span className="font-medium text-gray-900">{money(breakdown.options)}</span></div>}
        {showOptions && <div className="flex justify-between gap-4"><span className="text-gray-600">Tax on selected options</span><span className="font-medium text-gray-900">{money(breakdown.optionTax)}</span></div>}
        <div className="flex justify-between gap-4"><span className="text-gray-600">Tax total</span><span className="font-medium text-gray-900">{money(breakdown.totalTax)}</span></div>
      </div>
      <div className="flex justify-between gap-4 text-base">
        <span className="font-semibold text-gray-900">Total</span>
        <span className="font-bold" style={{ color: primaryColor }}>{money(breakdown.total)}</span>
      </div>
      {paymentSchedule.length > 0 && (
        <div className="border-t pt-4">
          <p className="text-sm font-semibold text-gray-900">Payment schedule</p>
          <div className="mt-3 space-y-2">
            {paymentSchedule.map((item) => (
              <div key={item.key || item.label} className="rounded-md border bg-white px-3 py-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.label}</p>
                    {item.due && <p className="text-xs text-gray-500">{item.due}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">{money(item.amount)}</p>
                    <p className="text-xs text-gray-500">{num(item.percent).toFixed(num(item.percent) % 1 ? 1 : 0)}%</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {paymentTerms && <p className="mt-2 text-xs text-gray-500">{paymentTerms}</p>}
        </div>
      )}
    </div>
  );
}

function ActionPanel({
  estimate,
  nextPayment,
  selectedTotal,
  primaryColor,
  isPaying,
  onApprove,
  onPay,
}: {
  estimate: PublicEstimate;
  nextPayment?: PaymentScheduleItem | null;
  selectedTotal: number;
  primaryColor: string;
  isPaying: string;
  onApprove: () => void;
  onPay: (milestoneKey?: string) => void;
}) {
  if (estimate.signedAt) {
    const paidAmount = num(estimate.paymentSummary?.paidAmount);
    return (
      <section className="rounded-lg border border-green-200 bg-green-50 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="font-semibold text-green-950">Final signed copy</h3>
            <p className="mt-1 text-sm text-green-800">Signed by {estimate.signedName || 'Customer'} on {new Date(estimate.signedAt).toLocaleDateString()}.</p>
            {estimate.contractorSignature?.signedAt && (
              <p className="mt-1 text-sm text-green-800">
                Countersigned by {estimate.contractorSignature.name || estimate.contractorSignature.companyName || 'Contractor'} for {estimate.contractorSignature.companyName || 'the contractor'} on {new Date(estimate.contractorSignature.signedAt).toLocaleDateString()}.
              </p>
            )}
            <p className="mt-2 text-sm text-gray-700">{paidAmount > 0 ? `${money(paidAmount)} payment recorded.` : 'No online payment is recorded on this copy yet.'}</p>
            {nextPayment ? (
              <p className="mt-1 text-sm text-gray-700">Next payment: <strong>{nextPayment.label}</strong> {money(num(nextPayment.amount) - num(nextPayment.paidAmount))}.</p>
            ) : (
              <p className="mt-1 text-sm text-gray-700">No online payment is due right now.</p>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:min-w-44">
            {nextPayment && (
              <button type="button" className="btn-primary btn-sm justify-center" disabled={Boolean(isPaying)} onClick={() => onPay(nextPayment.key)}>
                {isPaying ? 'Preparing...' : `Pay ${nextPayment.label}`}
              </button>
            )}
            <button type="button" className="btn-secondary btn-sm justify-center" onClick={() => window.print()}>Print / save copy</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-blue-200 bg-blue-50 p-5" style={{ borderColor: primaryColor }}>
      <h3 className="font-semibold text-gray-900">Ready to proceed?</h3>
      <p className="mt-2 text-gray-700">Approve the proposal to review terms and sign. Any payment due will be shown separately.</p>
      {estimate.contractorSignature?.signedAt ? (
        <p className="mt-2 text-sm text-blue-900">
          This proposal has been countersigned by {estimate.contractorSignature.name || estimate.contractorSignature.companyName || 'the contractor'} on behalf of {estimate.contractorSignature.companyName || 'the painting company'}.
        </p>
      ) : (
        <p className="mt-2 text-sm text-red-800">
          Contractor signature is pending. Ask the contractor to countersign this proposal before signing.
        </p>
      )}
      <p className="mt-2 text-sm text-blue-900">
        This link always shows the current proposal{estimate.updatedAt || estimate.sentAt ? `, last updated ${new Date(estimate.updatedAt || estimate.sentAt || '').toLocaleDateString()}` : ''}.
        {' '}Once signed, it becomes the approved agreement and later changes require a change order or a new estimate.
      </p>
      <div className="mt-4">
        <button type="button" className="w-full rounded-lg px-5 py-3 font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto" style={{ backgroundColor: primaryColor }} onClick={onApprove} disabled={!estimate.contractorSignature?.signedAt}>
          Approve and sign - {money(selectedTotal)}
        </button>
      </div>
    </section>
  );
}

function SignatureSummary({ estimate }: { estimate: PublicEstimate }) {
  const contractor = estimate.contractorSignature;
  return (
    <section className="rounded-lg border bg-white p-5">
      <h2 className="text-lg font-semibold text-gray-950">Agreement signatures</h2>
      <p className="mt-1 text-sm text-gray-600">Both the contractor and customer signatures are recorded for the final agreement.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Contractor</p>
          {contractor?.signedAt ? (
            <>
              <p className="mt-2 font-semibold text-gray-950">{contractor.name || contractor.companyName || 'Authorized representative'}</p>
              <p className="text-sm text-gray-700">{contractor.capacity || contractor.title || 'Authorized representative'}</p>
              {contractor.email && <p className="text-sm text-gray-600">{contractor.email}</p>}
              <p className="mt-2 text-sm text-gray-600">Signed {new Date(contractor.signedAt).toLocaleString()}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-red-800">Pending contractor countersignature</p>
          )}
        </div>
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Customer</p>
          {estimate.signedAt ? (
            <>
              <p className="mt-2 font-semibold text-gray-950">{estimate.signedName || 'Customer'}</p>
              <p className="text-sm text-gray-700">Customer approval</p>
              <p className="mt-2 text-sm text-gray-600">Signed {new Date(estimate.signedAt).toLocaleString()}</p>
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-600">Not signed yet</p>
          )}
        </div>
      </div>
    </section>
  );
}

function ContractorLegalSummary({ legal }: { legal: LegalSettings }) {
  const rows = [
    legal.jurisdiction ? ['Jurisdiction', legal.jurisdiction] : null,
    legal.contractorRegistrationNumber ? ['Registration/license', legal.contractorRegistrationNumber] : null,
    legal.bondAmount ? ['Bond/insurance', legal.bondAmount] : null,
  ].filter(Boolean) as Array<[string, string]>;
  if (!rows.length) return null;
  return (
    <div className="rounded-lg border bg-gray-50 p-3">
      <p className="text-sm font-semibold text-gray-900">Contractor details</p>
      <dl className="mt-2 grid gap-1 text-sm text-gray-700">
        {rows.map(([label, value]) => (
          <div key={label} className="grid gap-1 sm:grid-cols-[9rem_1fr]">
            <dt className="text-gray-500">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function LegalText({ value, emptyText = '' }: { value?: string; emptyText?: string }) {
  const paragraphs = textParagraphs(value);
  if (!paragraphs.length) return emptyText ? <p>{emptyText}</p> : null;
  return (
    <>
      {paragraphs.map((paragraph) => {
        const [label, ...rest] = paragraph.split(':');
        if (rest.length && label.length < 80) {
          return <p key={paragraph}><strong className="text-gray-900">{label.trim()}:</strong> {rest.join(':').trim()}</p>;
        }
        return <p key={paragraph}>{paragraph}</p>;
      })}
    </>
  );
}

function LegalPanel({ legal }: { legal: LegalSettings }) {
  return (
    <section className="rounded-lg border bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="font-semibold text-gray-900">Contract Terms & Disclosures</h2>
          <p className="mt-1 text-sm text-gray-600">These terms are reviewed again before signature and saved with the accepted proposal.</p>
        </div>
        {legal.disclosureRequired && <span className="self-start rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">Acknowledgement required</span>}
      </div>
      <div className="mt-4 space-y-3">
        <ContractorLegalSummary legal={legal} />
        <div className="space-y-2 text-sm text-gray-700">
          <LegalText value={legal.contractTerms} emptyText="Contract terms will be provided by the contractor." />
        </div>
        {legal.disclosureEnabled && legal.disclosureText && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-semibold text-amber-950">{legal.disclosureTitle || 'Required disclosure'}</p>
            <div className="mt-2 space-y-2 text-sm text-amber-950">
              <LegalText value={legal.disclosureText} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
