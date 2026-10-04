import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { AddressFields } from '@/components/AddressFields';
import { StatusBadge } from '@/components/Badge';
import { CardHeader } from '@/components/Card';
import { Icon } from '@/components/Icon';
import { Modal, ModalFooter } from '@/components/Modal';
import { apiJson, formatMoney, labelize } from '@/lib/api';
import { EstimationInputError, formatEstimationMinor, resolveEstimationMeasurement, estimationUnit, type EstimationResult, type EstimationRequest } from '../../../../../packages/core/src/estimation';
import { calculateProductionPreview, type ProductionPreviewRequest, type ProductionPreviewItem, type ProductionPreviewCatalog } from '../../../../../packages/core/src/estimation-production';
import { estimationSaveAttempt, type EstimationSaveAttempt } from '../../../../../packages/core/src/estimation-save';
import { decimal, minor } from '../../../../../packages/core/src/estimation-decimal';
import { assertEstimationTemplateCompatible, estimationTemplateSurfaces, estimationSurfaceKind, resolveEstimationTemplateRate, type EstimationTemplateScope, type EstimationTemplateSurface } from '../../../../../packages/core/src/estimation-template';
import { deriveEstimatorMeasurement, estimatorCoatingProducts, estimatorMeasurementPatch, ESTIMATOR_INTERIOR_OPENINGS, ESTIMATOR_EXTERIOR_OPENINGS, type EstimatorRoomMetrics, type EstimatorDerivedMeasurement, type EstimatorGeometryKind } from '../../../../../packages/core/src/estimation-measurement';
import { EstimatorEditSheet, EstimatorGroup, EstimatorRoomRow, EstimatorStyles } from './estimator-editor';
import { useEstimatorDraft, estimatorEvent } from './estimator-draft';
import { EstimatorInternalReview } from './estimator-review';
import { EstimatorRoomPhotos } from './estimator-room-photos';
import { readEstimationTaxPolicy, resolveEstimationTax, type ResolvedEstimationTax } from '../../../../../packages/core/src/estimation-tax';

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

type ProductionCatalogRate = ProductionPreviewCatalog['rates'][number];
type ProductionCatalogMaterial = ProductionPreviewCatalog['materials'][number];
type ProductionCatalogSettings = ProductionPreviewCatalog['settings'];
interface ProductionRate extends ProductionCatalogRate {
  version?: number;
  reviewedAt?: string | null;
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

interface Material extends ProductionCatalogMaterial {
  costSource?: string | null;
  costUpdatedAt?: string | null;
  coverageSource?: string | null;
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

interface OrgSettings extends ProductionCatalogSettings {
  businessHours?: Record<string, unknown> | null;
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
  taxSnapshot?: ResolvedEstimationTax;
  calculationVersion?: string;
  productionInput?: ProductionPreviewRequest & { editorState?: EstimatorLocalDraft; taxOverride?: { ratePercent: string; reason: string } };
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
  scopeCommitments?: string[];
  coatingLayers?: (NonNullable<ProductionPreviewItem['coatingLayers']>[number] & { name?: string | null; brand?: string | null })[];
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

type EstimatorOperation = NonNullable<ProductionPreviewItem['operations']>[number];

interface Room {
  id: string;
  name: string;
  kind: 'interior' | 'exterior' | 'custom';
  generated?: boolean;
  metrics?: EstimatorRoomMetrics;
  surfaces: Surface[];
}

type TemplateSurface = EstimationTemplateSurface;

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
  primerMode?: 'none' | 'spot' | 'full';
  primerMaterialId?: string;
  primerCoats?: number;
  primerQuantity?: string;
  primerHours?: string;
  finishLossPercent?: string;
  primerLossPercent?: string;
  colorRelationship?: ProductionPreviewItem['colorRelationship'];
  provisionalColorGroup?: string;
  colorSupplier?: string;
  sellingRate?: ProductionPreviewItem['sellingRate'];
  burdenedRate?: ProductionPreviewItem['burdenedRate'];
  operations?: EstimatorOperation[];
  coatingLayers?: ProductionPreviewItem['coatingLayers'];
  measurement?: EstimatorDerivedMeasurement;
  geometryKind?: EstimatorGeometryKind;
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
  costPerUnit?: string;
  hoursPerUnit?: string;
  burdenedRate?: string;
  costUnknown?: boolean;
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

interface EstimatorLocalDraft {
  calculationVersion?: 'repaint-v1' | 'repaint-v2';
  materialSellingPolicy?: 'purchase' | 'consumption';
  leadId: string;
  jobsite: { streetAddress: string; city: string; state: string; postalCode: string };
  estimateType: EstimateType;
  rooms: Room[];
  adjustments: Adjustment[];
  paintMaterialId: string;
  primerMaterialId: string;
  discount: string;
  minimumPrice?: string;
  mobilizationHours?: string;
  taxOverride?: { ratePercent: string; reason: string };
  interiorAssumptions: InteriorAssumptions;
  exteriorAssumptions: ExteriorAssumptions;
}

function isEstimatorLocalDraft(value: unknown): value is EstimatorLocalDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as EstimatorLocalDraft;
  const strings = ['leadId', 'paintMaterialId', 'primerMaterialId', 'discount'] as const;
  return strings.every((key) => typeof draft[key] === 'string')
    && ['minimumPrice', 'mobilizationHours'].every((key) => draft[key as 'minimumPrice' | 'mobilizationHours'] == null || typeof draft[key as 'minimumPrice' | 'mobilizationHours'] === 'string')
    && ['interior', 'exterior', 'cabinet', 'custom'].includes(draft.estimateType)
    && Boolean(draft.jobsite && ['streetAddress', 'city', 'state', 'postalCode'].every((key) => typeof draft.jobsite[key as keyof typeof draft.jobsite] === 'string'))
    && Boolean(draft.interiorAssumptions && draft.exteriorAssumptions)
    && Array.isArray(draft.adjustments) && draft.adjustments.length <= 500 && draft.adjustments.every((row) => row && typeof row.id === 'string' && typeof row.desc === 'string' && typeof row.qty === 'string' && typeof row.rate === 'string')
    && Array.isArray(draft.rooms) && draft.rooms.length <= 500 && draft.rooms.every((room) => room && typeof room.id === 'string' && typeof room.name === 'string' && Array.isArray(room.surfaces) && room.surfaces.length <= 200 && room.surfaces.every((surface) => surface && ['id', 'rateId', 'label', 'width', 'height', 'quantity', 'coatingWidthInches', 'coatingSqFtPerItem', 'materialId', 'colorName', 'colorCode', 'colorStatus', 'crewNote', 'prepAdjustmentHours', 'paintAdjustmentHours'].every((key) => typeof surface[key as keyof Surface] === 'string') && ['none', 'light', 'standard', 'heavy'].includes(surface.prepLevel) && surface.coats >= 1 && surface.coats <= 3));
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

function unitLabel(value?: string | null) {
  const labels: Record<string, string> = { sqft: 'sq ft', linear_ft: 'lin ft', each: 'each' };
  return value ? labels[value] || labelize(value) : '';
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
  if (rate?.applicationMethod && rate.applicationMethod in applicationMethods) return rate.applicationMethod as ApplicationMethod;
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
  const [minimumPrice, setMinimumPrice] = useState('');
  const [mobilizationHours, setMobilizationHours] = useState('');
  const [calculationVersion, setCalculationVersion] = useState<'repaint-v1' | 'repaint-v2'>('repaint-v2');
  const [materialSellingPolicy, setMaterialSellingPolicy] = useState<'purchase' | 'consumption'>('purchase');
  const [confirmV2, setConfirmV2] = useState(false);
  const [taxOverrideEnabled, setTaxOverrideEnabled] = useState(false);
  const [taxOverrideRate, setTaxOverrideRate] = useState('');
  const [taxOverrideReason, setTaxOverrideReason] = useState('');
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
  const [serverPreview, setServerPreview] = useState<{ key: string; calculation: EstimationResult; resolvedInput: EstimationRequest; taxSnapshot?: ResolvedEstimationTax } | null>(null);
  const [saveStatus, setSaveStatus] = useState('');
  const [pendingStarter, setPendingStarter] = useState<Room[] | null>(null);
  const [confirmStarterReplace, setConfirmStarterReplace] = useState(false);
  const [metricReplacement, setMetricReplacement] = useState<{ roomId: string; surfaceId: string } | null>(null);
  const [deleteRoomId, setDeleteRoomId] = useState('');
  const [bulkProducts, setBulkProducts] = useState(false);
  const [bulkFinishId, setBulkFinishId] = useState('');
  const [bulkRoomIds, setBulkRoomIds] = useState<string[]>([]);
  const [replaceProductOverrides, setReplaceProductOverrides] = useState(false);
  const saveAttemptRef = useRef<EstimationSaveAttempt | null>(null);
  const setupRequestRef = useRef(0);
  const restoredJobsiteRef = useRef(false);
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

  const localDraftValue: EstimatorLocalDraft = { calculationVersion, materialSellingPolicy, leadId, jobsite, estimateType, rooms, adjustments, paintMaterialId, primerMaterialId, discount, minimumPrice, mobilizationHours, interiorAssumptions, exteriorAssumptions, ...(taxOverrideEnabled ? { taxOverride: { ratePercent: taxOverrideRate, reason: taxOverrideReason } } : {}) };
  const draftRecovery = useEstimatorDraft({ estimateKey: estimateId || `new:${initialLeadId || 'estimate'}`, baseVersion: editingEstimate?.updatedAt || '', value: localDraftValue, enabled: !isLoading && !setupError, validate: isEstimatorLocalDraft, onAccountChange: () => {
    setupRequestRef.current++; setRooms([]); setAdjustments([]); setLeadId(''); setJobsite({ streetAddress: '', city: '', state: '', postalCode: '' }); setEditingEstimate(null); setMaterials([]); setRates([]); setServerPreview(null); setShowPreview(false); setSetupError('Account changed. Reload the estimator before editing another scope.');
  } });

  function restoreDraft() {
    const recovered = draftRecovery.restore();
    if (!recovered) return;
    restoredJobsiteRef.current = true;
    setLeadId(recovered.leadId); setJobsite(recovered.jobsite); setEstimateType(recovered.estimateType);
    setCalculationVersion(recovered.calculationVersion || 'repaint-v1');
    setMaterialSellingPolicy(recovered.materialSellingPolicy || 'purchase');
    setMinimumPrice(recovered.minimumPrice ?? ''); setMobilizationHours(recovered.mobilizationHours ?? '');
    setRooms(recovered.rooms); setAdjustments(recovered.adjustments);
    setPaintMaterialId(recovered.paintMaterialId); setPrimerMaterialId(recovered.primerMaterialId); setDiscount(recovered.discount);
    setInteriorAssumptions(recovered.interiorAssumptions); setExteriorAssumptions(recovered.exteriorAssumptions);
    setTaxOverrideEnabled(Boolean(recovered.taxOverride)); setTaxOverrideRate(recovered.taxOverride?.ratePercent || ''); setTaxOverrideReason(recovered.taxOverride?.reason || '');
    setStarterCollapsed(true); setServerPreview(null);
  }

  useEffect(() => {
    loadSetup();
  }, [estimateId]);

  async function loadSetup() {
    const request = ++setupRequestRef.current;
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
      if (request !== setupRequestRef.current) return;
      const loadedRates = (ratesRes.data || []).map((rate) => ({ ...rate, rateVersion: rate.rateVersion ?? (rate.version != null ? String(rate.version) : undefined), provenance: typeof rate.provenance === 'string' ? { source: rate.provenance, version: rate.version != null ? String(rate.version) : undefined, effectiveAt: rate.reviewedAt || undefined } : rate.provenance }));
      setRates(loadedRates);
      setLeads(leadsRes.data || []);
      const preferences = settingsRes.data?.businessHours?.estimationPricing as ProductionCatalogSettings | undefined;
      setSettings({ ...settingsRes.data, ...(preferences ? { ...preferences } : {}) });
      setMaterials((materialsRes.data || []).map((material) => ({ ...material, provenance: material.provenance || { source: material.costSource || 'contractor_pricebook', priceDate: material.costUpdatedAt || undefined, coverageSource: material.coverageSource || undefined } })));
      setCatalogColors(catalogColorsRes.data || []);
      if (estimateRes.data) hydrateEstimate(estimateRes.data, loadedRates);
      else {
        setMaterialSellingPolicy(settingsRes.data?.materialSellingPolicy || 'purchase');
        if (!hydrateTemplateRooms(loadedRates) && initialLeadId) setLeadId(initialLeadId);
      }
    } catch (err) {
      if (request === setupRequestRef.current) setSetupError(err instanceof Error ? err.message : 'Failed to load estimator setup');
    } finally {
      if (request === setupRequestRef.current) setIsLoading(false);
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
    setCalculationVersion(pkg?.calculationVersion === 'repaint-v2' ? 'repaint-v2' : 'repaint-v1');
    setMaterialSellingPolicy(pkg?.productionInput?.materialSellingPolicy || 'purchase');
    setMinimumPrice(pkg?.productionInput?.minimumPrice?.toString() ?? '');
    setMobilizationHours(pkg?.productionInput?.mobilizationHours?.toString() ?? '');
    setTaxOverrideEnabled(Boolean(pkg?.productionInput?.taxOverride));
    setTaxOverrideRate(pkg?.productionInput?.taxOverride?.ratePercent || '');
    setTaxOverrideReason(pkg?.productionInput?.taxOverride?.reason || '');
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
      if (item.calculationItemId === 'estimator:minimum' || item.calculationItemId === 'estimator:mobilization') continue;
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
          costPerUnit: original?.costPerUnit?.toString(), hoursPerUnit: original?.hoursPerUnit?.toString(),
          burdenedRate: original?.burdenedRate?.toString(), costUnknown: original?.costUnknown,
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
        operations: original.operations, coatingLayers: original.coatingLayers,
        primerMode: original.coatingLayers?.some((layer) => layer.phase === 'primer') ? original.coatingLayers.find((layer) => layer.phase === 'primer')?.quantity != null ? 'spot' : 'full' : 'none',
        primerMaterialId: original.coatingLayers?.find((layer) => layer.phase === 'primer')?.materialId,
        primerCoats: original.coatingLayers?.find((layer) => layer.phase === 'primer')?.coats,
        primerQuantity: original.coatingLayers?.find((layer) => layer.phase === 'primer')?.quantity?.toString(),
        primerHours: original.operations?.find((operation) => operation.kind === 'primer')?.hours?.toString(),
        colorRelationship: original.colorRelationship, provisionalColorGroup: original.provisionalColorGroup,
        colorSupplier: original.colorSupplier, sellingRate: original.sellingRate, burdenedRate: original.burdenedRate,
      } : surface);
    }
    const editorState = pkg?.productionInput?.editorState;
    if (editorState && isEstimatorLocalDraft(editorState)) {
      setRooms(editorState.rooms);
      setPaintMaterialId(editorState.paintMaterialId); setPrimerMaterialId(editorState.primerMaterialId);
      setInteriorAssumptions(editorState.interiorAssumptions); setExteriorAssumptions(editorState.exteriorAssumptions);
    } else setRooms(Array.from(roomMap.values()));
    setAdjustments(nextAdjustments);
    setStarterCollapsed(true);
  }

  function hydrateTemplateRooms(loadedRates: ProductionRate[]) {
    const template = (location.state as { estimateTemplate?: EstimationTemplateScope } | null)?.estimateTemplate;
    if (!template) return false;

    try {
      const { assembly } = assertEstimationTemplateCompatible(template, 'production');
      const templateRooms = template.rooms;

      const nextRooms = templateRooms.map((room, roomIndex): Room => {
        const kind = room.kind === 'exterior' || room.roomType === 'exterior' ? 'exterior' : room.kind === 'custom' ? 'custom' : 'interior';
        const surfaces = estimationTemplateSurfaces(room)
          .map((surface) => templateSurfaceToProduction(surface, loadedRates, kind))
          .filter((surface): surface is Surface => Boolean(surface));
        const length = num(room.length);
        const width = num(room.width);
        const metrics = room.metrics || (length && width ? { length, width, perimeter: (length + width) * 2 } : undefined);
        return {
          id: room.id || uid('room'),
          name: room.name || (kind === 'exterior' ? 'Exterior' : `Room ${roomIndex + 1}`),
          kind,
          generated: true,
          metrics,
          surfaces,
        };
      }).filter((room) => room.surfaces.length);

      if (!nextRooms.length && !assembly?.adjustments?.length) throw new Error('This template has no rooms or scope items.');
      setCalculationVersion(assembly?.calculationVersion || 'repaint-v1');
      if (assembly) {
        setMaterialSellingPolicy(assembly.materialSellingPolicy || 'purchase');
        setMinimumPrice(assembly.minimumPrice?.toString() ?? ''); setMobilizationHours(assembly.mobilizationHours?.toString() ?? ''); setDiscount(assembly.discount?.toString() ?? '');
        setAdjustments((assembly.adjustments || []).map((row) => ({ id: row.id, desc: row.description || 'Template add-on', qty: row.quantity.toString(), rate: row.unitPrice.toString(), category: row.category || 'other', customerVisible: true, optional: Boolean(row.optional), costPerUnit: row.costPerUnit?.toString(), hoursPerUnit: row.hoursPerUnit?.toString(), burdenedRate: row.burdenedRate?.toString(), costUnknown: row.costUnknown })));
      }
      setEstimateType(nextRooms.some((room) => room.kind === 'exterior') ? 'exterior' : 'interior');
      setRooms(nextRooms);
      setStarterCollapsed(true);
      setStarterSkipped(false);
      setTemplateApplied(true);
      navigate(location.pathname + location.search, { replace: true, state: null });
      window.showToast?.(`Loaded ${nextRooms.length} room${nextRooms.length === 1 ? '' : 's'} from template.`, 'success');
      return true;
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Could not load estimate template');
      return true;
    }
  }

  function templateSurfaceToProduction(template: TemplateSurface, loadedRates: ProductionRate[], kind: string): Surface | null {
    const category = String(template.category || template.label || '').trim();
    const rate = resolveEstimationTemplateRate(template, loadedRates, kind);
    const label = template.label || labelize(category || rate?.surfaceType || rate?.category || 'Substrate');
    const finish = template.coatingLayers?.find((layer) => layer.phase === 'finish');
    const primer = template.coatingLayers?.find((layer) => layer.phase === 'primer');
    return {
      id: template.id || uid('surface'),
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
      prepAdjustmentHours: template.prepAdjustmentHours?.toString() ?? '',
      paintAdjustmentHours: template.paintAdjustmentHours?.toString() ?? '',
      materialId: template.materialId || finish?.materialId || '',
      colorName: template.colorName || finish?.colorName || '',
      colorCode: template.colorCode || finish?.colorCode || '',
      colorSupplier: template.colorSupplier || finish?.colorSupplier,
      colorRelationship: template.colorRelationship, provisionalColorGroup: template.provisionalColorGroup,
      sellingRate: template.sellingRate, burdenedRate: template.burdenedRate,
      operations: template.operations ? structuredClone(template.operations) : undefined,
      coatingLayers: template.coatingLayers ? structuredClone(template.coatingLayers) : undefined,
      primerMode: primer ? primer.quantity != null ? 'spot' : 'full' : 'none',
      primerMaterialId: primer?.materialId, primerCoats: primer?.coats, primerQuantity: primer?.quantity?.toString(), primerHours: template.operations?.find((operation) => operation.kind === 'primer')?.hours?.toString(),
      finishLossPercent: finish?.lossAllowancePercent?.toString(), primerLossPercent: primer?.lossAllowancePercent?.toString(),
      measurement: template.measurement, geometryKind: template.geometryKind,
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
  const formIdentity = JSON.stringify({ leadId, jobsite, estimateType, rooms, adjustments, paintMaterialId, primerMaterialId, discount, minimumPrice, mobilizationHours, interiorAssumptions, exteriorAssumptions, calculationVersion, materialSellingPolicy, taxOverrideEnabled, taxOverrideRate, taxOverrideReason });
  const currentFormIdentity = useRef(formIdentity);
  currentFormIdentity.current = formIdentity;

  useEffect(() => {
    if (restoredJobsiteRef.current) { restoredJobsiteRef.current = false; return; }
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
      if (taxOverrideEnabled && (!/^\d+(\.\d{1,4})?$/.test(taxOverrideRate) || num(taxOverrideRate) > 100 || taxOverrideReason.trim().length < 3)) throw new EstimationInputError('taxOverride', 'Enter a tax rate from 0 to 100 percent and an explicit override reason.');
      const unpriced = rooms.flatMap((room) => room.surfaces).find((surface) => !surface.rateId);
      if (unpriced) throw new EstimationInputError(unpriced.id + '.productionRateId', 'Select an active substrate for this template item before pricing.');
      const taxSnapshot = resolveEstimationTax({ defaultRate: settings.salesTaxRate, policy: calculationVersion === 'repaint-v2' ? readEstimationTaxPolicy(settings.businessHours) : null, postalCode: jobsite.postalCode, override: calculationVersion === 'repaint-v2' ? request.taxOverride : null });
      const preview = serverPreview?.key === key ? serverPreview : { ...calculateProductionPreview(request, { rates, materials, settings: { ...settings, salesTaxRate: taxSnapshot.value } }), taxSnapshot };
      return { key, request, ...preview, error: '', errorField: '' };
    } catch (error) {
      return { key, request, calculation: null, resolvedInput: null, error: error instanceof Error ? error.message : 'Check the scope measurements and product settings.', errorField: error instanceof EstimationInputError ? error.field : '' };
    }
  }, [rooms, adjustments, rates, materials, settings, paintMaterialId, primerMaterialId, discount, minimumPrice, mobilizationHours, serverPreview, leadId, jobsite, estimateType, interiorAssumptions, exteriorAssumptions, taxOverrideEnabled, taxOverrideRate, taxOverrideReason, calculationVersion, materialSellingPolicy]);
  const currentPreviewKey = useRef(previewState.key);
  currentPreviewKey.current = previewState.key;
  const totals = useMemo(() => calculateTotals(previewState.calculation), [previewState, estimateType]);
  const surfaceItems = totals.items.filter((item) => item.kind === 'surface' && item.customerVisible !== false);
  const editingSent = editingEstimate?.status === 'sent';

  function updateRoom(roomId: string, patch: Partial<Room>) {
    setRooms((current) => current.map((room) => room.id === roomId ? { ...room, ...patch } : room));
  }

  function updateSurface(roomId: string, surfaceId: string, patch: Partial<Surface>) {
    const changesMeasurement = ['quantity', 'width', 'height'].some((key) => key in patch) && !('measurement' in patch);
    setRooms((current) => current.map((room) => room.id !== roomId ? room : {
      ...room,
      surfaces: room.surfaces.map((surface) => surface.id === surfaceId ? { ...surface, ...patch, ...(changesMeasurement ? { measurement: surface.measurement ? { ...surface.measurement, source: 'override' as const } : undefined } : {}) } : surface),
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
    estimatorEvent('room_added');
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
    return rates.find((rate) => rateKind(rate) === kind) || rates.find((rate) => rateText(rate).includes(kind));
  }

  function makeSurface(kind: string, label: string, quantity: number, extra: Partial<Surface> = {}): Surface {
    const rate = findRate(kind);
    return {
      id: uid('surface'),
      rateId: rate?.id || '',
      label,
      width: '',
      height: '',
      quantity: String(quantity),
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
    if (Object.entries(interiorAssumptions).some(([key, value]) => typeof value === 'string' && key !== 'trimScope' && (!Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > (key === 'ceilingHeight' ? 100 : 50)))) {
      window.showToast?.('Enter room counts between 0 and 50 and a valid ceiling height.', 'error'); return;
    }
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
        const metrics: EstimatorRoomMetrics = { length: template.length, width: template.width, perimeter, height: assumptions.ceilingHeight, windows: template.windows, doors: template.doors, trimScope: assumptions.trimScope as EstimatorRoomMetrics['trimScope'], openingPolicy: { ...ESTIMATOR_INTERIOR_OPENINGS } };
        const surfaceFromMetrics = (kind: EstimatorGeometryKind, name: string) => {
          const measurement = deriveEstimatorMeasurement(metrics, kind, 'starter_allowance');
          return makeSurface(kind, name, measurement.quantity, { measurement, geometryKind: kind });
        };
        const surfaces = [
          surfaceFromMetrics('walls', 'Walls'),
          assumptions.includeCeilings ? surfaceFromMetrics('ceilings', 'Ceiling') : null,
          assumptions.trimScope !== 'none' ? surfaceFromMetrics('trim', 'Trim') : null,
          assumptions.includeDoors ? surfaceFromMetrics('doors', 'Doors') : null,
        ].filter(Boolean) as Surface[];
        nextRooms.push({
          id: uid('room'),
          name: label,
          kind: 'interior',
          generated: true,
          metrics,
          surfaces,
        });
      }
    });
    if (!nextRooms.length) {
      window.showToast?.('Add at least one room count before building starter scope.', 'error');
      return;
    }
    stageStarter(nextRooms);
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
    const metrics: EstimatorRoomMetrics = { perimeter, height: wallHeight * stories, windows, doors, corners, rooflineFactor: roofline, soffitDepth, trimScope: 'casing', openingPolicy: { ...ESTIMATOR_EXTERIOR_OPENINGS } };
    const surfaceFromMetrics = (kind: EstimatorGeometryKind, name: string) => {
      const measurement = deriveEstimatorMeasurement(metrics, kind, 'starter_allowance');
      return makeSurface(kind, name, measurement.quantity, { measurement, geometryKind: kind });
    };
    const next: Room = {
      id: uid('room'),
      name: 'Exterior',
      kind: 'exterior',
      generated: true,
      metrics,
      surfaces: [
        surfaceFromMetrics('exterior_body', 'Siding'),
        surfaceFromMetrics('soffit', 'Soffits'),
        surfaceFromMetrics('fascia', 'Fascia'),
        surfaceFromMetrics('trim', 'Window and door trim'),
        surfaceFromMetrics('corner_boards', 'Corner boards'),
      ],
    };
    stageStarter([next]);
  }

  function stageStarter(next: Room[]) {
    if (rooms.length) { setPendingStarter(next); setConfirmStarterReplace(false); }
    else applyStarter(next, false);
  }

  function applyStarter(next: Room[], replace: boolean) {
    setRooms((current) => replace ? next : [...current, ...next]);
    setStarterCollapsed(true);
    setStarterSkipped(false);
    setTemplateApplied(false);
    setPendingStarter(null);
    estimatorEvent('starter_generated', { mode: replace ? 'replace' : 'append', roomCount: next.length });
  }

  function useRoomMetrics(roomId: string, surfaceId: string, confirmed = false) {
    const room = rooms.find((item) => item.id === roomId);
    const surface = room?.surfaces.find((item) => item.id === surfaceId);
    const rate = rates.find((item) => item.id === surface?.rateId);
    const kind = surface?.geometryKind || rateKind(rate);
    if (!room?.metrics || !surface) return;
    try {
      const measurement = deriveEstimatorMeasurement(room.metrics, kind as EstimatorGeometryKind);
      const patch = estimatorMeasurementPatch(measurement, surface.measurement?.source === 'override' || !surface.measurement ? surface.quantity || surface.width || surface.height : '', confirmed);
      if (!patch) { setMetricReplacement({ roomId, surfaceId }); return; }
      updateSurface(roomId, surfaceId, patch);
      setMetricReplacement(null);
      estimatorEvent('metrics_reused');
    } catch (error) { window.showToast?.(error instanceof Error ? error.message : 'Check room metrics.', 'error'); }
  }

  function measuredQuantity(surface: Surface, rate?: ProductionRate | null) {
    const measurement = resolveEstimationMeasurement({
      unit: estimationUnit(String(rate?.unit || 'sqft')), width: surface.width, height: surface.height, quantity: surface.quantity,
    });
    return { width: Number(measurement.width), height: Number(measurement.height), quantity: Number(measurement.quantity) };
  }

  function surfaceMaterialId(surface: Surface) {
    return estimatorCoatingProducts(surface, { finish: paintMaterialId, primer: primerMaterialId }).finish;
  }

  function previewRequest(): ProductionPreviewRequest & { editorState: EstimatorLocalDraft } {
    return {
      calculationVersion,
      ...(calculationVersion === 'repaint-v2' ? { materialSellingPolicy, ...(minimumPrice.trim() ? { minimumPrice } : {}), ...(mobilizationHours.trim() ? { mobilizationHours } : {}) } : {}),
      editorState: localDraftValue,
      jobsitePostalCode: jobsite.postalCode || undefined,
      ...(taxOverrideEnabled ? { taxOverride: { ratePercent: taxOverrideRate, reason: taxOverrideReason.trim() } } : {}),
      items: rooms.flatMap((room) => room.surfaces.filter((surface) => surface.rateId).map((surface) => ({
        id: surface.id, productionRateId: surface.rateId,
        width: surface.width, height: surface.height, quantity: surface.quantity,
        coats: surface.coats, prepLevel: surface.prepLevel, applicationMethod: surface.applicationMethod,
        prepAdjustmentHours: surface.prepAdjustmentHours || '0', paintAdjustmentHours: calculationVersion === 'repaint-v2' && (surface.operations || (surface.primerMode && surface.primerMode !== 'none')) ? '0' : surface.paintAdjustmentHours || '0',
        coatingWidthInches: surface.coatingWidthInches, coatingSqFtPerItem: surface.coatingSqFtPerItem,
        materialId: surfaceMaterialId(surface), colorName: surface.colorName, colorCode: surface.colorCode,
        colorRelationship: surface.colorRelationship, provisionalColorGroup: surface.provisionalColorGroup,
        colorSupplier: surface.colorSupplier, sellingRate: surface.sellingRate, burdenedRate: surface.burdenedRate,
        ...(calculationVersion === 'repaint-v2' ? coatingSystem(surface) : {}),
        optional: surface.optional,
      }))),
      adjustments: adjustments.filter((row) => row.desc.trim()).map((row) => ({
        id: row.id, quantity: row.qty || '0', unitPrice: row.rate || '0', optional: row.optional,
        ...(calculationVersion === 'repaint-v2' ? {
          ...(row.costPerUnit?.trim() ? { costPerUnit: row.costPerUnit } : {}),
          ...(row.hoursPerUnit?.trim() ? { hoursPerUnit: row.hoursPerUnit } : {}),
          ...(row.burdenedRate?.trim() ? { burdenedRate: row.burdenedRate } : settings.defaultBurdenedRate != null || settings.defaultBurdenedLaborRate != null ? { burdenedRate: settings.defaultBurdenedRate ?? settings.defaultBurdenedLaborRate ?? undefined } : {}),
          costUnknown: row.costUnknown ?? !row.costPerUnit?.trim(),
        } : {}),
      })),
      discount: discount || '0',
    };
  }

  function coatingSystem(surface: Surface): Pick<ProductionPreviewItem, 'coatingLayers' | 'operations'> {
    const products = estimatorCoatingProducts(surface, { finish: paintMaterialId, primer: primerMaterialId });
    const finish = surface.coatingLayers?.find((layer) => layer.phase === 'finish');
    const primer = surface.coatingLayers?.find((layer) => layer.phase === 'primer');
    const layers: NonNullable<ProductionPreviewItem['coatingLayers']> = products.finish ? [{ ...finish, id: finish?.id || 'finish', phase: 'finish', materialId: products.finish, coats: surface.coats, colorName: surface.colorName, colorCode: surface.colorCode, ...(surface.finishLossPercent?.trim() ? { lossAllowancePercent: surface.finishLossPercent } : {}) }] : [];
    const needsPrimer = surface.primerMode && surface.primerMode !== 'none';
    if (needsPrimer) layers.push({ ...primer, id: primer?.id || 'primer', phase: 'primer', materialId: products.primer, coats: surface.primerCoats || 1, ...(surface.primerLossPercent?.trim() ? { lossAllowancePercent: surface.primerLossPercent } : {}), ...(surface.primerMode === 'spot' ? { quantity: surface.primerQuantity || '0' } : { quantity: undefined }) });
    layers.push(...(surface.coatingLayers || []).filter((layer) => layer.id !== finish?.id && layer.id !== primer?.id && (needsPrimer || layer.phase !== 'primer')));
    const primerOperation = surface.operations?.find((operation) => operation.kind === 'primer');
    const applicationOperation = surface.operations?.find((operation) => operation.kind === 'application');
    let operations = surface.operations ? surface.operations.filter((operation) => needsPrimer || operation.kind !== 'primer').map((operation) => operation.id === applicationOperation?.id ? { ...operation, coats: surface.coats, adjustmentHours: surface.paintAdjustmentHours || operation.adjustmentHours } : (operation.kind === 'masking' || operation.kind === 'cut_in') && operation.hours === '' ? { ...operation, hours: '0' } : operation) : undefined;
    if (needsPrimer) {
      operations ||= [{ id: 'application', kind: 'application', coats: surface.coats, adjustmentHours: surface.paintAdjustmentHours || '0' }];
      const updatedPrimer: EstimatorOperation = { ...primerOperation, id: primerOperation?.id || 'primer', kind: 'primer', hours: surface.primerHours || primerOperation?.hours || (primerOperation ? undefined : '0'), quantity: surface.primerMode === 'spot' ? surface.primerQuantity || '0' : primerOperation?.quantity };
      operations = primerOperation ? operations.map((operation) => operation.id === primerOperation.id ? updatedPrimer : operation) : [...operations, updatedPrimer];
    }
    return { coatingLayers: surface.coatingLayers || layers.length ? layers : undefined, operations };
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
        const scopeCommitments = line.operations?.filter((operation) => (operation.kind === 'masking' || operation.kind === 'cut_in') && Number(operation.hours) > 0).map((operation) => surface.operations?.find((source) => source.id === operation.id)?.description?.trim() || (operation.kind === 'masking' ? 'Mask wall/ceiling color boundaries' : 'Cut in wall/ceiling color boundaries'));
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
          notes: calculationVersion === 'repaint-v2' ? `${coats} coat${coats === 1 ? '' : 's'}, ${method.label}, ${surface.prepLevel} prep` : `${quantity.quantity.toFixed(1)} ${rate.unit || 'sqft'}, ${coats} coat${coats === 1 ? '' : 's'}, ${method.label}, ${surface.prepLevel} prep, ${itemHours.toFixed(1)} labor hours`,
          ...(scopeCommitments?.length ? { scopeCommitments } : {}),
          coatingLayers: calculationVersion === 'repaint-v2' ? coatingSystem(surface).coatingLayers?.map((layer) => {
            const product = materials.find((material) => material.id === layer.materialId);
            return { ...layer, name: product?.name, brand: product?.brand };
          }) : undefined,
          labor: {
            hours: itemHours,
            rate: num(rate.hourlyRate, num(settings.defaultLaborRate, 65)),
            cost: dollars(line.laborMinor),
            coats,
            prepLevel: surface.prepLevel,
            applicationMethod: surface.applicationMethod,
            productionRatePerHour: num(rate.ratePerHour) * (calculationVersion === 'repaint-v1' ? method.productivity : 1),
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
    for (const line of calculation.items.filter((row) => row.id === 'estimator:minimum' || row.id === 'estimator:mobilization')) {
      items.push({ calculationItemId: line.id, calculatedSubtotalMinor: line.subtotalMinor, desc: line.id === 'estimator:minimum' ? 'Project minimum' : 'Mobilization', qty: 1, rate: dollars(line.subtotalMinor), kind: 'line_item', customerVisible: true, optional: false, notes: line.id === 'estimator:minimum' ? 'Project minimum adjustment' : `${line.hours} one-time mobilization hours` });
    }
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
      items: calculatedTotals.items.filter((item) => item.calculationItemId !== 'estimator:minimum' && item.calculationItemId !== 'estimator:mobilization'), lineItems: calculatedTotals.items.filter((item) => item.calculationItemId !== 'estimator:minimum' && item.calculationItemId !== 'estimator:mobilization'),
    }];
  }

  async function authoritativePreview() {
    const response = await apiJson<{ data: { calculation: EstimationResult; resolvedInput: EstimationRequest; taxSnapshot?: ResolvedEstimationTax } }>('/v1/production-rates/calculate', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(previewState.request),
    });
    if (currentPreviewKey.current !== previewState.key) throw new Error('Scope changed while pricing was checked. Review the current scope again.');
    setServerPreview({ key: previewState.key, ...response.data });
    return response.data;
  }

  async function reviewProposal() {
    if (!draftRecovery.online) return window.showToast?.('Reconnect before reviewing current pricing.', 'error');
    if (sendBlockers.length) return window.showToast?.(sendBlockers[0], 'error');
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
    if (!draftRecovery.online) return window.showToast?.('Saved locally only. Reconnect to save or send.', 'error');
    if ((editingSent || statusValue === 'sent') && sendBlockers.length) return window.showToast?.(sendBlockers[0], 'error');
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
      draftRecovery.clearAfterSave({ navigating: true });
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
  const allSurfaces = rooms.flatMap((room) => room.surfaces);
  const primerPending = allSurfaces.filter((surface) => surface.primerMode && surface.primerMode !== 'none');
  const sendBlockers = [
    ...(ready.zeroQuantity ? ['Resolve zero or invalid measurements before sending.'] : []),
    ...(ready.missingProduct ? ['Select finish products before sending; generic material allowances are not a priced coating system.'] : []),
    ...(allSurfaces.some((surface) => materials.find((material) => material.id === surfaceMaterialId(surface))?.category === 'primer') ? ['Select a finish product for the finish layer; primer alone is not a repaint system.'] : []),
    ...(primerPending.length && calculationVersion === 'repaint-v1' ? ['Primer is additional scope. Update to v2 pricing before sending a primer-plus-finish system.'] : []),
    ...(primerPending.some((surface) => !estimatorCoatingProducts(surface, { primer: primerMaterialId }).primer || !surface.primerHours?.trim() || (surface.primerMode === 'spot' && (!surface.primerQuantity?.trim() || num(surface.primerQuantity) <= 0))) ? ['Specify primer product, labor hours and spot quantity before sending.'] : []),
  ];
  const reviewWarnings = [
    ...sendBlockers,
    ...(ready.missingColor ? ['Unresolved colors may require separate purchase packs; order quantities are provisional.'] : []),
    ...(adjustments.length ? ['Add-on cost budgets are unknown; selling allowances do not establish direct cost.'] : []),
    ...(previewState.calculation?.items.some((item) => item.included && item.laborBudgetMinor == null) ? ['Burdened labor cost is missing. Selling hourly rates are not labor cost.'] : []),
    ...(previewState.calculation?.warnings.some((warning) => warning.code === 'STALE_PRICE') ? ['Product acquisition prices are stale; review the contractor pricebook.'] : []),
    ...(previewState.calculation?.warnings.some((warning) => warning.code === 'PROVISIONAL_COLOR_GROUP') ? ['Provisional color groups share purchasing demand, not a confirmed color specification.'] : []),
    ...(previewState.calculation?.warnings.some((warning) => warning.code === 'UNCONFIRMED_COLOR_RELATIONSHIP') ? ['Wall/ceiling color relationship is unconfirmed; verify separation scope.'] : []),
    ...rooms.flatMap((room) => room.surfaces.flatMap((surface) => [
      ...(surface.measurement?.source === 'starter_allowance' ? [`${room.name}: ${surface.label} uses starter allowances, not field measurements.`] : []),
      ...(surface.measurement && surface.measurement.source !== 'override' && JSON.stringify(surface.measurement.metrics) !== JSON.stringify(room.metrics) ? [`${room.name}: ${surface.label} has older room metrics; quantity was preserved.`] : []),
      ...(num(surface.prepAdjustmentHours) || num(surface.paintAdjustmentHours) ? [`${room.name}: ${surface.label} has manual labor corrections.`] : []),
      ...(calculationVersion === 'repaint-v2' && surface.prepLevel !== 'none' && !surface.prepAdjustmentHours.trim() && !surface.operations?.some((operation) => operation.kind === 'prep') ? [`${room.name}: ${surface.label} is missing one-time prep hours.`] : []),
      ...(surface.measurement?.warnings || []),
    ])),
    ...allSurfaces.flatMap((surface) => {
      const material = materials.find((row) => row.id === surfaceMaterialId(surface));
      return material && material.costPerUnit == null ? [`${surface.label}: product acquisition cost is missing.`] : [];
    }),
  ];
  const provenance = rooms.flatMap((room) => room.surfaces.map((surface) => {
    const rate = rates.find((row) => row.id === surface.rateId);
    const material = materials.find((row) => row.id === surfaceMaterialId(surface));
    const resolved = previewState.resolvedInput?.surfaces.find((item) => item.id === surface.id)?.labor;
    const operation = previewState.calculation?.items.find((item) => item.id === surface.id)?.operations?.find((item) => item.kind === 'application');
    const basis = calculationVersion === 'repaint-v1' ? 'legacy_per_coat' : resolved?.rateBasis || rate?.rateBasis || 'legacy_per_coat';
    const coverage = material?.coverageBasis === 'per_gallon' ? `${material.coveragePerGallon ?? material.coverageSqFt ?? 'missing'} sq ft/gallon` : `${material?.coverageSqFt ?? 'missing'} sq ft per ${material?.unit || 'pack'}`;
    return { id: surface.id, name: `${room.name}: ${surface.label}`, details: `Rate basis: ${labelize(basis)}; ${operation?.selectedRate ?? rate?.ratePerHour ?? 'missing'} ${basis === 'hours_per_item' ? 'hours/item' : `${rate?.unit || 'sqft'}/hr`}; ${surface.coats} coats. Sell rate ${resolved?.sellingRate != null ? formatMoney(resolved.sellingRate) : 'missing'}/hr (${resolved?.sellingRateSource || (rate?.hourlyRate != null ? 'rate override' : 'organization')}); burdened rate ${resolved?.burdenedRate == null ? 'missing' : formatMoney(resolved.burdenedRate)}. ${calculationVersion === 'repaint-v2' ? `One-time prep: ${surface.prepAdjustmentHours || 'not entered'} hours; no automatic severity or method multiplier.` : `Legacy prep factor ${resolved?.prepMultiplier ?? 1}; method factor ${resolved?.productivity ?? 1}.`} ${material ? `Coverage ${coverage}; acquisition ${material.costPerUnit == null ? 'missing' : formatMoney(material.costPerUnit)}/pack; markup ${material.markupPercent ?? settings.materialMarkupPercent ?? 0}%. Source ${material.provenance?.source || 'unrecorded'}; price date ${material.provenance?.priceDate || 'unrecorded'}.` : 'Generic unverified material allowance; choose a product.'} Measurement ${surface.measurement?.source || (surface.quantity ? 'override' : 'measured dimensions')}; opening policy ${surface.measurement?.policy.id || 'not recorded'}.` };
  }));

  function duplicateRoom(room: Room) {
    const next = structuredClone(room);
    next.id = uid('room'); next.name = `${room.name} copy`;
    next.surfaces = next.surfaces.map((surface) => ({ ...surface, id: uid('surface') }));
    setRooms((current) => [...current, next]);
    estimatorEvent('room_duplicated');
  }

  function applyBulkProduct() {
    setRooms((current) => current.map((room) => !bulkRoomIds.includes(room.id) ? room : { ...room, surfaces: room.surfaces.map((surface) => surface.materialId && !replaceProductOverrides ? surface : { ...surface, materialId: bulkFinishId }) }));
    setBulkProducts(false);
    estimatorEvent('products_applied', { roomCount: bulkRoomIds.length, replaceOverrides: replaceProductOverrides });
  }

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

  if (setupError) return <section className="estimator-page mx-auto max-w-6xl py-5"><EstimatorStyles /><h2 className="pf-section-title">Estimator needs attention</h2><p className="pf-copy my-3" role="alert">{setupError}</p><button className="btn-secondary" onClick={loadSetup}>Reload estimator</button></section>;

  return (
    <div className="estimator-page mx-auto max-w-6xl py-5 sm:py-8">
      <EstimatorStyles />
      <datalist id="crewmodo-catalog-colors">
        {catalogColors.map((color) => (
          <option key={color.id} value={[color.name, color.colorCode ? `(${color.colorCode})` : ''].filter(Boolean).join(' ')}>
            {[color.supplierName, color.family].filter(Boolean).join(' - ')}
          </option>
        ))}
      </datalist>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="pf-row-title">{editingEstimate ? 'Edit production estimate' : 'Production estimate'}</p>
          <p className="pf-meta" aria-live="polite">{draftRecovery.online ? draftRecovery.status : 'Offline: local changes only. Sending requires a connection.'}</p>
          {calculationVersion === 'repaint-v1' && <button className="btn-text" onClick={() => setConfirmV2(true)}>Update to v2 pricing</button>}
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
          <section className="border-b pb-4">
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
            <div className="mt-4 border-t pt-3">
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
          </section>

          <section>
            <div className="border-b p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardHeader className="mb-0" title="Rooms & Scope" />
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
              <div className="border-b px-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="pf-meta">Starter scope{starterSkipped ? ' skipped' : ''}</p>
                  <button className="btn-text btn-sm" onClick={() => { setStarterCollapsed(false); setStarterSkipped(false); setTemplateApplied(false); }}>Review</button>
                </div>
              </div>
            )}

            <div className="divide-y px-1 sm:px-4">
              {rooms.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-300 p-5 text-center">
                  <p className="pf-row-title">Start with a room, exterior elevation, or work space.</p>
                  <p className="pf-meta mt-1">{templateApplied ? 'Add spaces manually or choose another template from Templates.' : 'Use starter scope for a generated first pass, or add a space manually.'}</p>
                </div>
              ) : rooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  photoEstimateId={editingEstimate?.id || estimateId}
                  savePhotoDraft={() => void persistEstimate('draft')}
                  ratesByCategory={ratesByCategory}
                  rates={rates}
                  materials={paintMaterials}
                  catalogColors={catalogColors}
                  duplicateRoom={() => duplicateRoom(room)}
                  defaultPrimerId={primerMaterialId}
                  defaultFinishId={paintMaterialId}
                  calculationVersion={calculationVersion}
                  roomSummary={{ hours: previewState.calculation?.items.filter((line) => room.surfaces.some((surface) => surface.id === line.id) && line.included).reduce((sum, line) => sum + Number(line.hours), 0).toFixed(1) || '0.0', price: previewState.error ? '--' : formatMoney(totals.items.filter((line) => room.surfaces.some((surface) => surface.id === line.calculationItemId) && !line.optional).reduce((sum, line) => sum + Number(line.rate), 0)) }}
                  updateRoom={updateRoom}
                  updateSurface={updateSurface}
                  updateSurfaceColor={updateSurfaceColor}
                  removeRoom={(roomId) => setDeleteRoomId(roomId)}
                  addSurface={addSurface}
                  removeSurface={(roomId, surfaceId) => { setRooms((current) => current.map((item) => item.id === roomId ? { ...item, surfaces: item.surfaces.filter((surface) => surface.id !== surfaceId) } : item).filter((item) => item.id !== roomId || item.surfaces.length > 0)); estimatorEvent('substrate_removed'); }}
                  useRoomMetrics={useRoomMetrics}
                  surfaceTotal={(surface) => {
                    const line = totals.items.find((item) => item.calculationItemId === surface.id);
                    return previewState.error ? '--' : line ? formatMoney(line.rate || 0) : '$0.00';
                  }}
                  calculationError={{ field: previewState.errorField, message: previewState.error }}
                />
              ))}
            </div>
          </section>

          <section className="border-t">
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
                      <p className="pf-label-small">{num(item.dimensions?.quantity).toFixed(1)} {unitLabel(item.dimensions?.unit)}</p>
                    </div>
                    <StatusBadge status={item.material?.status || 'TBD'} />
                  </div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <PaintScheduleCell label="Product" value={item.coatingLayers?.length ? item.coatingLayers.map((layer) => `${labelize(layer.phase)}: ${[layer.brand, layer.name].filter(Boolean).join(' ') || 'Missing product'} (${layer.coats} coats)`).join('; ') : [item.material?.brand, item.material?.name].filter(Boolean).join(' ') || 'Missing product'} />
                    <PaintScheduleCell label="Color" value={[item.material?.colorName, item.material?.colorCode].filter(Boolean).join(' ') || 'TBD'} />
                    <PaintScheduleCell label="Crew note" value={item.material?.crewNote || 'None'} />
                    {item.scopeCommitments?.length ? <PaintScheduleCell label="Included work" value={item.scopeCommitments.join('; ')} /> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="border-t">
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
                  {calculationVersion === 'repaint-v2' && <details className="border-t pt-2 sm:col-span-4">
                    <summary className="pf-row-title flex min-h-12 cursor-pointer items-center">Internal cost and hours</summary>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <NumberField label="Direct cost per unit ($)" value={item.costPerUnit || ''} onChange={(value) => updateAdjustment(item.id, { costPerUnit: value, costUnknown: value.trim() === '' })} />
                      <NumberField label="Labor hours per unit" value={item.hoursPerUnit || ''} onChange={(value) => updateAdjustment(item.id, { hoursPerUnit: value })} />
                      <NumberField label="Burdened rate override ($/hr)" value={item.burdenedRate || ''} onChange={(value) => updateAdjustment(item.id, { burdenedRate: value })} />
                    </div>
                    <label className="pf-inline-option"><input type="checkbox" checked={item.costUnknown ?? !item.costPerUnit?.trim()} onChange={(event) => updateAdjustment(item.id, { costUnknown: event.target.checked })} />Unknown direct cost</label>
                  </details>}
                </div>
              ))}
            </div>
          </section>
        </section>

        <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 self-start">
          <section className="border-t pt-3">
            <CardHeader title="Estimate Summary" />
            {previewState.error && <p id="estimate-calculation-error" className="pf-field-error mb-3" role="alert">{previewState.error}</p>}
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
          </section>

          {calculationVersion === 'repaint-v2' && <details className="border-t pt-3">
            <summary className="pf-row-title flex min-h-12 cursor-pointer items-center">Commercial details</summary>
            <div className="space-y-3">
              <NumberField label="Project minimum ($)" value={minimumPrice} onChange={setMinimumPrice} />
              <NumberField label="One-time mobilization hours" value={mobilizationHours} onChange={setMobilizationHours} />
              <p className="pf-helper">Organization defaults: minimum {settings.minimumPrice == null ? 'not set' : formatMoney(settings.minimumPrice)}; mobilization {settings.mobilizationHours ?? 'not set'} hr.</p>
            </div>
          </details>}

          <section className="border-t pt-3">
            <CardHeader title="Paint Products" />
            <div className="space-y-3">
              <label>
                <span className="form-label">Wall/finish paint</span>
                <select className="input mt-1" value={paintMaterialId} onChange={(event) => setPaintMaterialId(event.target.value)}>
                  <option value="">Select finish product</option>
                  {paintMaterials.filter((material) => material.category !== 'primer').map((material) => <option key={material.id} value={material.id}>{materialLabel(material)}</option>)}
                </select>
              </label>
              <label>
                <span className="form-label">Shared primer product</span>
                <select className="input mt-1" value={primerMaterialId} onChange={(event) => setPrimerMaterialId(event.target.value)}>
                  <option value="">Select primer product</option>
                  {paintMaterials.map((material) => <option key={material.id} value={material.id}>{materialLabel(material)}</option>)}
                </select>
              </label>
              <p className="pf-meta">{paintMaterials.length ? 'Coverage, unit cost, and markup are pulled from Materials.' : 'Add paint and primer products in Materials to calculate product-specific costs.'}</p>
              <button className="btn-secondary w-full" onClick={() => { setBulkRoomIds(rooms.map((room) => room.id)); setBulkFinishId(paintMaterialId); setReplaceProductOverrides(false); setBulkProducts(true); }} disabled={!rooms.length}>Apply products to rooms</button>
              {calculationVersion === 'repaint-v2' && <label><span className="form-label">Material selling basis</span><select className="input" value={materialSellingPolicy} onChange={(event) => setMaterialSellingPolicy(event.target.value as 'purchase' | 'consumption')}><option value="purchase">Purchased packs</option><option value="consumption">Theoretical consumption</option></select></label>}
            </div>
          </section>

          <section className="border-t pt-3">
            <CardHeader title="Production Readiness" />
            <div className="space-y-2">
              <ReadinessRow label="Missing customer" count={ready.missingCustomer} />
              <ReadinessRow label="Zero-quantity substrates" count={ready.zeroQuantity} />
              <ReadinessRow label="Missing products" count={ready.missingProduct} />
              <ReadinessRow label="Color selections needed" count={ready.missingColor} />
            </div>
            <EstimatorInternalReview calculation={previewState.calculation} input={previewState.resolvedInput} warnings={reviewWarnings} provenance={provenance} />
            {'taxSnapshot' in previewState && previewState.taxSnapshot && <p className="pf-helper mt-3">Tax policy: {previewState.taxSnapshot.label} ({previewState.taxSnapshot.source}){previewState.taxSnapshot.overrideReason ? `; ${previewState.taxSnapshot.overrideReason}` : ''}.</p>}
            <details className="mt-3 border-t">
              <summary className="pf-row-title flex min-h-12 cursor-pointer items-center">Advanced tax</summary>
              <label className="pf-inline-option"><input type="checkbox" checked={taxOverrideEnabled} onChange={(event) => setTaxOverrideEnabled(event.target.checked)} />Override estimate tax</label>
              {taxOverrideEnabled && <div className="space-y-3">
                <NumberField label="Tax rate (%)" value={taxOverrideRate} onChange={setTaxOverrideRate} />
                <label><span className="form-label">Tax override reason</span><input className="input" maxLength={500} value={taxOverrideReason} onChange={(event) => setTaxOverrideReason(event.target.value)} /></label>
              </div>}
              <Link className="btn-text" to="/settings#estimation-tax-settings">View tax settings</Link>
            </details>
            <div className="mt-4 grid gap-2">
              {!editingSent && (
                <button className="btn-secondary justify-center" disabled={isSaving || isReviewing || Boolean(previewState.error) || !draftRecovery.online} onClick={() => persistEstimate('draft')}>{isSaving ? 'Saving...' : 'Save draft'}</button>
              )}
              <button className="btn-primary justify-center" disabled={isSaving || isReviewing || Boolean(previewState.error) || !draftRecovery.online || sendBlockers.length > 0} aria-busy={isReviewing} onClick={reviewProposal}>
                {isReviewing ? 'Checking pricing...' : editingSent ? 'Review update' : 'Review proposal'}
              </button>
            </div>
            {saveStatus && <p className="pf-copy mt-3" aria-live="polite">{saveStatus}</p>}
          </section>
        </aside>
      </div>

      <div className="estimator-actions flex items-center gap-2">
        <span className="pf-value min-w-0 flex-1">{previewState.error ? '--' : formatMoney(totals.total)}</span>
        <button className="btn-primary" disabled={isSaving || isReviewing || Boolean(previewState.error) || sendBlockers.length > 0 || !draftRecovery.online} onClick={reviewProposal}>{isReviewing ? 'Checking pricing...' : editingSent ? 'Review update' : 'Review proposal'}</button>
      </div>

      <Modal isOpen={confirmV2} onClose={() => setConfirmV2(false)} title="Update calculation version">
        <p className="pf-copy">Reprice this unsigned estimate with independent prep, coating layers and current cost policies. Existing saved totals are not changed until you save.</p>
        <ModalFooter><button className="btn-secondary" onClick={() => setConfirmV2(false)}>Keep v1 pricing</button><button className="btn-primary" onClick={() => { setCalculationVersion('repaint-v2'); setServerPreview(null); setConfirmV2(false); estimatorEvent('version_updated'); }}>Use v2 pricing</button></ModalFooter>
      </Modal>
      <Modal isOpen={Boolean(draftRecovery.candidate)} onClose={draftRecovery.discard} closeOnEscape={false} closeOnBackdrop={false} title="Recover local draft">
        <p className="pf-copy">A draft from this account was saved on this device {draftRecovery.candidate ? new Date(draftRecovery.candidate.savedAt).toLocaleString() : ''}. Local drafts expire after 7 days and contain customer and scope details.</p>
        {draftRecovery.conflict && <p className="pf-copy mt-3 text-amber-800">The server estimate changed. Restoring replaces the current editor scope, not the saved agreement. Review current pricing before saving.</p>}
        <ModalFooter><button className="btn-secondary" onClick={draftRecovery.discard}>Discard draft</button><button className="btn-primary" onClick={restoreDraft}>Restore draft</button></ModalFooter>
      </Modal>
      <Modal isOpen={Boolean(pendingStarter)} onClose={() => setPendingStarter(null)} title="Add starter scope">
        <p className="pf-copy">Keep the existing {rooms.length} rooms and append {pendingStarter?.length} starter rooms, or replace all rooms and their substrates. Add-ons are retained.</p>
        {confirmStarterReplace && <p className="pf-copy mt-3 text-red-700">Replacing removes edited measurements, products, notes and options in all existing rooms.</p>}
        <ModalFooter>
          <button className="btn-secondary" onClick={() => setPendingStarter(null)}>Cancel</button>
          <button className="btn-secondary" onClick={() => { if (pendingStarter) applyStarter(pendingStarter, false); }}>Append rooms</button>
          <button className="btn-text text-red-700" onClick={() => { if (confirmStarterReplace && pendingStarter) applyStarter(pendingStarter, true); else setConfirmStarterReplace(true); }}>{confirmStarterReplace ? 'Confirm replace' : 'Replace all rooms'}</button>
        </ModalFooter>
      </Modal>
      <Modal isOpen={Boolean(metricReplacement)} onClose={() => setMetricReplacement(null)} title="Replace field measurement">
        <p className="pf-copy">This substrate has a manual field measurement. Use the current room metrics and recorded opening/casing policy instead?</p>
        <ModalFooter><button className="btn-secondary" onClick={() => setMetricReplacement(null)}>Keep measurement</button><button className="btn-primary" onClick={() => { if (metricReplacement) useRoomMetrics(metricReplacement.roomId, metricReplacement.surfaceId, true); }}>Use room metrics</button></ModalFooter>
      </Modal>
      <Modal isOpen={Boolean(deleteRoomId)} onClose={() => setDeleteRoomId('')} title="Delete room">
        <p className="pf-copy">Delete this room and all of its substrates, measurements and notes?</p>
        <ModalFooter><button className="btn-secondary" onClick={() => setDeleteRoomId('')}>Cancel</button><button className="btn-text text-red-700" onClick={() => { setRooms((current) => current.filter((room) => room.id !== deleteRoomId)); setDeleteRoomId(''); estimatorEvent('room_deleted'); }}>Delete room</button></ModalFooter>
      </Modal>
      <Modal isOpen={bulkProducts} onClose={() => setBulkProducts(false)} title="Apply room products" size="lg">
        <div className="estimator-editor space-y-3">
          <label><span className="form-label">Shared finish product</span><select className="input" value={bulkFinishId} onChange={(event) => setBulkFinishId(event.target.value)}><option value="">Use estimate finish product</option>{paintMaterials.filter((material) => material.category !== 'primer').map((material) => <option key={material.id} value={material.id}>{materialLabel(material)}</option>)}</select></label>
          <label className="pf-inline-option"><input type="checkbox" checked={replaceProductOverrides} onChange={(event) => setReplaceProductOverrides(event.target.checked)} />Replace explicit substrate products</label>
          <div className="divide-y">{rooms.map((room) => <label key={room.id} className="pf-inline-option flex"><input type="checkbox" checked={bulkRoomIds.includes(room.id)} onChange={(event) => setBulkRoomIds((current) => event.target.checked ? [...current, room.id] : current.filter((id) => id !== room.id))} />{room.name}</label>)}</div>
        </div>
        <ModalFooter><button className="btn-secondary" onClick={() => setBulkProducts(false)}>Cancel</button><button className="btn-primary" disabled={!bulkRoomIds.length} onClick={applyBulkProduct}>Apply products</button></ModalFooter>
      </Modal>

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
  duplicateRoom,
  defaultPrimerId,
  defaultFinishId,
  roomSummary,
  calculationVersion,
  photoEstimateId,
  savePhotoDraft,
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
  duplicateRoom: () => void;
  defaultPrimerId: string;
  defaultFinishId: string;
  roomSummary: { hours: string; price: string };
  calculationVersion: 'repaint-v1' | 'repaint-v2';
  photoEstimateId?: string;
  savePhotoDraft: () => void;
}) {
  const [expanded, setExpanded] = useState(room.surfaces.length === 0);
  const [editRoom, setEditRoom] = useState(false);
  const [editSurfaceId, setEditSurfaceId] = useState('');
  const [confirmSubstrateDelete, setConfirmSubstrateDelete] = useState('');
  function setMetric(key: keyof EstimatorRoomMetrics, value: string) {
    const metrics = { ...room.metrics, [key]: value === '' ? undefined : Number(value) };
    if (key === 'length' || key === 'width') metrics.perimeter = undefined;
    updateRoom(room.id, { metrics });
  }
  function editSeparation(surface: Surface, kind: 'masking' | 'cut_in', operation: EstimatorOperation | undefined, patch: Partial<EstimatorOperation>) {
    const operations: EstimatorOperation[] = surface.operations ? [...surface.operations] : [{ id: 'application', kind: 'application', coats: surface.coats, adjustmentHours: surface.paintAdjustmentHours || '0' }];
    if (operation) {
      updateSurface(room.id, surface.id, { operations: operations.map((current) => current.id === operation.id ? { ...current, ...patch } : current) });
    } else {
      if (patch.hours === '') return;
      operations.push({ id: uid(`color-${kind}`), kind, coats: 1, hours: '0', description: kind === 'masking' ? 'Mask wall/ceiling color boundaries' : 'Cut in wall/ceiling color boundaries', ...patch });
      updateSurface(room.id, surface.id, { operations });
      estimatorEvent('separation_added', { kind });
    }
  }
  return (
    <EstimatorRoomRow name={room.name} count={room.surfaces.length} {...roomSummary} expanded={expanded} onExpand={() => setExpanded(!expanded)} onEdit={() => { setExpanded(true); setEditRoom(true); }} onDuplicate={duplicateRoom} onDelete={() => removeRoom(room.id)}>
      <EstimatorEditSheet open={editRoom} onClose={() => setEditRoom(false)} title={`Edit room: ${room.name}`}>
        <label className="min-w-0">
          <span className="form-label">Room / Space</span>
          <input className="input pf-value mt-1" maxLength={200} value={room.name} onChange={(event) => updateRoom(room.id, { name: event.target.value })} placeholder="Bedroom 1, front elevation, kitchen cabinets" />
        </label>
        <EstimatorGroup title="Room photos"><EstimatorRoomPhotos estimateId={photoEstimateId} roomName={room.name} onSaveDraft={savePhotoDraft} /></EstimatorGroup>
        <EstimatorGroup title="Room metrics" open>
          <div className="grid gap-3 sm:grid-cols-2">
            {([['length', 'Room length'], ['width', 'Room width'], ['perimeter', 'Room perimeter override'], ['height', 'Room height'], ['windows', 'Window count'], ['doors', 'Door count']] as const).map(([key, label]) => <NumberField key={key} label={label} value={room.metrics?.[key] == null ? '' : String(room.metrics[key])} onChange={(value) => setMetric(key, value)} />)}
            {room.kind === 'exterior' && <><NumberField label="Soffit depth" value={String(room.metrics?.soffitDepth ?? '')} onChange={(value) => setMetric('soffitDepth', value)} /><NumberField label="Roofline factor" value={String(room.metrics?.rooflineFactor ?? '')} onChange={(value) => setMetric('rooflineFactor', value)} /><NumberField label="Corner count" value={String(room.metrics?.corners ?? '')} onChange={(value) => setMetric('corners', value)} /></>}
            <label><span className="form-label">Room trim scope</span><select className="input" value={room.metrics?.trimScope || 'base'} onChange={(event) => updateRoom(room.id, { metrics: { ...room.metrics, trimScope: event.target.value as EstimatorRoomMetrics['trimScope'] } })}><option value="none">None</option><option value="base">Baseboards</option><option value="base-casing">Baseboards + casing</option><option value="base-crown-casing">Baseboards + crown + casing</option><option value="casing">Casing only</option></select></label>
          </div>
          <label className="pf-inline-option"><input type="checkbox" checked={room.metrics?.openingPolicy?.deductOpenings ?? false} onChange={(event) => updateRoom(room.id, { metrics: { ...room.metrics, openingPolicy: { ...(room.metrics?.openingPolicy || (room.kind === 'exterior' ? ESTIMATOR_EXTERIOR_OPENINGS : ESTIMATOR_INTERIOR_OPENINGS)), deductOpenings: event.target.checked } } })} />Deduct opening area</label>
          <div className="grid gap-3 sm:grid-cols-2">{(['windowArea', 'doorArea', 'windowCasing', 'doorCasing'] as const).map((key) => <NumberField key={key} label={labelize(key.replace(/([A-Z])/g, ' $1'))} value={String(room.metrics?.openingPolicy?.[key] ?? (room.kind === 'exterior' ? ESTIMATOR_EXTERIOR_OPENINGS : ESTIMATOR_INTERIOR_OPENINGS)[key])} onChange={(value) => updateRoom(room.id, { metrics: { ...room.metrics, openingPolicy: { ...(room.metrics?.openingPolicy || { ...ESTIMATOR_INTERIOR_OPENINGS, deductOpenings: false }), [key]: value === '' ? 0 : Number(value) } } })} />)}</div>
          <p className="pf-helper">{room.metrics?.openingPolicy?.id || 'Gross area, no deductions'}. Existing substrate quantities are retained until Use room metrics is selected.</p>
        </EstimatorGroup>
      </EstimatorEditSheet>
      <div className="divide-y">
        {room.surfaces.map((surface) => {
          const productName = materials.find((material) => material.id === (surface.materialId || defaultFinishId))?.name || 'Finish TBD';
          return <button key={surface.id} className="btn-text estimator-disclosure flex min-h-12 w-full items-center gap-2 py-3 text-left" onClick={() => setEditSurfaceId(surface.id)} aria-label={`Edit ${surface.label} in ${room.name}`}>
            <span className="min-w-0 flex-1"><span className="pf-value block break-words">{surface.label}{surface.optional ? ' (option)' : ''}{!surface.customerVisible ? ' (private)' : ''}</span><span className="pf-meta block break-words">{surface.quantity || (num(surface.width) * (rates.find((rate) => rate.id === surface.rateId)?.unit === 'linear_ft' ? 1 : num(surface.height))).toFixed(1)} {unitLabel(rates.find((rate) => rate.id === surface.rateId)?.unit || 'sqft')} · {surface.coats} coats · {surface.measurement?.source === 'override' ? 'Override' : surface.measurement?.source === 'starter_allowance' ? 'Allowance' : surface.measurement ? 'Derived' : 'Measured'}{calculationError.field.startsWith(`${surface.id}.`) ? ' · Needs attention' : ''}</span><span className="pf-meta estimator-product-summary" title={productName}>{productName}</span></span><span className="pf-value shrink-0">{surfaceTotal(surface)}</span><Icon name="edit" className="h-4 w-4 shrink-0" />
          </button>;
        })}
        <div className="py-2">
          <button className="btn-secondary btn-sm" onClick={() => { addSurface(room.id); setExpanded(true); }}> <Icon name="plus" className="h-4 w-4" />Add substrate</button>
        </div>
      </div>
      <div>
        {room.surfaces.filter((surface) => surface.id === editSurfaceId).map((surface) => {
          const rate = rates.find((item) => item.id === surface.rateId);
          const config = measurementConfig(rate);
          const canUseRoomMetrics = Boolean(room.metrics && ['walls', 'ceilings', 'trim', 'doors', 'exterior_body', 'soffit', 'fascia', 'corner_boards'].includes(surface.geometryKind || rateKind(rate)));
          const errorId = `${surface.id}-calculation-error`;
          const errorFor = (field: string) => calculationError.field === `${surface.id}.${field}` ? errorId : undefined;
          return (
            <EstimatorEditSheet key={surface.id} open onClose={() => setEditSurfaceId('')} title={`${room.name}: ${surface.label}`}>
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
                        geometryKind: undefined,
                        measurement: undefined,
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
              <EstimatorGroup title="Measurement" open>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {config.showWidth !== false && <NumberField label={config.width} errorId={errorFor('width')} value={surface.width} onChange={(value) => updateSurface(room.id, surface.id, { width: value })} />}
                {config.showHeight !== false && <NumberField label={config.height} errorId={errorFor('height')} value={surface.height} onChange={(value) => updateSurface(room.id, surface.id, { height: value })} />}
                <NumberField label={config.quantity} errorId={errorFor('quantity')} value={surface.quantity} onChange={(value) => updateSurface(room.id, surface.id, { quantity: value })} />
              </div>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="pf-helper">{surface.quantity !== '' ? 'Explicit quantity takes precedence over dimensions.' : config.helper} {surface.measurement ? `${surface.measurement.source}; ${surface.measurement.policy.id}; gross ${surface.measurement.gross}, deduction ${surface.measurement.deduction}.` : ''}</p>
                {canUseRoomMetrics && <button className="btn-text btn-sm shrink-0" onClick={() => useRoomMetrics(room.id, surface.id)}>Use room metrics</button>}
              </div>
              </EstimatorGroup>
              <EstimatorGroup title="Coating" open>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <label><span className="form-label">Coats</span><select className="input mt-1" aria-label="Coats" value={surface.coats} onChange={(event) => updateSurface(room.id, surface.id, { coats: Number(event.target.value) })}><option value="1">1 coat</option><option value="2">2 coats</option><option value="3">3 coats</option></select></label>
                {rate?.unit === 'linear_ft' && <NumberField label="Painted width (in)" errorId={errorFor('coatingWidthInches')} value={surface.coatingWidthInches} onChange={(value) => updateSurface(room.id, surface.id, { coatingWidthInches: value })} />}
                {rate?.unit === 'each' && <NumberField label="Painted sq ft/item" errorId={errorFor('coatingSqFtPerItem')} value={surface.coatingSqFtPerItem} onChange={(value) => updateSurface(room.id, surface.id, { coatingSqFtPerItem: value })} />}
                <label>
                  <span className="form-label">Method</span>
                  <select className="input mt-1" value={surface.applicationMethod} onChange={(event) => updateSurface(room.id, surface.id, { applicationMethod: event.target.value as ApplicationMethod })}>
                    {Object.entries(applicationMethods).filter(([value]) => calculationVersion !== 'repaint-v2' || !rate?.applicationMethod || value === rate.applicationMethod).map(([value, method]) => <option key={value} value={value}>{method.label}</option>)}
                  </select>
                </label>
                <label>
                  <span className="form-label">Finish product</span>
                  <select className="input mt-1" value={surface.materialId} onChange={(event) => updateSurface(room.id, surface.id, { materialId: event.target.value })}>
                    <option value="">Use estimate product</option>
                    {materials.filter((material) => material.category !== 'primer' || material.id === surface.materialId).map((material) => <option key={material.id} value={material.id}>{materialLabel(material)}</option>)}
                  </select>
                </label>
              </div>
              <label><span className="form-label">Primer scope</span><select className="input" value={surface.primerMode || 'none'} onChange={(event) => updateSurface(room.id, surface.id, { primerMode: event.target.value as Surface['primerMode'], primerCoats: surface.primerCoats || 1 })}><option value="none">No primer</option><option value="spot">Spot primer</option><option value="full">Full primer</option></select></label>
              {surface.primerMode && surface.primerMode !== 'none' && <>
                <label><span className="form-label">Primer product</span><select className="input" value={surface.primerMaterialId || ''} onChange={(event) => updateSurface(room.id, surface.id, { primerMaterialId: event.target.value })}><option value="">{defaultPrimerId ? 'Use shared primer product' : 'Select primer product'}</option>{materials.map((material) => <option key={material.id} value={material.id}>{materialLabel(material)}</option>)}</select></label>
                <label><span className="form-label">Primer coats</span><select className="input" value={surface.primerCoats || 1} onChange={(event) => updateSurface(room.id, surface.id, { primerCoats: Number(event.target.value) })}><option value="1">1 coat</option><option value="2">2 coats</option></select></label>
                {surface.primerMode === 'spot' && <NumberField label={`Primer quantity (${unitLabel(rate?.unit || 'sqft')})`} value={surface.primerQuantity || ''} onChange={(value) => updateSurface(room.id, surface.id, { primerQuantity: value })} />}
                <NumberField label="Primer labor hours" value={surface.primerHours || ''} onChange={(value) => updateSurface(room.id, surface.id, { primerHours: value })} />
                <p className="pf-helper">Primer is additional to finish, with its own application labor. {calculationVersion === 'repaint-v1' ? 'Update to v2 pricing before sending.' : ''}</p>
              </>}
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_0.7fr_0.8fr]">
                <label><span className="form-label">Color name</span><input className="input mt-1" maxLength={120} list="crewmodo-catalog-colors" value={surface.colorName} onChange={(event) => updateSurfaceColor(room.id, surface.id, event.target.value)} placeholder={catalogColors.length ? 'Search color library' : ''} /></label>
                <label><span className="form-label">Color code</span><input className="input mt-1" maxLength={80} value={surface.colorCode} onChange={(event) => updateSurface(room.id, surface.id, { colorCode: event.target.value })} /></label>
                <label><span className="form-label">Color status</span><select className="input mt-1" aria-label="Color status" value={surface.colorStatus} onChange={(event) => updateSurface(room.id, surface.id, { colorStatus: event.target.value })}>
                  {['TBD', 'Selected', 'Approved', 'Ordered', 'Delivered', 'Changed'].map((status) => <option key={status} value={status}>{status}</option>)}
                </select></label>
              </div>
              </EstimatorGroup>
              <EstimatorGroup title="Preparation">
                <div className="grid gap-3">
                <label><span className="form-label">Prep commitment</span><select className="input" value={surface.prepLevel} onChange={(event) => updateSurface(room.id, surface.id, { prepLevel: event.target.value as PrepLevel })}><option value="none">No prep</option><option value="light">Light prep</option><option value="standard">Standard prep</option><option value="heavy">Heavy prep</option></select></label>
                <NumberField label={calculationVersion === 'repaint-v2' ? 'One-time prep hours' : 'Prep hours +/-'} allowNegative={calculationVersion === 'repaint-v1'} errorId={errorFor('prepAdjustmentHours')} value={surface.prepAdjustmentHours} onChange={(value) => updateSurface(room.id, surface.id, { prepAdjustmentHours: value })} />
                <NumberField label="Paint hours +/-" allowNegative errorId={errorFor('paintAdjustmentHours')} value={surface.paintAdjustmentHours} onChange={(value) => updateSurface(room.id, surface.id, { paintAdjustmentHours: value })} />
                </div>
              </EstimatorGroup>
              <EstimatorGroup title="Advanced">
                {calculationVersion === 'repaint-v2' && <>
                  <NumberField label="Finish loss allowance (%)" value={surface.finishLossPercent || ''} onChange={(value) => updateSurface(room.id, surface.id, { finishLossPercent: value })} />
                  {surface.primerMode && surface.primerMode !== 'none' && <NumberField label="Primer loss allowance (%)" value={surface.primerLossPercent || ''} onChange={(value) => updateSurface(room.id, surface.id, { primerLossPercent: value })} />}
                  <label><span className="form-label">Wall/ceiling color relationship</span><select className="input" value={surface.colorRelationship || ''} onChange={(event) => updateSurface(room.id, surface.id, { colorRelationship: event.target.value ? event.target.value as Surface['colorRelationship'] : undefined })}><option value="">Not specified</option><option value="same">Same color</option><option value="different">Different colors</option><option value="unconfirmed">Unconfirmed</option></select></label>
                  {((['walls', 'ceilings'].includes(surface.geometryKind || rateKind(rate)) && ['different', 'unconfirmed'].includes(surface.colorRelationship || '')) || surface.operations?.some((operation) => operation.kind === 'masking' || operation.kind === 'cut_in')) && <EstimatorGroup title="Color separation">
                    {(['masking', 'cut_in'] as const).map((kind) => {
                      const existing = surface.operations?.filter((operation) => operation.kind === kind) || [];
                      const label = kind === 'masking' ? 'Masking' : 'Cut-in';
                      return (existing.length ? existing : [undefined]).map((operation, index) => {
                        const suffix = index ? ` (${index + 1})` : '';
                        return <div key={operation?.id || kind} className="space-y-2 border-b pb-3">
                          <div className="flex items-end gap-2">
                            <div className="min-w-0 flex-1"><NumberField label={`One-time ${label.toLowerCase()} hours${suffix}`} errorId={operation ? errorFor(`operations.${operation.id}.hours`) : undefined} value={operation?.hours?.toString() ?? ''} onChange={(hours) => editSeparation(surface, kind, operation, { hours })} /></div>
                            {operation && <button className="btn-icon btn-icon-danger min-w-12 shrink-0" aria-label={`Remove ${label.toLowerCase()} operation${suffix}`} title={`Remove ${label.toLowerCase()} operation${suffix}`} onClick={() => { updateSurface(room.id, surface.id, { operations: surface.operations?.filter((current) => current.id !== operation.id) }); estimatorEvent('separation_removed', { kind }); }}><Icon name="trash" className="h-5 w-5" /></button>}
                          </div>
                          {operation && <label className="block"><span className="form-label">{label} scope{suffix}</span><input className="input mt-1" maxLength={300} value={operation.description || ''} onChange={(event) => editSeparation(surface, kind, operation, { description: event.target.value })} /></label>}
                        </div>;
                      });
                    })}
                  </EstimatorGroup>}
                  <label><span className="form-label">Shared provisional color group</span><input className="input" maxLength={100} value={surface.provisionalColorGroup || ''} onChange={(event) => updateSurface(room.id, surface.id, { provisionalColorGroup: event.target.value })} /></label>
                </>}
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                <label><span className="form-label">Crew note</span><input className="input mt-1" maxLength={500} value={surface.crewNote} onChange={(event) => updateSurface(room.id, surface.id, { crewNote: event.target.value })} /></label>
                <div className="flex items-center justify-between gap-3">
                  <label className="pf-inline-option"><input type="checkbox" checked={surface.customerVisible} onChange={(event) => updateSurface(room.id, surface.id, { customerVisible: event.target.checked })} />Show</label>
                  <label className="pf-inline-option"><input type="checkbox" checked={surface.optional} onChange={(event) => updateSurface(room.id, surface.id, { optional: event.target.checked })} />Option</label>
                  <span className="pf-row-title whitespace-nowrap">{surfaceTotal(surface)}</span>
                  <button className="btn-text btn-sm text-red-700" onClick={() => setConfirmSubstrateDelete(surface.id)}>Delete substrate</button>
                </div>
              </div>
              </EstimatorGroup>
            </EstimatorEditSheet>
          );
        })}
      </div>
      <Modal isOpen={Boolean(confirmSubstrateDelete)} onClose={() => setConfirmSubstrateDelete('')} title="Delete substrate">
        <p className="pf-copy">Delete this substrate? If it is the last substrate, the empty room will also be removed.</p>
        <ModalFooter><button className="btn-secondary" onClick={() => setConfirmSubstrateDelete('')}>Cancel</button><button className="btn-text text-red-700" onClick={() => { setEditSurfaceId(''); removeSurface(room.id, confirmSubstrateDelete); setConfirmSubstrateDelete(''); }}>Delete substrate</button></ModalFooter>
      </Modal>
    </EstimatorRoomRow>
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
            {optional.map((item) => <div key={`${item.desc}-${item.productionRateId}`} className="flex justify-between gap-3 border-t py-2"><div className="min-w-0"><p className="pf-supporting">{item.desc}</p><p className="pf-meta break-words">{proposalDetail(item)}</p></div><span className="pf-value shrink-0">{formatMoney(num(item.rate))}</span></div>)}
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
    item.coatingLayers?.length ? item.coatingLayers.map((layer) => `${labelize(layer.phase)}: ${[layer.brand, layer.name].filter(Boolean).join(' ') || 'TBD'} (${layer.coats} coats${layer.quantity != null ? `, ${layer.quantity} ${item.dimensions?.unit || ''}` : ''})`).join('; ') : item.material?.name ? `Paint: ${[item.material.brand, item.material.name].filter(Boolean).join(' ')}` : 'Paint: TBD',
    [item.material?.colorName, item.material?.colorCode].filter(Boolean).join(' '),
    ...(item.scopeCommitments || []),
  ].filter(Boolean).join(' - ');
}
