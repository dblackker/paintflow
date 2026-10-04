export type EstimatorTrimScope = 'none' | 'base' | 'base-casing' | 'base-crown-casing' | 'casing';
export type EstimatorMeasurementSource = 'measured' | 'derived' | 'starter_allowance' | 'override';
export type EstimatorGeometryKind = 'walls' | 'ceilings' | 'trim' | 'doors' | 'exterior_body' | 'soffit' | 'fascia' | 'corner_boards';

export interface EstimatorOpeningPolicy {
  id: string;
  deductOpenings: boolean;
  windowArea: number;
  doorArea: number;
  windowCasing: number;
  doorCasing: number;
}

// These are editable starter allowances, not a certified measurement standard.
export const ESTIMATOR_INTERIOR_OPENINGS: EstimatorOpeningPolicy = {
  id: 'interior-starter-v1', deductOpenings: true, windowArea: 15, doorArea: 21, windowCasing: 16, doorCasing: 14,
};
export const ESTIMATOR_EXTERIOR_OPENINGS: EstimatorOpeningPolicy = {
  id: 'exterior-starter-v1', deductOpenings: true, windowArea: 15, doorArea: 24, windowCasing: 16, doorCasing: 18,
};

export interface EstimatorRoomMetrics {
  length?: number;
  width?: number;
  perimeter?: number;
  height?: number;
  windows?: number;
  doors?: number;
  corners?: number;
  rooflineFactor?: number;
  soffitDepth?: number;
  trimScope?: EstimatorTrimScope;
  openingPolicy?: EstimatorOpeningPolicy;
}

export interface EstimatorDerivedMeasurement {
  quantity: number;
  unit: 'sqft' | 'linear_ft' | 'each';
  source: EstimatorMeasurementSource;
  policy: EstimatorOpeningPolicy;
  metrics: EstimatorRoomMetrics;
  gross: number;
  deduction: number;
  components: Record<string, number>;
  warnings: string[];
}

function dimension(value: number | undefined, field: string, fallback = 0) {
  const result = value ?? fallback;
  if (!Number.isFinite(result) || result < 0 || result > 1_000_000) throw new Error(`Enter a valid nonnegative ${field}.`);
  return result;
}

export function deriveEstimatorMeasurement(
  input: EstimatorRoomMetrics,
  kind: EstimatorGeometryKind,
  source: EstimatorMeasurementSource = 'derived',
): EstimatorDerivedMeasurement {
  const metrics = { ...input, openingPolicy: input.openingPolicy ? { ...input.openingPolicy } : undefined };
  const policy = { ...(metrics.openingPolicy ?? { ...ESTIMATOR_INTERIOR_OPENINGS, id: 'gross-no-deductions-v1', deductOpenings: false }) };
  const length = dimension(metrics.length, 'length');
  const width = dimension(metrics.width, 'width');
  const perimeter = dimension(metrics.perimeter, 'perimeter', 2 * (length + width));
  const height = dimension(metrics.height, 'height');
  const windows = dimension(metrics.windows, 'window count');
  const doors = dimension(metrics.doors, 'door count');
  const scope = metrics.trimScope ?? 'base';
  if (!['none', 'base', 'base-casing', 'base-crown-casing', 'casing'].includes(scope)) throw new Error('Select a valid trim scope.');
  for (const field of ['windowArea', 'doorArea', 'windowCasing', 'doorCasing'] as const) dimension(policy[field], field);
  const openings = policy.deductOpenings ? windows * policy.windowArea + doors * policy.doorArea : 0;
  const roofRun = perimeter * dimension(metrics.rooflineFactor, 'roofline factor', 1);
  let gross = 0;
  let deduction = 0;
  let unit: EstimatorDerivedMeasurement['unit'] = 'sqft';
  let components: Record<string, number> = {};
  if (kind === 'walls' || kind === 'exterior_body') { gross = perimeter * height; deduction = openings; }
  else if (kind === 'ceilings') gross = length * width;
  else if (kind === 'doors') { gross = doors; unit = 'each'; }
  else if (kind === 'soffit') gross = roofRun * dimension(metrics.soffitDepth, 'soffit depth');
  else if (kind === 'fascia') { gross = roofRun; unit = 'linear_ft'; }
  else if (kind === 'corner_boards') { gross = dimension(metrics.corners, 'corner count') * height; unit = 'linear_ft'; }
  else if (kind === 'trim') {
    const casing = scope === 'casing' || scope === 'base-casing' || scope === 'base-crown-casing';
    components = {
      base: scope === 'none' || scope === 'casing' ? 0 : perimeter,
      crown: scope === 'base-crown-casing' ? perimeter : 0,
      doorCasing: casing ? doors * policy.doorCasing : 0,
      windowCasing: casing ? windows * policy.windowCasing : 0,
    };
    gross = Object.values(components).reduce((sum, value) => sum + value, 0);
    unit = 'linear_ft';
  }
  const warnings = deduction > gross ? ['Opening deduction exceeds gross area; quantity is zero.'] : [];
  return { quantity: Math.max(0, gross - deduction), unit, source, policy, metrics, gross, deduction, components, warnings };
}

/** Geometry never overwrites an explicit quantity override implicitly. */
export function estimatorMeasurementPatch(measurement: EstimatorDerivedMeasurement, quantity: string, confirmed = false) {
  if (quantity !== '' && !confirmed) return null;
  return { width: '', height: '', quantity: String(measurement.quantity), measurement };
}

/** Finish and primer inheritance are independent of preparation severity. */
export function estimatorCoatingProducts(surface: { materialId?: string; primerMaterialId?: string; primerMode?: string }, defaults: { finish?: string; primer?: string }) {
  return {
    finish: surface.materialId || defaults.finish || '',
    primer: surface.primerMode && surface.primerMode !== 'none' ? surface.primerMaterialId || defaults.primer || '' : '',
  };
}
