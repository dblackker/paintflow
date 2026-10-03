import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AddressFields } from '@/components/AddressFields';
import { StatusBadge } from '@/components/Badge';
import { Card, CardHeader } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Modal, ModalFooter } from '@/components/Modal';
import { apiJson, formatMoney, labelize } from '@/lib/api';
import { EstimationInputError, formatEstimationMinor, resolveEstimationMeasurement, estimationUnit, type EstimationResult, type EstimationRequest } from '../../../../../packages/core/src/estimation';
import { calculateProductionPreview, type ProductionPreviewRequest } from '../../../../../packages/core/src/estimation-production';
import { estimationSaveAttempt, type EstimationSaveAttempt } from '../../../../../packages/core/src/estimation-save';
import { decimal, minor } from '../../../../../packages/core/src/estimation-decimal';
import { estimationSurfaceKind, resolveEstimationTemplateRate } from '../../../../../packages/core/src/estimation-template';

type EstimateType = 'interior' | 'exterior' | 'cabinet' | 'custom';
type PrepLevel = 'none' | 'light' | 'standard' | 'heavy';
type ApplicationMethod = 'brush_roll' | 'spray_backroll' | 'spray_only';
type Unit = 'sqft' | 'linear_ft' | 'each' | string;

interface Lead {
  id: string;
  name: string;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

interface ProductionRate {
  id: string;
  category?: string | null;
  surfaceType?: string | null;
  description?: string | null;
  unit?: Unit | null;
  ratePerHour?: number | string | null;
  hourlyRate?: number | string | null;
  coats?: number | string | null;
  prepMultiplier?: number | string | null;
}

interface Material {
  id: string;
  name?: string | null;
  brand?: string | null;
  category?: string | null;
  unit?: string | null;
  costPerUnit?: number | string | null;
  coverageSqFt?: number | string | null;
  markupPercent?: number | string | null;
  sku?: string | null;
}

interface CatalogColor {
  id: string;
  supplierName?: string | null;
  name?: string | null;
  colorCode?: string | null;
  hexCode?: string | null;
  family?: string | null;
}

interface OrgSettings {
  defaultLaborRate?: number | string | null;
  materialMarkupPercent?: number | string | null;
  salesTaxRate?: number | string | null;
}

interface Estimate {
  id: string;
  updatedAt?: string;
  leadId?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  status?: string | null;
  signedAt?: string | null;
  packages?: EstimatePackage[] | null;
  customerPreviewUrl?: string | null;
  publicUrl?: string | null;
}

interface EstimatePackage {
  calculationVersion?: string;
  productionInput?: ProductionPreviewRequest;
  calculationInput?: EstimationRequest;
  calculationSnapshot?: EstimationResult;
  name?: string;
  estimateType?: EstimateType | string;
  subtotal?: number;
  discount?: number;
  tax?: number;
  total?: number;
  optionalTotal?: number;
  items?: EstimateLineItem[];
  lineItems?: EstimateLineItem[];
}

interface EstimateLineItem {
  calculationItemId?: string;
  calculatedSubtotalMinor?: number;
  desc?: string;
  qty?: number;
  rate?: number;
  category?: string;
  kind?: string;
  customerVisible?: boolean;
  optional?: boolean;
  productionRateId?: string;
  roomName?: string;
  surfaceName?: string;
  dimensions?: { width?: number; height?: number; quantity?: number; unit?: string; coatingWidthInches?: number; coatingSqFtPerItem?: number };
  notes?: string;
  labor?: {
    hours?: number;
    rate?: number;
    cost?: number;
    coats?: number;
    prepLevel?: PrepLevel;
    applicationMethod?: ApplicationMethod;
    productionRatePerHour?: number;
    prepAdjustmentHours?: number;
    paintAdjustmentHours?: number;
  };
  material?: {
    id?: string;
    name?: string;
    brand?: string;
    unit?: string;
    quantity?: number;
    costPerUnit?: number;
    markupPercent?: number;
    price?: number;
    acquisitionCost?: number;
    purchaseGroupId?: string;
    theoreticalGallons?: string;
    colorName?: string;
    colorCode?: string;
    status?: string;
    crewNote?: string;
  };
}

interface Room {
  id: string;
  name: string;
  kind: 'interior' | 'exterior' | 'custom';
  generated?: boolean;
  metrics?: {
    length?: number;
    width?: number;
    perimeter?: number;
    height?: number;
    windows?: number;
    doors?: number;
  };
  surfaces: Surface[];
}

interface TemplateSurface {
  productionRateId?: string | null;
  materialId?: string | null;
  unit?: string | null;
  coatingWidthInches?: number | string | null;
  coatingSqFtPerItem?: number | string | null;
  colorName?: string | null;
  colorCode?: string | null;
  category?: string | null;
  label?: string | null;
  quantity?: number | string | null;
  width?: number | string | null;
  height?: number | string | null;
  coats?: number | string | null;
  prepLevel?: PrepLevel | string | null;
  applicationMethod?: ApplicationMethod | string | null;
  customerVisible?: boolean | null;
  optional?: boolean | null;
  notes?: string | null;
}

interface TemplateRoom {
  name?: string | null;
  roomType?: string | null;
  kind?: 'interior' | 'exterior' | 'custom' | string | null;
  length?: number | string | null;
  width?: number | string | null;
  metrics?: Room['metrics'];
  surfaces?: TemplateSurface[] | null;
  items?: TemplateSurface[] | null;
}

interface Surface {
  id: string;
  rateId: string;
  label: string;
  width: string;
  height: string;
  quantity: string;
  coatingWidthInches: string;
  coatingSqFtPerItem: string;
  coats: number;
  prepLevel: PrepLevel;
  applicationMethod: ApplicationMethod;
  prepAdjustmentHours: string;
  paintAdjustmentHours: string;
  materialId: string;
  colorName: string;
  colorCode: string;
  colorStatus: string;
  crewNote: string;
  customerVisible: boolean;
  optional: boolean;
}

interface Adjustment {
  id: string;
  desc: string;
  qty: string;
  rate: string;
  category: string;
  customerVisible: boolean;
  optional: boolean;
}

interface InteriorAssumptions {
  bedrooms: string;
  bathrooms: string;
  livingRooms: string;
  diningRooms: string;
  kitchens: string;
  hallways: string;
  closets: string;
  ceilingHeight: string;
  trimScope: string;
  includeCeilings: boolean;
  includeDoors: boolean;
}

interface ExteriorAssumptions {
  perimeter: string;
  stories: string;
  wallHeight: string;
  soffitDepth: string;
  windows: string;
  doors: string;
  corners: string;
  rooflineFactor: string;
}

interface EstimateTotals {
  items: EstimateLineItem[];
  hours: number;
  labor: number;
  materials: number;
  materialCost: number;
  adjustments: number;
  optionalTotal: number;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

const applicationMethods: Record<ApplicationMethod, { label: string; productivity: number }> = {
  brush_roll: { label: 'Brush & roll', productivity: 1 },
  spray_backroll: { label: 'Spray & back-roll', productivity: 1.35 },
  spray_only: { label: 'Spray only', productivity: 1.6 },
};

function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID?.() || Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function num(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rateText(rate?: ProductionRate | null) {
  return `${rate?.category || ''} ${rate?.surfaceType || ''} ${rate?.description || ''}`.toLowerCase();
}

function rateKind(rate?: ProductionRate | null) {
  return estimationSurfaceKind(rate);
}

function measurementConfig(rate?: ProductionRate | null) {
  const kind = rateKind(rate);
  const unit = String(rate?.unit || 'sqft').toLowerCase();
  if (unit === 'linear_ft') {
    return { width: 'Linear feet', height: '', quantity: 'Lin ft override', helper: 'Linear substrates price from length. Use override when you have a better field measurement.', showHeight: false };
  }
  if (unit === 'each' || kind === 'doors') {
    return { width: '', height: '', quantity: 'Count', helper: 'Count-based substrates are measured by item count.', showWidth: false, showHeight: false };
  }
  if (kind === 'walls') return { width: 'Perimeter', height: 'Wall height', quantity: 'Sq ft override', helper: 'Walls use room perimeter x wall height, with optional square-foot override.', showWidth: true, showHeight: true };
  if (kind === 'ceilings') return { width: 'Length', height: 'Width', quantity: 'Sq ft override', helper: 'Ceilings use length x width, with optional square-foot override.', showWidth: true, showHeight: true };
  return { width: 'Width', height: 'Height', quantity: 'Sq ft override', helper: 'Measured substrates use width x height, with optional square-foot override.', showWidth: true, showHeight: true };
}

function displayRate(rate: ProductionRate) {
  const base = rate.description || [rate.category, rate.surfaceType].filter(Boolean).join(' ');
  return `${labelize(base)} (${num(rate.ratePerHour).toLocaleString()} ${labelize(rate.unit || 'sqft')}/hr)`;
}

function defaultMethod(rate?: ProductionRate | null): ApplicationMethod {
  const text = rateText(rate);
  if (/spray/.test(text) && /back.?roll/.test(text)) return 'spray_backroll';
  if (/spray/.test(text)) return 'spray_only';
  return 'brush_roll';
}

function materialLabel(material?: Material | null) {
  if (!material) return 'Use estimate product';
  return `${[material.brand, material.name].filter(Boolean).join(' - ')} (${formatMoney(material.costPerUnit || 0)}/${material.unit || 'unit'})`;
}

function coatingDefaults(rate?: ProductionRate | null) {
  return {
    coatingWidthInches: rate?.unit === 'linear_ft' ? '6' : '',
    coatingSqFtPerItem: rate?.unit === 'each' ? rateKind(rate) === 'doors' ? '42' : '4' : '',
  };
}

function dollars(minor: number) {
  return Number(formatEstimationMinor(minor));
}

function packageItems(pkg?: EstimatePackage | null) {
  return Array.isArray(pkg?.items) ? pkg.items : Array.isArray(pkg?.lineItems) ? pkg.lineItems : [];
}

function normalizePrepLevel(value: unknown): PrepLevel {
  return ['none', 'light', 'standard', 'heavy'].includes(String(value)) ? value as PrepLevel : 'standard';
}

function normalizeApplicationMethod(value: unknown, rate?: ProductionRate | null): ApplicationMethod {
  return ['brush_roll', 'spray_backroll', 'spray_only'].includes(String(value)) ? value as ApplicationMethod : defaultMethod(rate);
}

export function EstimateProduction() {
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const estimateId = params.get('estimateId') || params.get('draft') || '';
  const initialLeadId = params.get('leadId') || '';
  const [rates, setRates] = useState<ProductionRate[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [catalogColors, setCatalogColors] = useState<CatalogColor[]>([]);
  const [settings, setSettings] = useState<OrgSettings>({});
  const [editingEstimate, setEditingEstimate] = useState<Estimate | null>(null);
  const [leadId, setLeadId] = useState(initialLeadId);
  const [jobsite, setJobsite] = useState({ streetAddress: '', city: '', state: '', postalCode: '' });
  const [estimateType, setEstimateType] = useState<EstimateType>('interior');
  const [paintMaterialId, setPaintMaterialId] = useState('');
  const [primerMaterialId, setPrimerMaterialId] = useState('');
  const [discount, setDiscount] = useState('0');
  const [rooms, setRooms] = useState<Room[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [starterCollapsed, setStarterCollapsed] = useState(false);
  const [starterSkipped, setStarterSkipped] = useState(false);
  const [templateApplied, setTemplateApplied] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [setupError, setSetupError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [serverPreview, setServerPreview] = useState<{ key: string; calculation: EstimationResult; resolvedInput: EstimationRequest } | null>(null);
  const [saveStatus, setSaveStatus] = useState('');
  const saveAttemptRef = useRef<EstimationSaveAttempt | null>(null);
  const emailAttemptRef = useRef<EstimationSaveAttempt | null>(null);
  const saveLockRef = useRef(false);
  const pendingSaveRef = useRef<{ identity: string; estimate: Estimate; calculation: EstimationResult; reason: 'sent' | 'updated' } | null>(null);
  const [interiorAssumptions, setInteriorAssumptions] = useState<InteriorAssumptions>({
    bedrooms: '2',
    bathrooms: '1',
    livingRooms: '1',
    diningRooms: '0',
    kitchens: '1',
    hallways: '1',
    closets: '2',
    ceilingHeight: '9',
    trimScope: 'base-casing',
    includeCeilings: true,
    includeDoors: true,
  });
  const [exteriorAssumptions, setExteriorAssumptions] = useState<ExteriorAssumptions>({
    perimeter: '160',
    stories: '2',
    wallHeight: '10',
    soffitDepth: '2',
    windows: '14',
    doors: '3',
    corners: '4',
    rooflineFactor: '1.1',
  });

  useEffect(() => {
    loadSetup();
  }, [estimateId]);

  async function loadSetup() {
    pendingSaveRef.current = null;
    saveAttemptRef.current = null;
    emailAttemptRef.current = null;
    setServerPreview(null);
    setIsLoading(true);
    setSetupError('');
    try {
      const [ratesRes, leadsRes, settingsRes, materialsRes, catalogColorsRes, estimateRes] = await Promise.all([
        apiJson<{ data: ProductionRate[] }>('/v1/production-rates'),
        apiJson<{ data: Lead[] }>('/v1/leads?status=all&limit=200'),
        apiJson<{ data: OrgSettings }>('/v1/settings/org'),
        apiJson<{ data: Material[] }>('/v1/materials'),
        apiJson<{ data: CatalogColor[] }>('/v1/supplier-catalog/colors?popular=true&limit=80').catch(() => ({ data: [] })),
        estimateId ? apiJson<{ data: Estimate }>(`/v1/estimates/${estimateId}`) : Promise.resolve({ data: null as unknown as Estimate }),
      ]);
      setRates(ratesRes.data || []);
      setLeads(leadsRes.data || []);
      setSettings(settingsRes.data || {});
      setMaterials(materialsRes.data || []);
      setCatalogColors(catalogColorsRes.data || []);
      if (estimateRes.data) hydrateEstimate(estimateRes.data, ratesRes.data || []);
      else if (!hydrateTemplateRooms(ratesRes.data || []) && initialLeadId) setLeadId(initialLeadId);
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Failed to load estimator setup');
    } finally {
      setIsLoading(false);
    }
  }

  function hydrateEstimate(estimate: Estimate, loadedRates: ProductionRate[]) {
    const canEdit = estimate.status === 'draft' || (estimate.status === 'sent' && !estimate.signedAt);
    if (!canEdit) {
      setSetupError('Signed or closed estimates are read-only. View the original agreement or create a change order.');
      window.showToast?.('Only draft or unsigned sent estimates can be edited here.', 'error');
      return;
    }
    const pkg = estimate.packages?.[0];
    setEditingEstimate(estimate);
    setLeadId(estimate.leadId || '');
    setJobsite({
      streetAddress: estimate.streetAddress || '',
      city: estimate.city || '',
      state: estimate.state || '',
      postalCode: String(estimate.postalCode || '').slice(0, 5),
    });
    setEstimateType((pkg?.estimateType as EstimateType) || 'interior');
    setDiscount(String(pkg?.discount || 0));
    const roomMap = new Map<string, Room>();
    const nextAdjustments: Adjustment[] = [];
    for (const item of packageItems(pkg)) {
      if (item.kind === 'line_item') {
        const original = pkg?.productionInput?.adjustments?.find((row) => row.id === item.calculationItemId);
        nextAdjustments.push({
          id: item.calculationItemId || uid('adj'),
          desc: item.desc || '',
          qty: String(original?.quantity ?? item.qty ?? 1),
          rate: String(original?.unitPrice ?? item.rate ?? 0),
          category: item.category || 'other',
          customerVisible: item.customerVisible !== false,
          optional: Boolean(item.optional),
        });
        continue;
      }
      const roomName = item.roomName || String(item.desc || 'Project').split(':')[0] || 'Project';
      if (!roomMap.has(roomName)) {
        roomMap.set(roomName, { id: uid('room'), name: roomName, kind: 'interior', surfaces: [] });
      }
      const surface = surfaceFromEstimateItem(item, loadedRates);
      const original = pkg?.productionInput?.items?.find((row) => row.id === item.calculationItemId);
      roomMap.get(roomName)!.surfaces.push(original ? {
        ...surface,
        width: String(original.width ?? surface.width), height: String(original.height ?? surface.height), quantity: String(original.quantity ?? surface.quantity),
        coats: original.coats ?? surface.coats, prepLevel: original.prepLevel ?? surface.prepLevel, applicationMethod: original.applicationMethod ?? surface.applicationMethod,
        coatingWidthInches: String(original.coatingWidthInches ?? surface.coatingWidthInches), coatingSqFtPerItem: String(original.coatingSqFtPerItem ?? surface.coatingSqFtPerItem),
        prepAdjustmentHours: String(original.prepAdjustmentHours ?? surface.prepAdjustmentHours), paintAdjustmentHours: String(original.paintAdjustmentHours ?? surface.paintAdjustmentHours),
      } : surface);
    }
    setRooms(Array.from(roomMap.values()));
    setAdjustments(nextAdjustments);
    setStarterCollapsed(true);
  }

  function hydrateTemplateRooms(loadedRates: ProductionRate[]) {
    const templateRooms = (location.state as { estimateTemplate?: { rooms?: TemplateRoom[] } } | null)?.estimateTemplate?.rooms;
    if (!templateRooms) return false;

    try {
      if (!Array.isArray(templateRooms) || !templateRooms.length) return false;

      const nextRooms = templateRooms.map((room, roomIndex): Room => {
        const kind = room.kind === 'exterior' || room.roomType === 'exterior' ? 'exterior' : room.kind === 'custom' ? 'custom' : 'interior';
        const surfaces = (Array.isArray(room.surfaces) && room.surfaces.length ? room.surfaces : room.items || [])
          .map((surface) => templateSurfaceToProduction(surface, loadedRates, kind))
          .filter((surface): surface is Surface => Boolean(surface));
        const length = num(room.length);
        const width = num(room.width);
        const metrics = room.metrics || (length && width ? { length, width, perimeter: (length + width) * 2 } : undefined);
        return {
          id: uid('room'),
          name: room.name || (kind === 'exterior' ? 'Exterior' : `Room ${roomIndex + 1}`),
          kind,
          generated: true,
          metrics,
          surfaces,
        };
      }).filter((room) => room.surfaces.length);

      if (!nextRooms.length) return false;
      setEstimateType(nextRooms.some((room) => room.kind === 'exterior') ? 'exterior' : 'interior');
      setRooms(nextRooms);
      setStarterCollapsed(true);
      setStarterSkipped(false);
      setTemplateApplied(true);
      navigate(location.pathname + location.search, { replace: true, state: null });
      window.showToast?.(`Loaded ${nextRooms.length} room${nextRooms.length === 1 ? '' : 's'} from template.`, 'success');
      return true;
    } catch (err) {
      window.showToast?.(err instanceof Error ? err.message : 'Could not load estimate template', 'error');
      return false;
    }
  }

  function templateSurfaceToProduction(template: TemplateSurface, loadedRates: ProductionRate[], kind: string): Surface | null {
    const category = String(template.category || template.label || '').trim();
    const rate = resolveEstimationTemplateRate(template, loadedRates, kind);
    const label = template.label || labelize(category || rate?.surfaceType || rate?.category || 'Substrate');
    return {
      id: uid('surface'),
      rateId: rate?.id || '',
      label,
      width: template.width == null ? '' : String(template.width),
      height: template.height == null ? '' : String(template.height),
      quantity: template.quantity == null ? '' : String(template.quantity),
      ...coatingDefaults(rate),
      ...(template.coatingWidthInches != null ? { coatingWidthInches: String(template.coatingWidthInches) } : {}),
      ...(template.coatingSqFtPerItem != null ? { coatingSqFtPerItem: String(template.coatingSqFtPerItem) } : {}),
      coats: num(template.coats, num(rate?.coats, 2)),
      prepLevel: normalizePrepLevel(template.prepLevel),
      applicationMethod: normalizeApplicationMethod(template.applicationMethod, rate),
      prepAdjustmentHours: '',
      paintAdjustmentHours: '',
      materialId: template.materialId || '',
      colorName: template.colorName || '',
      colorCode: template.colorCode || '',
      colorStatus: 'TBD',
      crewNote: template.notes || '',
      customerVisible: template.customerVisible !== false,
      optional: Boolean(template.optional),
    };
  }

  function surfaceFromEstimateItem(item: EstimateLineItem, loadedRates: ProductionRate[]): Surface {
    const rateId = item.productionRateId && loadedRates.some((rate) => rate.id === item.productionRateId) ? item.productionRateId : '';
    const label = item.surfaceName || String(item.desc || '').split(':').pop()?.trim() || 'Substrate';
    return {
      id: item.calculationItemId || uid('surface'),
      rateId,
      label,
      width: String(item.dimensions?.width || ''),
      height: String(item.dimensions?.height || ''),
      quantity: String(item.dimensions?.quantity || ''),
      coatingWidthInches: String(item.dimensions?.coatingWidthInches ?? coatingDefaults(loadedRates.find((rate) => rate.id === rateId)).coatingWidthInches),
      coatingSqFtPerItem: String(item.dimensions?.coatingSqFtPerItem ?? coatingDefaults(loadedRates.find((rate) => rate.id === rateId)).coatingSqFtPerItem),
      coats: num(item.labor?.coats, 2),
      prepLevel: normalizePrepLevel(item.labor?.prepLevel),
      applicationMethod: normalizeApplicationMethod(item.labor?.applicationMethod, loadedRates.find((rate) => rate.id === rateId)),
      prepAdjustmentHours: String(item.labor?.prepAdjustmentHours || ''),
      paintAdjustmentHours: String(item.labor?.paintAdjustmentHours || ''),
      materialId: item.material?.id || '',
      colorName: item.material?.colorName || '',
      colorCode: item.material?.colorCode || '',
      colorStatus: item.material?.status || 'TBD',
      crewNote: item.material?.crewNote || '',
      customerVisible: item.customerVisible !== false,
      optional: Boolean(item.optional),
    };
  }

  const paintMaterials = useMemo(
    () => materials.filter((material) => ['paint', 'primer'].includes(String(material.category || '').toLowerCase())),
    [materials],
  );
  const ratesByCategory = useMemo(() => {
    const groups = new Map<string, ProductionRate[]>();
    rates.forEach((rate) => {
      const category = labelize(rate.category || 'Other');
      groups.set(category, [...(groups.get(category) || []), rate]);
    });
    return Array.from(groups.entries());
  }, [rates]);
  const selectedLead = leads.find((lead) => lead.id === leadId);
  const formIdentity = JSON.stringify({ leadId, jobsite, estimateType, rooms, adjustments, paintMaterialId, primerMaterialId, discount });
  const currentFormIdentity = useRef(formIdentity);
  currentFormIdentity.current = formIdentity;

  useEffect(() => {
    if (!selectedLead || editingEstimate) return;
    setJobsite({
      streetAddress: selectedLead.streetAddress || '',
      city: selectedLead.city || '',
      state: selectedLead.state || '',
      postalCode: String(selectedLead.postalCode || '').slice(0, 5),
    });
  }, [selectedLead?.id, editingEstimate?.id]);

  function selectLead(nextLeadId: string) {
    setLeadId(nextLeadId);
    const lead = leads.find((item) => item.id === nextLeadId);
    if (lead) {
      setJobsite({
        streetAddress: lead.streetAddress || '',
        city: lead.city || '',
        state: lead.state || '',
        postalCode: String(lead.postalCode || '').slice(0, 5),
      });
    }
  }

  const previewState = useMemo(() => {
    const request = previewRequest();
    const key = JSON.stringify(request);
    try {
      const unpriced = rooms.flatMap((room) => room.surfaces).find((surface) => !surface.rateId);
      if (unpriced) throw new EstimationInputError(unpriced.id + '.productionRateId', 'Select an active substrate for this template item before pricing.');
      const preview = serverPreview?.key === key ? serverPreview : calculateProductionPreview(request, { rates, materials, settings });
      return { key, request, ...preview, error: '', errorField: '' };
    } catch (error) {
      return { key, request, calculation: null, resolvedInput: null, error: error instanceof Error ? error.message : 'Check the scope measurements and product settings.', errorField: error instanceof EstimationInputError ? error.field : '' };
    }
  }, [rooms, adjustments, rates, materials, settings, paintMaterialId, primerMaterialId, discount, serverPreview]);
  const currentPreviewKey = useRef(previewState.key);
  currentPreviewKey.current = previewState.key;
  const totals = useMemo(() => calculateTotals(previewState.calculation), [previewState, estimateType]);
  const surfaceItems = totals.items.filter((item) => item.kind === 'surface' && item.customerVisible !== false);
  const editingSent = editingEstimate?.status === 'sent';

  function updateRoom(roomId: string, patch: Partial<Room>) {
    setRooms((current) => current.map((room) => room.id === roomId ? { ...room, ...patch } : room));
  }

  function updateSurface(roomId: string, surfaceId: string, patch: Partial<Surface>) {
    setRooms((current) => current.map((room) => room.id !== roomId ? room : {
      ...room,
      surfaces: room.surfaces.map((surface) => surface.id === surfaceId ? { ...surface, ...patch } : surface),
    }));
  }

  function updateSurfaceColor(roomId: string, surfaceId: string, colorName: string) {
    const normalized = colorName.trim().toLowerCase();
    const catalogColor = catalogColors.find((color) => {
      const name = String(color.name || '').trim().toLowerCase();
      const code = String(color.colorCode || '').trim().toLowerCase();
      return normalized === name || normalized === `${name} (${code})` || normalized === `${name} ${code}`;
    });
    updateSurface(roomId, surfaceId, {
      colorName,
      ...(catalogColor?.colorCode ? { colorCode: catalogColor.colorCode, colorStatus: 'Selected' } : {}),
    });
  }

  function addRoom(name = defaultRoomName(), surfaces: Surface[] = []) {
    setRooms((current) => [...current, {
      id: uid('room'),
      name,
      kind: estimateType === 'exterior' ? 'exterior' : 'interior',
      surfaces,
    }]);
    setStarterSkipped(true);
  }

  function defaultRoomName() {
    const next = rooms.length + 1;
    if (estimateType === 'exterior') return `Exterior elevation ${next}`;
    if (estimateType === 'cabinet') return `Cabinet area ${next}`;
    if (estimateType === 'custom') return `Work area ${next}`;
    return `Room ${next}`;
  }

  function addSurface(roomId: string, template: Partial<Surface> = {}) {
    const firstRate = rates[0];
    const next: Surface = {
      id: uid('surface'),
      rateId: template.rateId || firstRate?.id || '',
      label: template.label || labelize(firstRate?.surfaceType || firstRate?.category || 'Substrate'),
      width: template.width || '',
      height: template.height || '',
      quantity: template.quantity || '',
      coatingWidthInches: template.coatingWidthInches ?? coatingDefaults(rates.find((rate) => rate.id === (template.rateId || firstRate?.id))).coatingWidthInches,
      coatingSqFtPerItem: template.coatingSqFtPerItem ?? coatingDefaults(rates.find((rate) => rate.id === (template.rateId || firstRate?.id))).coatingSqFtPerItem,
      coats: template.coats || num(firstRate?.coats, 2),
      prepLevel: template.prepLevel || 'standard',
      applicationMethod: template.applicationMethod || defaultMethod(firstRate),
      prepAdjustmentHours: template.prepAdjustmentHours || '',
      paintAdjustmentHours: template.paintAdjustmentHours || '',
      materialId: template.materialId || '',
      colorName: template.colorName || '',
      colorCode: template.colorCode || '',
      colorStatus: template.colorStatus || 'TBD',
      crewNote: template.crewNote || '',
      customerVisible: template.customerVisible ?? true,
      optional: template.optional || false,
    };
    setRooms((current) => current.map((room) => room.id === roomId ? { ...room, surfaces: [...room.surfaces, next] } : room));
  }

  function findRate(kind: string) {
    return rates.find((rate) => rateKind(rate) === kind) || rates.find((rate) => rateText(rate).includes(kind)) || rates[0];
  }

  function makeSurface(kind: string, label: string, quantity: number, extra: Partial<Surface> = {}): Surface {
    const rate = findRate(kind);
    return {
      id: uid('surface'),
      rateId: rate?.id || '',
      label,
      width: '',
      height: '',
      quantity: quantity ? String(Number(quantity.toFixed(1))) : '',
      ...coatingDefaults(rate),
      coats: num(rate?.coats, 2),
      prepLevel: 'standard',
      applicationMethod: defaultMethod(rate),
      prepAdjustmentHours: '',
      paintAdjustmentHours: '',
      materialId: '',
      colorName: '',
      colorCode: '',
      colorStatus: 'TBD',
      crewNote: '',
      customerVisible: true,
      optional: false,
      ...extra,
    };
  }

  function buildInteriorScope() {
    const assumptions = {
      bedrooms: num(interiorAssumptions.bedrooms),
      bathrooms: num(interiorAssumptions.bathrooms),
      livingRooms: num(interiorAssumptions.livingRooms),
      diningRooms: num(interiorAssumptions.diningRooms),
      kitchens: num(interiorAssumptions.kitchens),
      hallways: num(interiorAssumptions.hallways),
      closets: num(interiorAssumptions.closets),
      ceilingHeight: num(interiorAssumptions.ceilingHeight, 9),
      trimScope: interiorAssumptions.trimScope,
      includeCeilings: interiorAssumptions.includeCeilings,
      includeDoors: interiorAssumptions.includeDoors,
    };
    const templates = [
      { name: 'Bedroom', count: assumptions.bedrooms, length: 12, width: 12, windows: 1, doors: 1 },
      { name: 'Bathroom', count: assumptions.bathrooms, length: 8, width: 8, windows: 0.5, doors: 1 },
      { name: 'Living room', count: assumptions.livingRooms, length: 18, width: 16, windows: 2, doors: 1 },
      { name: 'Dining room', count: assumptions.diningRooms, length: 14, width: 12, windows: 1.5, doors: 1 },
      { name: 'Kitchen', count: assumptions.kitchens, length: 14, width: 12, windows: 1, doors: 1 },
      { name: 'Hallway', count: assumptions.hallways, length: 14, width: 4, windows: 0, doors: 2 },
      { name: 'Closet', count: assumptions.closets, length: 6, width: 4, windows: 0, doors: 1 },
    ];
    const nextRooms: Room[] = [];
    templates.forEach((template) => {
      for (let index = 1; index <= template.count; index += 1) {
        const label = template.count > 1 ? `${template.name} ${index}` : template.name;
        const perimeter = (template.length + template.width) * 2;
        const openings = template.windows * 15 + template.doors * 21;
        const walls = Math.max(0, perimeter * assumptions.ceilingHeight - openings);
        const ceiling = template.length * template.width;
        const trimMultiplier = assumptions.trimScope === 'none' ? 0 : assumptions.trimScope === 'base' ? 1 : assumptions.trimScope === 'base-casing' ? 1.25 : 1.55;
        const trim = perimeter * trimMultiplier + template.doors * 14 + template.windows * 16;
        const doors = assumptions.includeDoors ? Math.max(1, Math.round(template.doors)) : 0;
        const surfaces = [
          makeSurface('walls', 'Walls', walls),
          assumptions.includeCeilings ? makeSurface('ceilings', 'Ceiling', ceiling, { width: String(template.length), height: String(template.width) }) : null,
          trim > 0 ? makeSurface('trim', 'Trim', trim) : null,
          doors > 0 ? makeSurface('doors', 'Doors', doors) : null,
        ].filter(Boolean) as Surface[];
        nextRooms.push({
          id: uid('room'),
          name: label,
          kind: 'interior',
          generated: true,
          metrics: { length: template.length, width: template.width, perimeter, height: assumptions.ceilingHeight, windows: template.windows, doors: template.doors },
          surfaces,
        });
      }
    });
    if (!nextRooms.length) {
      window.showToast?.('Add at least one room count before building starter scope.', 'error');
      return;
    }
    setRooms(nextRooms);
    setEstimateType('interior');
    setStarterCollapsed(true);
    setStarterSkipped(false);
    setTemplateApplied(false);
    window.showToast?.(`Built ${nextRooms.length} room${nextRooms.length === 1 ? '' : 's'} with itemized substrates.`, 'success');
  }

  function buildExteriorScope() {
    const perimeter = num(exteriorAssumptions.perimeter);
    if (perimeter <= 0) {
      window.showToast?.('Enter house perimeter before building exterior scope.', 'error');
      return;
    }
    const stories = num(exteriorAssumptions.stories, 1);
    const wallHeight = num(exteriorAssumptions.wallHeight, 10);
    const roofline = num(exteriorAssumptions.rooflineFactor, 1);
    const windows = num(exteriorAssumptions.windows);
    const doors = num(exteriorAssumptions.doors);
    const corners = num(exteriorAssumptions.corners, 4);
    const soffitDepth = num(exteriorAssumptions.soffitDepth, 2);
    const siding = Math.max(0, perimeter * stories * wallHeight - windows * 15 - doors * 24);
    const roofRun = perimeter * roofline;
    const next: Room = {
      id: uid('room'),
      name: 'Exterior',
      kind: 'exterior',
      generated: true,
      metrics: { perimeter, height: wallHeight * stories, windows, doors },
      surfaces: [
        makeSurface('exterior_body', 'Siding', siding),
        makeSurface('soffit', 'Soffits', roofRun * soffitDepth),
        makeSurface('fascia', 'Fascia', roofRun),
        makeSurface('trim', 'Window and door trim', windows * 16 + doors * 18),
        makeSurface('corner_boards', 'Corner boards', corners * wallHeight * stories),
      ],
    };
    setEstimateType('exterior');
    setRooms([next]);
    setStarterCollapsed(true);
    setStarterSkipped(false);
    setTemplateApplied(false);
    window.showToast?.('Built exterior starter scope from house assumptions.', 'success');
  }

  function useRoomMetrics(roomId: string, surfaceId: string) {
    const room = rooms.find((item) => item.id === roomId);
    const surface = room?.surfaces.find((item) => item.id === surfaceId);
    const rate = rates.find((item) => item.id === surface?.rateId);
    const kind = rateKind(rate);
    if (!room?.metrics || !surface) return;
    if (kind === 'ceilings') updateSurface(roomId, surfaceId, { width: String(room.metrics.length || ''), height: String(room.metrics.width || ''), quantity: '' });
    else if (kind === 'walls') updateSurface(roomId, surfaceId, { width: String(room.metrics.perimeter || ''), height: String(room.metrics.height || ''), quantity: '' });
    else if (kind === 'trim') updateSurface(roomId, surfaceId, { width: String(room.metrics.perimeter || ''), quantity: '' });
  }

  function measuredQuantity(surface: Surface, rate?: ProductionRate | null) {
    const measurement = resolveEstimationMeasurement({
      unit: estimationUnit(String(rate?.unit || 'sqft')), width: surface.width, height: surface.height, quantity: surface.quantity,
    });
    return { width: Number(measurement.width), height: Number(measurement.height), quantity: Number(measurement.quantity) };
  }

  function surfaceMaterialId(surface: Surface) {
    return surface.materialId || (surface.prepLevel === 'heavy' ? primerMaterialId : paintMaterialId);
  }

  function previewRequest(): ProductionPreviewRequest {
    return {
      items: rooms.flatMap((room) => room.surfaces.filter((surface) => surface.rateId).map((surface) => ({
        id: surface.id, productionRateId: surface.rateId,
        width: surface.width, height: surface.height, quantity: surface.quantity,
        coats: surface.coats, prepLevel: surface.prepLevel, applicationMethod: surface.applicationMethod,
        prepAdjustmentHours: surface.prepAdjustmentHours, paintAdjustmentHours: surface.paintAdjustmentHours,
        coatingWidthInches: surface.coatingWidthInches, coatingSqFtPerItem: surface.coatingSqFtPerItem,
        materialId: surfaceMaterialId(surface), colorName: surface.colorName, colorCode: surface.colorCode,
        optional: surface.optional,
      }))),
      adjustments: adjustments.filter((row) => row.desc.trim()).map((row) => ({
        id: row.id, quantity: row.qty || '0', unitPrice: row.rate || '0', optional: row.optional,
      })),
      discount: discount || '0',
    };
  }

  function calculateTotals(calculation: EstimationResult | null): EstimateTotals {
    const items: EstimateLineItem[] = [];
    if (!calculation) return { items, hours: 0, labor: 0, materials: 0, materialCost: 0, adjustments: 0, optionalTotal: 0, subtotal: 0, discount: 0, tax: 0, total: 0 };
    const calculated = new Map(calculation.items.map((item) => [item.id, item]));
    rooms.forEach((room) => {
      room.surfaces.forEach((surface) => {
        const rate = rates.find((item) => item.id === surface.rateId);
        const line = calculated.get(surface.id);
        if (!rate || !line || Number(line.quantity) <= 0) return;
        const quantity = measuredQuantity(surface, rate);
        const method = applicationMethods[surface.applicationMethod] || applicationMethods.brush_roll;
        const coats = surface.coats;
        const itemHours = Number(line.hours);
        const selectedMaterial = materials.find((material) => material.id === surfaceMaterialId(surface));
        items.push({
          calculationItemId: surface.id,
          calculatedSubtotalMinor: line.subtotalMinor,
          desc: `${room.name}: ${surface.label || labelize(rate.surfaceType || rate.category)}`,
          qty: 1,
          rate: dollars(line.subtotalMinor),
          category: String(rate.unit || 'sqft'),
          kind: 'surface',
          customerVisible: surface.customerVisible,
          optional: surface.optional,
          productionRateId: rate.id,
          roomName: room.name,
          surfaceName: surface.label,
          dimensions: {
            ...quantity, unit: String(rate.unit || 'sqft'),
            coatingWidthInches: surface.coatingWidthInches ? num(surface.coatingWidthInches) : undefined,
            coatingSqFtPerItem: surface.coatingSqFtPerItem ? num(surface.coatingSqFtPerItem) : undefined,
          },
          notes: `${quantity.quantity.toFixed(1)} ${rate.unit || 'sqft'}, ${coats} coat${coats === 1 ? '' : 's'}, ${method.label}, ${surface.prepLevel} prep, ${itemHours.toFixed(1)} labor hours`,
          labor: {
            hours: itemHours,
            rate: num(rate.hourlyRate, num(settings.defaultLaborRate, 65)),
            cost: dollars(line.laborMinor),
            coats,
            prepLevel: surface.prepLevel,
            applicationMethod: surface.applicationMethod,
            productionRatePerHour: num(rate.ratePerHour) * method.productivity,
            prepAdjustmentHours: num(surface.prepAdjustmentHours),
            paintAdjustmentHours: num(surface.paintAdjustmentHours),
          },
          material: selectedMaterial ? {
            id: selectedMaterial.id,
            name: selectedMaterial.name || '',
            brand: selectedMaterial.brand || '',
            unit: selectedMaterial.unit || '',
            quantity: Number(line.allocatedPacks || '0'),
            costPerUnit: num(selectedMaterial.costPerUnit),
            markupPercent: num(selectedMaterial.markupPercent, num(settings.materialMarkupPercent)),
            price: dollars(line.materialMinor),
            acquisitionCost: dollars(line.materialCostMinor),
            purchaseGroupId: line.materialGroupId,
            theoreticalGallons: line.theoreticalGallons,
            colorName: surface.colorName,
            colorCode: surface.colorCode,
            status: surface.colorStatus,
            crewNote: surface.crewNote,
          } : undefined,
        });
      });
    });
    adjustments.forEach((row) => {
      const line = calculated.get(row.id);
      const qty = num(row.qty);
      const rate = num(row.rate);
      if (!line || qty <= 0) return;
      items.push({ calculationItemId: row.id, calculatedSubtotalMinor: line.subtotalMinor, desc: row.desc, qty, rate, category: row.category, kind: 'line_item', customerVisible: row.customerVisible, optional: row.optional, notes: 'Estimate-specific line item' });
    });
    const summary = calculation.totals;
    return {
      items,
      hours: Number(summary.hours), labor: dollars(summary.laborMinor),
      materials: dollars(summary.materialMinor), materialCost: dollars(summary.materialCostMinor),
      adjustments: dollars(summary.adjustmentMinor), optionalTotal: dollars(summary.optionalSubtotalMinor),
      subtotal: dollars(summary.subtotalMinor), discount: dollars(summary.discountMinor),
      tax: dollars(summary.taxMinor), total: dollars(summary.totalMinor),
    };
  }

  function buildPackages(calculation = previewState.calculation, resolvedInput = previewState.resolvedInput) {
    const calculatedTotals = calculateTotals(calculation);
    if (!calculatedTotals.items.length || !calculation) return [];
    return [{
      calculationVersion: calculation.calculationVersion,
      productionInput: previewState.request,
      calculationInput: resolvedInput,
      name: 'proposal',
      estimateType,
      subtotal: calculatedTotals.subtotal, discount: calculatedTotals.discount,
      tax: calculatedTotals.tax, total: calculatedTotals.total, optionalTotal: calculatedTotals.optionalTotal,
      items: calculatedTotals.items, lineItems: calculatedTotals.items,
    }];
  }

  async function authoritativePreview() {
    const response = await apiJson<{ data: { calculation: EstimationResult; resolvedInput: EstimationRequest } }>('/v1/production-rates/calculate', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(previewState.request),
    });
    if (currentPreviewKey.current !== previewState.key) throw new Error('Scope changed while pricing was checked. Review the current scope again.');
    setServerPreview({ key: previewState.key, ...response.data });
    return response.data;
  }

  async function reviewProposal() {
    if (!leadId) return window.showToast?.('Select a customer first', 'error');
    if (previewState.error) return window.showToast?.(previewState.error, 'error');
    if (!buildPackages().length) return window.showToast?.('Add at least one measured substrate.', 'error');
    setIsReviewing(true);
    try {
      await authoritativePreview();
      setShowPreview(true);
    } catch (error) {
      window.showToast?.(error instanceof Error ? error.message : 'Could not verify current pricing. Try again.', 'error');
    } finally {
      setIsReviewing(false);
    }
  }

  async function persistEstimate(statusValue: 'draft' | 'sent') {
    if (saveLockRef.current) return;
    if (previewState.error) {
      window.showToast?.(previewState.error, 'error');
      return;
    }
    if (!leadId) {
      window.showToast?.('Select a customer first', 'error');
      return;
    }
    const effectiveStatus = editingSent ? 'sent' : statusValue;
    let packages = buildPackages();
    if (effectiveStatus !== 'draft' && !packages.length) {
      window.showToast?.('Add at least one measured substrate.', 'error');
      return;
    }
    saveLockRef.current = true;
    setIsSaving(true);
    setSaveStatus(effectiveStatus === 'draft' ? 'Saving draft estimate...' : editingSent ? 'Sending update email...' : 'Creating and emailing estimate...');
    try {
      let verified = { calculation: previewState.calculation, resolvedInput: previewState.resolvedInput };
      if (packages.length) {
        verified = await authoritativePreview();
        if (effectiveStatus === 'sent' && JSON.stringify(verified.calculation) !== JSON.stringify(previewState.calculation)) {
          setShowPreview(true);
          setSaveStatus('Pricing changed. Review the updated proposal before sending.');
          window.showToast?.('Pricing changed. Review the updated total.', 'error');
          return;
        }
        packages = buildPackages(verified.calculation, verified.resolvedInput);
      }
      if (currentFormIdentity.current !== formIdentity) throw new Error('The scope changed while saving. Review it before continuing.');
      const isEditing = Boolean(editingEstimate?.id || estimateId);
      const targetId = editingEstimate?.id || estimateId;
      const saveIdentity = formIdentity + ':' + effectiveStatus;
      const pending = pendingSaveRef.current;
      let response: { data: Estimate };
      const reason = pending && pending.estimate.id === targetId ? pending.reason : editingSent ? 'updated' : 'sent';
      if (pending?.identity === saveIdentity && JSON.stringify(pending.calculation) === JSON.stringify(verified.calculation)) {
        response = { data: pending.estimate };
      } else {
        if (isEditing && !editingEstimate?.updatedAt) throw new Error('Reload this estimate before saving so its current version can be checked.');
        const path = isEditing ? `/v1/estimates/${targetId}` : '/v1/estimates';
        const body = JSON.stringify({ leadId, ...jobsite, packages, status: effectiveStatus, ...(isEditing ? { expectedUpdatedAt: editingEstimate!.updatedAt } : {}) });
        saveAttemptRef.current = estimationSaveAttempt(saveAttemptRef.current, path + ':' + body, () => crypto.randomUUID());
        response = await apiJson<{ data: Estimate }>(path, {
          method: isEditing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': saveAttemptRef.current.key }, body,
        });
        saveAttemptRef.current = null;
        setEditingEstimate(response.data);
      }
      const persistedPackage = response.data.packages?.[0];
      const persistedCalculation = persistedPackage?.calculationSnapshot || verified.calculation;
      if (persistedCalculation) pendingSaveRef.current = { identity: saveIdentity, estimate: response.data, calculation: persistedCalculation, reason };
      if (persistedPackage?.calculationSnapshot && persistedPackage.calculationInput) {
        setServerPreview({ key: previewState.key, calculation: persistedPackage.calculationSnapshot, resolvedInput: persistedPackage.calculationInput });
      }
      const savedPriceChanged = verified.calculation && (
        JSON.stringify(persistedCalculation) !== JSON.stringify(verified.calculation)
        || (persistedPackage?.total != null && minor(decimal(persistedPackage.total, 'total', { scale: 2 }), 'total') !== verified.calculation.totals.totalMinor)
      );
      if (currentFormIdentity.current !== formIdentity || (effectiveStatus === 'sent' && savedPriceChanged)) {
        setShowPreview(true);
        setSaveStatus('Estimate saved. Review the updated scope and pricing before sending.');
        window.showToast?.('Estimate saved. Review the updated price before sending.', 'error');
        return;
      }
      let sendResult: { previewUrl?: string } | null = null;
      if (effectiveStatus === 'sent') {
        const body = JSON.stringify({ reason });
        emailAttemptRef.current = estimationSaveAttempt(emailAttemptRef.current, response.data.id + ':' + response.data.updatedAt + ':' + body, () => crypto.randomUUID());
        const sent = await apiJson<{ data?: { previewUrl?: string } }>(`/v1/estimates/${response.data.id}/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': emailAttemptRef.current.key,
          },
          body,
        });
        emailAttemptRef.current = null;
        sendResult = sent.data || null;
      }
      pendingSaveRef.current = null;
      window.showToast?.(effectiveStatus === 'draft' ? 'Draft saved' : reason === 'updated' ? 'Estimate update emailed' : 'Estimate emailed', 'success');
      setShowPreview(false);
      if (effectiveStatus === 'draft') navigate('/estimates?status=draft');
      else {
        const previewUrl = sendResult?.previewUrl || response.data.customerPreviewUrl || response.data.publicUrl || `/estimates/${response.data.id}`;
        const nextUrl = new URL(previewUrl, window.location.origin);
        if (nextUrl.origin === window.location.origin) {
          navigate(`${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`, { replace: true });
        } else {
          window.location.replace(nextUrl.toString());
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save estimate';
      setSaveStatus(message);
      window.showToast?.(message, 'error');
    } finally {
      saveLockRef.current = false;
      setIsSaving(false);
    }
  }

  function updateAdjustment(id: string, patch: Partial<Adjustment>) {
    setAdjustments((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function readiness() {
    const missingCustomer = leadId ? 0 : 1;
    const zeroQuantity = rooms.flatMap((room) => room.surfaces).filter((surface) => {
      const rate = rates.find((item) => item.id === surface.rateId);
      try {
        return !rate || measuredQuantity(surface, rate).quantity <= 0;
      } catch {
        return true;
      }
    }).length;
    const missingProduct = surfaceItems.filter((item) => !item.material?.id).length;
    const missingColor = surfaceItems.filter((item) => !item.material?.colorName || !item.material?.colorCode || item.material?.status === 'TBD').length;
    return { missingCustomer, zeroQuantity, missingProduct, missingColor };
  }

  const ready = readiness();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl py-5 sm:py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-24 rounded-lg bg-gray-200" />
          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <div className="h-96 rounded-lg bg-gray-200" />
            <div className="h-64 rounded-lg bg-gray-200" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl py-5 sm:py-8">
      <datalist id="crewmodo-catalog-colors">
        {catalogColors.map((color) => (
          <option key={color.id} value={[color.name, color.colorCode ? `(${color.colorCode})` : ''].filter(Boolean).join(' ')}>
            {[color.supplierName, color.family].filter(Boolean).join(' - ')}
          </option>
        ))}
      </datalist>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="pf-page-copy max-w-2xl">
            Build pricing from rooms, substrates, prep, production rates, paint products, and proposal options.
          </p>
          {editingSent && (
            <p className="pf-meta mt-2 rounded-lg border border-blue-100 bg-blue-50 p-3 text-blue-950">
              This sent proposal is still unsigned. Updates keep the same preview link current and email the customer. Once signed, use change orders or a new agreement.
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Link to="/templates" className="btn-secondary btn-sm justify-center">Templates</Link>
          <Link to="/estimates/new" className="btn-secondary btn-sm justify-center">Quick estimate</Link>
        </div>
      </div>

      {setupError && (
        <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          <p className="pf-row-title">Estimator setup could not load</p>
          <p className="pf-copy mt-1">{setupError}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-primary btn-sm" onClick={loadSetup}>Retry</button>
            <Link to="/settings" className="btn-secondary btn-sm">Check settings</Link>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 space-y-4">
          <Card padding="md">
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className="form-label">Customer</span>
                <select className="input mt-1" value={leadId} onChange={(event) => selectLead(event.target.value)}>
                  <option value="">Select customer...</option>
                  {leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.name}</option>)}
                </select>
              </label>
              <label>
                <span className="form-label">Estimate type</span>
                <select
                  className="input mt-1"
                  value={estimateType}
                  onChange={(event) => {
                    setEstimateType(event.target.value as EstimateType);
                    setStarterCollapsed(false);
                    setStarterSkipped(false);
                  }}
                >
                  <option value="interior">Interior repaint</option>
                  <option value="exterior">Exterior repaint</option>
                  <option value="cabinet">Cabinets / specialty</option>
                  <option value="custom">Custom / commercial</option>
                </select>
              </label>
            </div>
            <div className="mt-4 rounded-lg border bg-gray-50 p-3">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="pf-row-title">Jobsite address</p>
                  <p className="pf-meta">Defaults from the customer, but proposals can use a different work address.</p>
                </div>
                {selectedLead && (
                  <button
                    type="button"
                    className="btn-text btn-sm self-start"
                    onClick={() => setJobsite({
                      streetAddress: selectedLead.streetAddress || '',
                      city: selectedLead.city || '',
                      state: selectedLead.state || '',
                      postalCode: String(selectedLead.postalCode || '').slice(0, 5),
                    })}
                  >
                    Use customer address
                  </button>
                )}
              </div>
              <AddressFields
                streetLabel="Street address"
                value={jobsite}
                onChange={setJobsite}
                className="mt-3 grid gap-3"
              />
            </div>
          </Card>

          <Card padding="none">
            <div className="border-b p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardHeader className="mb-0" title="Rooms & Scope" description="Add rooms, elevations, or work spaces, then define substrates inside each one." />
                <button className="btn-secondary btn-sm" onClick={() => addRoom()}>
                  <Icon name="plus" className="h-4 w-4" />
                  Add room or space
                </button>
              </div>
            </div>

            {!templateApplied && !starterCollapsed && !starterSkipped && (
              <div className="border-b bg-gray-50 p-4">
                {estimateType === 'exterior' ? (
                  <ExteriorStarter assumptions={exteriorAssumptions} setAssumptions={setExteriorAssumptions} onBuild={buildExteriorScope} onSkip={() => setStarterSkipped(true)} />
                ) : (
                  <InteriorStarter assumptions={interiorAssumptions} setAssumptions={setInteriorAssumptions} onBuild={buildInteriorScope} onSkip={() => setStarterSkipped(true)} />
                )}
              </div>
            )}

            {!templateApplied && (starterCollapsed || starterSkipped) && (
              <div className="border-b bg-blue-50/70 p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="pf-copy text-blue-950">
                    {starterSkipped ? 'Starter scope skipped. Add rooms and substrates manually.' : 'Starter scope added. Refine measurements, products, and options below.'}
                  </p>
                  <button className="btn-text btn-sm" onClick={() => { setStarterCollapsed(false); setStarterSkipped(false); setTemplateApplied(false); }}>Review</button>
                </div>
              </div>
            )}

            <div className="space-y-4 p-4">
              {rooms.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 p-5 text-center">
                  <p className="pf-row-title">Start with a room, exterior elevation, or work space.</p>
                  <p className="pf-meta mt-1">{templateApplied ? 'Add spaces manually or choose another template from Templates.' : 'Use starter scope for a generated first pass, or add a space manually.'}</p>
                </div>
              ) : rooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  ratesByCategory={ratesByCategory}
                  rates={rates}
                  materials={paintMaterials}
                  catalogColors={catalogColors}
                  updateRoom={updateRoom}
                  updateSurface={updateSurface}
                  updateSurfaceColor={updateSurfaceColor}
                  removeRoom={(roomId) => setRooms((current) => current.filter((item) => item.id !== roomId))}
                  addSurface={addSurface}
                  removeSurface={(roomId, surfaceId) => setRooms((current) => current.map((item) => item.id === roomId ? { ...item, surfaces: item.surfaces.filter((surface) => surface.id !== surfaceId) } : item))}
                  useRoomMetrics={useRoomMetrics}
                  surfaceTotal={(surface) => {
                    const line = totals.items.find((item) => item.calculationItemId === surface.id);
                    return previewState.error ? '--' : line ? formatMoney(line.rate || 0) : '$0.00';
                  }}
                  calculationError={{ field: previewState.errorField, message: previewState.error }}
                />
              ))}
            </div>
          </Card>

          <Card padding="none">
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
              <CardHeader className="mb-0" title="Paint Schedule" description="Production handoff by substrate: product, color, status, and order units." />
              <span className="pf-row-title">{surfaceItems.length} substrate{surfaceItems.length === 1 ? '' : 's'}</span>
            </div>
            <div className="space-y-2 p-4">
              {previewState.calculation && previewState.calculation.purchaseGroups.some((group) => group.packCount > 0) && (
                <div className="mb-4 space-y-2 border-b pb-4">
                  <h3 className="pf-row-title">Paint order</h3>
                  {previewState.calculation.purchaseGroups.filter((group) => group.packCount > 0).map((group) => {
                    const product = materials.find((material) => material.id === group.productId);
                    return (
                      <div key={group.id} className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="pf-supporting break-words">{[product?.brand, product?.name].filter(Boolean).join(' ')}{!group.included ? ' (option)' : ''}</p>
                          <p className="pf-meta break-words">{[group.colorName, group.colorCode].filter(Boolean).join(' ') || 'Color TBD'}</p>
                        </div>
                        <span className="pf-value shrink-0">{group.packCount} {product?.unit || 'pack'}{group.packCount === 1 ? '' : 's'} · {group.purchasedGallons} gal</span>
                      </div>
                    );
                  })}
                  {previewState.calculation.warnings.some((warning) => warning.code === 'UNKNOWN_COLOR') && <p className="pf-helper">Unspecified colors are budgeted separately.</p>}
                </div>
              )}
              {surfaceItems.length === 0 ? (
                <p className="pf-supporting rounded-lg border border-dashed p-3">Add scope lines to build the paint schedule.</p>
              ) : surfaceItems.map((item) => (
                <div key={`${item.roomName}-${item.surfaceName}-${item.productionRateId}`} className="rounded-lg border p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="pf-value">{item.desc}</p>
                      <p className="pf-label-small">{num(item.dimensions?.quantity).toFixed(1)} {item.dimensions?.unit}</p>
                    </div>
                    <StatusBadge status={item.material?.status || 'TBD'} />
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <PaintScheduleCell label="Product" value={[item.material?.brand, item.material?.name].filter(Boolean).join(' ') || 'Missing product'} />
                    <PaintScheduleCell label="Color" value={[item.material?.colorName, item.material?.colorCode].filter(Boolean).join(' ') || 'TBD'} />
                    <PaintScheduleCell label="Crew note" value={item.material?.crewNote || 'None'} />
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card padding="none">
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
              <CardHeader className="mb-0" title="Add-ons & Adjustments" description="Trip charges, repairs, discounts, or customer-selectable options." />
              <button
                className="btn-primary btn-sm"
                onClick={() => setAdjustments((current) => [...current, { id: uid('adj'), desc: '', qty: '1', rate: '', category: 'other', customerVisible: true, optional: false }])}
              >
                Add line
              </button>
            </div>
            <div className="space-y-3 p-4">
              {adjustments.length === 0 ? <p className="pf-supporting">No add-ons or adjustments yet.</p> : adjustments.map((item) => (
                <div key={item.id} className="grid gap-2 rounded-lg border bg-gray-50 p-3 sm:grid-cols-[minmax(0,1fr)_5rem_7rem_auto] sm:items-end">
                  <label>
                    <span className="form-label">Description</span>
                    <input className="input mt-1" value={item.desc} onChange={(event) => updateAdjustment(item.id, { desc: event.target.value })} placeholder="Extra prep, repairs, trip charge" />
                  </label>
                  <label>
                    <span className="form-label">Qty</span>
                    <input className="input mt-1" type="number" inputMode="decimal" step="0.25" value={item.qty} onChange={(event) => updateAdjustment(item.id, { qty: event.target.value })} onFocus={(event) => event.currentTarget.select()} />
                  </label>
                  <label>
                    <span className="form-label">Price</span>
                    <input className="input mt-1" type="number" inputMode="decimal" step="0.01" value={item.rate} onChange={(event) => updateAdjustment(item.id, { rate: event.target.value })} onFocus={(event) => event.currentTarget.select()} />
                  </label>
                  <div className="flex items-center justify-between gap-2">
                    <label className="pf-inline-option"><input type="checkbox" checked={item.customerVisible} onChange={(event) => updateAdjustment(item.id, { customerVisible: event.target.checked })} />Show</label>
                    <label className="pf-inline-option"><input type="checkbox" checked={item.optional} onChange={(event) => updateAdjustment(item.id, { optional: event.target.checked })} />Option</label>
                    <button className="btn-text btn-sm text-red-700" onClick={() => setAdjustments((current) => current.filter((row) => row.id !== item.id))}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 self-start">
          <Card>
            <CardHeader title="Estimate Summary" />
            {previewState.error && !rooms.some((room) => room.surfaces.some((surface) => previewState.errorField.startsWith(`${surface.id}.`))) && <p id="estimate-calculation-error" className="pf-field-error mb-3" role="alert">{previewState.error}</p>}
            <div className="space-y-2" aria-label="Proposal pricing" aria-invalid={Boolean(previewState.error)}>
              <SummaryRow label="Labor hours" value={totals.hours.toFixed(1)} />
              <SummaryRow label="Labor price" value={previewState.error ? '--' : formatMoney(totals.labor)} />
              <SummaryRow label="Materials price" value={previewState.error ? '--' : formatMoney(totals.materials)} />
              <SummaryRow label="Materials cost budget" value={previewState.error ? '--' : formatMoney(totals.materialCost)} />
              <SummaryRow label="Adjustments" value={formatMoney(totals.adjustments)} />
              <SummaryRow label="Customer options" value={formatMoney(totals.optionalTotal)} />
              <label className="flex items-center justify-between gap-3 border-t pt-2">
                <span className="pf-meta">Discount</span>
                <input className={`input w-28 text-right ${previewState.errorField === 'discount' ? 'pf-field-invalid' : ''}`} aria-invalid={previewState.errorField === 'discount'} aria-describedby={previewState.errorField === 'discount' ? 'estimate-calculation-error' : undefined} type="number" min="0" step="0.01" inputMode="decimal" value={discount} onChange={(event) => setDiscount(event.target.value)} onFocus={(event) => event.currentTarget.select()} />
              </label>
              <SummaryRow label="Tax" value={formatMoney(totals.tax)} />
              <div className="flex justify-between border-t pt-2"><span className="pf-section-title">Base proposal total</span><span className="pf-section-title text-blue-700">{previewState.error ? '--' : formatMoney(totals.total)}</span></div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Paint Products" />
            <div className="space-y-3">
              <label>
                <span className="form-label">Wall/finish paint</span>
                <select className="input mt-1" value={paintMaterialId} onChange={(event) => setPaintMaterialId(event.target.value)}>
                  <option value="">Use pricing default</option>
                  {paintMaterials.map((material) => <option key={material.id} value={material.id}>{materialLabel(material)}</option>)}
                </select>
              </label>
              <label>
                <span className="form-label">Primer</span>
                <select className="input mt-1" value={primerMaterialId} onChange={(event) => setPrimerMaterialId(event.target.value)}>
                  <option value="">Use pricing default</option>
                  {paintMaterials.map((material) => <option key={material.id} value={material.id}>{materialLabel(material)}</option>)}
                </select>
              </label>
              <p className="pf-meta">{paintMaterials.length ? 'Coverage, unit cost, and markup are pulled from Materials.' : 'Add paint and primer products in Materials to calculate product-specific costs.'}</p>
            </div>
          </Card>

          <Card>
            <CardHeader title="Production Readiness" />
            <div className="space-y-2">
              <ReadinessRow label="Missing customer" count={ready.missingCustomer} />
              <ReadinessRow label="Zero-quantity substrates" count={ready.zeroQuantity} />
              <ReadinessRow label="Missing products" count={ready.missingProduct} />
              <ReadinessRow label="Color selections needed" count={ready.missingColor} />
            </div>
            <div className="mt-4 grid gap-2">
              {!editingSent && (
                <button className="btn-secondary justify-center" disabled={isSaving || isReviewing || Boolean(previewState.error)} onClick={() => persistEstimate('draft')}>{isSaving ? 'Saving...' : 'Save draft'}</button>
              )}
              <button className="btn-primary justify-center" disabled={isSaving || isReviewing || Boolean(previewState.error)} aria-busy={isReviewing} onClick={reviewProposal}>
                {isReviewing ? 'Checking pricing...' : editingSent ? 'Review update' : 'Review proposal'}
              </button>
            </div>
            {saveStatus && <p className="pf-copy mt-3" aria-live="polite">{saveStatus}</p>}
          </Card>
        </aside>
      </div>

      <Modal isOpen={showPreview} onClose={() => setShowPreview(false)} title="Review Before Sending" size="xl">
        <SendPreview
          leadName={selectedLead?.name || 'Selected customer'}
          estimateType={estimateType}
          editingSent={Boolean(editingSent) && pendingSaveRef.current?.reason !== 'sent'}
          totals={totals}
          onCancel={() => setShowPreview(false)}
          onSend={() => persistEstimate('sent')}
          isSaving={isSaving}
        />
      </Modal>
    </div>
  );
}

function InteriorStarter({
  assumptions,
  setAssumptions,
  onBuild,
  onSkip,
}: {
  assumptions: InteriorAssumptions;
  setAssumptions: Dispatch<SetStateAction<InteriorAssumptions>>;
  onBuild: () => void;
  onSkip: () => void;
}) {
  const setValue = (key: keyof InteriorAssumptions, value: string | boolean) => setAssumptions((current) => ({ ...current, [key]: value }));
  const numericFields: Array<[keyof InteriorAssumptions, string]> = [
    ['bedrooms', 'Bedrooms'],
    ['bathrooms', 'Bathrooms'],
    ['livingRooms', 'Living rooms'],
    ['diningRooms', 'Dining rooms'],
    ['kitchens', 'Kitchens'],
    ['hallways', 'Hallways'],
    ['closets', 'Closets'],
    ['ceilingHeight', 'Ceiling height'],
  ];
  return (
    <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {numericFields.map(([key, label]) => (
          <label key={key}>
            <span className="pf-field-label text-emerald-900">{label}</span>
            <input className="input mt-1" type="number" min="0" step={key === 'ceilingHeight' ? '0.5' : '1'} inputMode="decimal" value={String(assumptions[key])} onChange={(event) => setValue(key, event.target.value)} />
          </label>
        ))}
        <label className="col-span-2">
          <span className="pf-field-label text-emerald-900">Trim scope</span>
          <select className="input mt-1" value={String(assumptions.trimScope)} onChange={(event) => setValue('trimScope', event.target.value)}>
            <option value="none">None</option>
            <option value="base">Baseboards</option>
            <option value="base-casing">Baseboards + casing</option>
            <option value="base-crown-casing">Baseboards + crown + casing</option>
          </select>
        </label>
        <div className="col-span-2 grid gap-2 min-[420px]:grid-cols-2">
          <label className="pf-inline-option h-10 rounded border bg-white px-2 text-emerald-900"><input type="checkbox" checked={Boolean(assumptions.includeCeilings)} onChange={(event) => setValue('includeCeilings', event.target.checked)} />Ceilings</label>
          <label className="pf-inline-option h-10 rounded border bg-white px-2 text-emerald-900"><input type="checkbox" checked={Boolean(assumptions.includeDoors)} onChange={(event) => setValue('includeDoors', event.target.checked)} />Doors</label>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-primary btn-sm" onClick={onBuild}>Build starter scope</button>
        <button className="btn-text btn-sm" onClick={onSkip}>Skip starter</button>
      </div>
    </div>
  );
}

function ExteriorStarter({ assumptions, setAssumptions, onBuild, onSkip }: { assumptions: ExteriorAssumptions; setAssumptions: Dispatch<SetStateAction<ExteriorAssumptions>>; onBuild: () => void; onSkip: () => void }) {
  const setValue = (key: keyof ExteriorAssumptions, value: string) => setAssumptions((current) => ({ ...current, [key]: value }));
  const fields: Array<[keyof ExteriorAssumptions, string, string]> = [
    ['perimeter', 'House perimeter', 'Linear ft'],
    ['wallHeight', 'Wall height', 'Feet'],
    ['soffitDepth', 'Soffit depth', 'Feet'],
    ['windows', 'Windows', 'Count'],
    ['doors', 'Doors', 'Count'],
    ['corners', 'Corners', 'Count'],
    ['rooflineFactor', 'Roofline factor', '1.1'],
  ];
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {fields.map(([key, label, placeholder]) => (
          <label key={key}>
            <span className="pf-field-label text-blue-900">{label}</span>
            <input className="input mt-1" type="number" min="0" step="0.1" inputMode="decimal" placeholder={placeholder} value={assumptions[key]} onChange={(event) => setValue(key, event.target.value)} />
          </label>
        ))}
        <label>
          <span className="pf-field-label text-blue-900">Stories</span>
          <select className="input mt-1" value={assumptions.stories} onChange={(event) => setValue('stories', event.target.value)}>
            <option value="1">1</option>
            <option value="1.5">1.5</option>
            <option value="2">2</option>
            <option value="3">3</option>
          </select>
        </label>
      </div>
      <p className="pf-supporting mt-3 rounded-md border border-blue-200 bg-white p-3 text-blue-950">
        Exterior assumptions create editable siding, soffit, fascia, trim, and corner-board substrate lines. Exact measurements can override any generated line.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn-primary btn-sm" onClick={onBuild}>Build starter scope</button>
        <button className="btn-text btn-sm" onClick={onSkip}>Skip starter</button>
      </div>
    </div>
  );
}

function RoomCard({
  room,
  ratesByCategory,
  rates,
  materials,
  catalogColors,
  updateRoom,
  updateSurface,
  updateSurfaceColor,
  removeRoom,
  addSurface,
  removeSurface,
  useRoomMetrics,
  surfaceTotal,
  calculationError,
}: {
  room: Room;
  ratesByCategory: [string, ProductionRate[]][];
  rates: ProductionRate[];
  materials: Material[];
  catalogColors: CatalogColor[];
  updateRoom: (roomId: string, patch: Partial<Room>) => void;
  updateSurface: (roomId: string, surfaceId: string, patch: Partial<Surface>) => void;
  updateSurfaceColor: (roomId: string, surfaceId: string, colorName: string) => void;
  removeRoom: (roomId: string) => void;
  addSurface: (roomId: string) => void;
  removeSurface: (roomId: string, surfaceId: string) => void;
  useRoomMetrics: (roomId: string, surfaceId: string) => void;
  surfaceTotal: (surface: Surface) => string;
  calculationError: { field: string; message: string };
}) {
  return (
    <div className="rounded-lg border bg-white p-3 sm:p-4">
      <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="min-w-0">
          <span className="form-label">Room / Space</span>
          <input className="input pf-value mt-1" maxLength={200} value={room.name} onChange={(event) => updateRoom(room.id, { name: event.target.value })} placeholder="Bedroom 1, front elevation, kitchen cabinets" />
        </label>
        <div className="flex gap-2">
          <button className="btn-text btn-sm text-red-700" onClick={() => removeRoom(room.id)}>Remove</button>
        </div>
      </div>
      <div className="space-y-3">
        {room.surfaces.length === 0 ? (
          <p className="pf-supporting rounded-lg border border-dashed p-3">No substrates in this space yet.</p>
        ) : room.surfaces.map((surface) => {
          const rate = rates.find((item) => item.id === surface.rateId);
          const config = measurementConfig(rate);
          const canUseRoomMetrics = Boolean(room.metrics && ['walls', 'ceilings', 'trim'].includes(rateKind(rate)));
          const errorId = `${surface.id}-calculation-error`;
          const errorFor = (field: string) => calculationError.field === `${surface.id}.${field}` ? errorId : undefined;
          return (
            <div key={surface.id} className="rounded-lg border bg-gray-50 p-3">
              {calculationError.field.startsWith(`${surface.id}.`) && <p id={errorId} className="pf-field-error mb-3" role="alert">{calculationError.message}</p>}
              <div className="mb-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <label>
                  <span className="form-label">Substrate</span>
                  <select
                    className="input mt-1"
                    aria-invalid={Boolean(errorFor('productionRateId'))}
                    aria-describedby={errorFor('productionRateId')}
                    value={surface.rateId}
                    onChange={(event) => {
                      const nextRate = rates.find((item) => item.id === event.target.value);
                      updateSurface(room.id, surface.id, {
                        rateId: event.target.value,
                        ...(nextRate?.unit !== rate?.unit ? { width: '', height: '', quantity: '' } : {}),
                        ...coatingDefaults(nextRate),
                        label: labelize(nextRate?.surfaceType || nextRate?.category || surface.label),
                        applicationMethod: defaultMethod(nextRate),
                      });
                    }}
                  >
                    <option value="">Select substrate...</option>
                    {ratesByCategory.map(([category, group]) => (
                      <optgroup key={category} label={category}>
                        {group.map((item) => <option key={item.id} value={item.id}>{displayRate(item)}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="form-label">Proposal label</span>
                  <input className="input mt-1" maxLength={200} value={surface.label} onChange={(event) => updateSurface(room.id, surface.id, { label: event.target.value })} />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {config.showWidth !== false && <NumberField label={config.width} errorId={errorFor('width')} value={surface.width} onChange={(value) => updateSurface(room.id, surface.id, { width: value })} />}
                {config.showHeight !== false && <NumberField label={config.height} errorId={errorFor('height')} value={surface.height} onChange={(value) => updateSurface(room.id, surface.id, { height: value })} />}
                <NumberField label={config.quantity} errorId={errorFor('quantity')} value={surface.quantity} onChange={(value) => updateSurface(room.id, surface.id, { quantity: value })} />
                <label>
                  <span className="form-label">Coats</span>
                  <select className="input mt-1" value={surface.coats} onChange={(event) => updateSurface(room.id, surface.id, { coats: Number(event.target.value) })}>
                    <option value="1">1 coat</option>
                    <option value="2">2 coats</option>
                    <option value="3">3 coats</option>
                  </select>
                </label>
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="pf-helper">{config.helper}</p>
                {canUseRoomMetrics && <button className="btn-text btn-sm shrink-0" onClick={() => useRoomMetrics(room.id, surface.id)}>Use room metrics</button>}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {rate?.unit === 'linear_ft' && <NumberField label="Painted width (in)" errorId={errorFor('coatingWidthInches')} value={surface.coatingWidthInches} onChange={(value) => updateSurface(room.id, surface.id, { coatingWidthInches: value })} />}
                {rate?.unit === 'each' && <NumberField label="Painted sq ft/item" errorId={errorFor('coatingSqFtPerItem')} value={surface.coatingSqFtPerItem} onChange={(value) => updateSurface(room.id, surface.id, { coatingSqFtPerItem: value })} />}
                <label>
                  <span className="form-label">Prep</span>
                  <select className="input mt-1" value={surface.prepLevel} onChange={(event) => updateSurface(room.id, surface.id, { prepLevel: event.target.value as PrepLevel })}>
                    <option value="none">No prep</option>
                    <option value="light">Light prep</option>
                    <option value="standard">Standard prep</option>
                    <option value="heavy">Heavy prep</option>
                  </select>
                </label>
                <label>
                  <span className="form-label">Method</span>
                  <select className="input mt-1" value={surface.applicationMethod} onChange={(event) => updateSurface(room.id, surface.id, { applicationMethod: event.target.value as ApplicationMethod })}>
                    {Object.entries(applicationMethods).map(([value, method]) => <option key={value} value={value}>{method.label}</option>)}
                  </select>
                </label>
                <label>
                  <span className="form-label">Product</span>
                  <select className="input mt-1" value={surface.materialId} onChange={(event) => updateSurface(room.id, surface.id, { materialId: event.target.value })}>
                    <option value="">Use estimate product</option>
                    {materials.map((material) => <option key={material.id} value={material.id}>{materialLabel(material)}</option>)}
                  </select>
                </label>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <NumberField label="Prep hours +/-" allowNegative errorId={errorFor('prepAdjustmentHours')} value={surface.prepAdjustmentHours} onChange={(value) => updateSurface(room.id, surface.id, { prepAdjustmentHours: value })} />
                <NumberField label="Paint hours +/-" allowNegative errorId={errorFor('paintAdjustmentHours')} value={surface.paintAdjustmentHours} onChange={(value) => updateSurface(room.id, surface.id, { paintAdjustmentHours: value })} />
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_0.7fr_0.8fr]">
                <input className="input" maxLength={120} aria-label="Color name" list="crewmodo-catalog-colors" value={surface.colorName} onChange={(event) => updateSurfaceColor(room.id, surface.id, event.target.value)} placeholder={catalogColors.length ? 'Search color library' : 'Color name'} />
                <input className="input" maxLength={80} aria-label="Color code" value={surface.colorCode} onChange={(event) => updateSurface(room.id, surface.id, { colorCode: event.target.value })} placeholder="Color code" />
                <select className="input" value={surface.colorStatus} onChange={(event) => updateSurface(room.id, surface.id, { colorStatus: event.target.value })}>
                  {['TBD', 'Selected', 'Approved', 'Ordered', 'Delivered', 'Changed'].map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                <input className="input" maxLength={500} aria-label="Crew note" value={surface.crewNote} onChange={(event) => updateSurface(room.id, surface.id, { crewNote: event.target.value })} placeholder="Crew note / production handoff" />
                <div className="flex items-center justify-between gap-3">
                  <label className="pf-inline-option"><input type="checkbox" checked={surface.customerVisible} onChange={(event) => updateSurface(room.id, surface.id, { customerVisible: event.target.checked })} />Show</label>
                  <label className="pf-inline-option"><input type="checkbox" checked={surface.optional} onChange={(event) => updateSurface(room.id, surface.id, { optional: event.target.checked })} />Option</label>
                  <span className="pf-row-title whitespace-nowrap">{surfaceTotal(surface)}</span>
                  <button className="btn-text btn-sm text-red-700" onClick={() => removeSurface(room.id, surface.id)}>Remove</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <button className="btn-secondary btn-sm mt-3" onClick={() => addSurface(room.id)}>Add substrate</button>
    </div>
  );
}

function NumberField({ label, value, onChange, allowNegative = false, errorId }: { label: string; value: string; onChange: (value: string) => void; allowNegative?: boolean; errorId?: string }) {
  return (
    <label>
      <span className="form-label">{label}</span>
      <input className={`input mt-1 ${errorId ? 'pf-field-invalid' : ''}`} aria-invalid={Boolean(errorId)} aria-describedby={errorId} type="number" min={allowNegative ? undefined : '0'} step="any" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} onFocus={(event) => event.currentTarget.select()} />
    </label>
  );
}

function PaintScheduleCell({ label, value }: { label: string; value: string }) {
  return <div><span className="pf-label-small">{label}</span><div className="pf-value">{value}</div></div>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between"><span className="pf-meta">{label}</span><span className="pf-row-title">{value}</span></div>;
}

function ReadinessRow({ label, count }: { label: string; count: number }) {
  return <div className={`flex justify-between ${count ? 'text-amber-700' : 'text-green-700'}`}><span className="pf-supporting">{label}</span><span className="pf-value">{count}</span></div>;
}

function SendPreview({
  leadName,
  estimateType,
  editingSent,
  totals,
  onCancel,
  onSend,
  isSaving,
}: {
  leadName: string;
  estimateType: EstimateType;
  editingSent: boolean;
  totals: EstimateTotals;
  onCancel: () => void;
  onSend: () => void;
  isSaving: boolean;
}) {
  const visible = totals.items.filter((item: EstimateLineItem) => item.customerVisible !== false);
  const included = visible.filter((item: EstimateLineItem) => !item.optional);
  const optional = visible.filter((item: EstimateLineItem) => item.optional);
  const groups = new Map<string, EstimateLineItem[]>();
  included.forEach((item: EstimateLineItem) => {
    const key = item.roomName || String(item.desc || 'Project').split(':')[0] || 'Project';
    groups.set(key, [...(groups.get(key) || []), item]);
  });
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-gray-50 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="pf-label-small uppercase">Customer</p>
            <p className="pf-emphasis">{leadName}</p>
          </div>
          <div className="sm:text-right">
            <p className="pf-label-small uppercase">Proposal total</p>
            <p className="pf-section-title text-blue-700">{formatMoney(totals.total)}</p>
          </div>
        </div>
        <div className="mt-3 rounded-md border bg-white p-3">
          <p className="pf-label-small uppercase">Email preview</p>
          <p className="pf-emphasis mt-1">{editingSent ? `Updated ${estimateType} painting proposal for ${leadName}` : `${leadName} ${estimateType} painting proposal`}</p>
          <p className="pf-supporting mt-1">{editingSent ? 'Tells the customer this is an updated proposal and keeps the same preview link current.' : 'Includes this compact scope summary and a secure link to review, approve, sign, and pay.'}</p>
          <p className="pf-helper mt-2">Once signed, the estimate becomes immutable. Later scope or price changes should be handled with a change order or new estimate agreement.</p>
        </div>
      </div>
      <div className="space-y-2">
        {Array.from(groups.entries()).map(([name, items]) => (
          <section key={name} className="rounded-lg border bg-white">
            <div className="flex items-center justify-between gap-3 border-b bg-gray-50 px-3 py-2">
              <h3 className="pf-row-title">{name}</h3>
              <span className="pf-label-small">{items.length} substrate{items.length === 1 ? '' : 's'}</span>
            </div>
            <div className="divide-y">
              {items.map((item) => (
                <div key={`${item.desc}-${item.productionRateId}`} className="grid gap-1 px-3 py-2 sm:grid-cols-[9rem_1fr]">
                  <p className="pf-value">{String(item.desc || '').split(':').pop()?.trim()}</p>
                  <p className="pf-supporting">{proposalDetail(item)}</p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {optional.length > 0 && (
        <section className="rounded-lg border bg-white p-3">
          <h3 className="pf-row-title">Customer Options</h3>
          <div className="mt-2 space-y-1">
            {optional.map((item) => <div key={`${item.desc}-${item.productionRateId}`} className="flex justify-between gap-3 border-t py-2"><span className="pf-supporting">{item.desc}</span><span className="pf-value">{formatMoney(num(item.rate))}</span></div>)}
          </div>
        </section>
      )}
      <ModalFooter className="-mx-6 -mb-4 mt-4">
        <button type="button" className="btn-secondary" onClick={onCancel}>Keep editing</button>
        <button type="button" className="btn-primary" disabled={isSaving} onClick={onSend}>{isSaving ? 'Sending...' : editingSent ? 'Send update email' : 'Send email'}</button>
      </ModalFooter>
    </div>
  );
}

function proposalDetail(item: EstimateLineItem) {
  if (item.kind === 'line_item') return item.notes || 'Additional scope';
  return [
    item.labor?.coats ? `${item.labor.coats} coat${item.labor.coats === 1 ? '' : 's'}` : '',
    item.labor?.prepLevel ? `${labelize(item.labor.prepLevel)} prep` : '',
    item.material?.name ? `Paint: ${[item.material.brand, item.material.name].filter(Boolean).join(' ')}` : 'Paint: TBD',
    [item.material?.colorName, item.material?.colorCode].filter(Boolean).join(' '),
  ].filter(Boolean).join(' - ');
}
