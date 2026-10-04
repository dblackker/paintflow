import {
  EstimationInputError,
  type EstimationRateBasis,
  type EstimationProvenance,
  type EstimationAdjustment,
} from './estimation';
import type { ProductionPreviewItem, ProductionPreviewRequest } from './estimation-production';
import type {
  EstimatorDerivedMeasurement,
  EstimatorGeometryKind,
  EstimatorRoomMetrics,
} from './estimation-measurement';

export const ESTIMATION_TEMPLATE_ASSEMBLY_FORMAT = 'crewmodo-assembly-v2' as const;

export interface EstimationTemplateImportBasis {
  /** Crewmodo declarations, not an inferred vendor export format. */
  format?: string;
  rateBasis?: EstimationRateBasis;
  coverageBasis?: 'per_coat' | 'complete_system';
  source?: string;
  note?: string;
}

export interface EstimationTemplateSurface extends Partial<Omit<ProductionPreviewItem, 'unit'>> {
  unit?: 'sqft' | 'linear_ft' | 'each';
  category?: string;
  label?: string;
  customerVisible?: boolean;
  notes?: string;
  measurement?: EstimatorDerivedMeasurement;
  geometryKind?: EstimatorGeometryKind;
  rateBasis?: EstimationRateBasis;
  importBasis?: EstimationTemplateImportBasis;
  provenance?: EstimationProvenance;
}

export interface EstimationTemplateRoom {
  id?: string;
  name: string;
  roomType?: string;
  kind?: 'interior' | 'exterior' | 'custom';
  length?: string | number;
  width?: string | number;
  metrics?: EstimatorRoomMetrics;
  surfaces?: EstimationTemplateSurface[];
  items?: EstimationTemplateSurface[];
}

/** Scope defaults, not a signed budget or a frozen customer price. */
export interface EstimationTemplateAssembly {
  format: typeof ESTIMATION_TEMPLATE_ASSEMBLY_FORMAT;
  calculationVersion: 'repaint-v2';
  materialSellingPolicy?: ProductionPreviewRequest['materialSellingPolicy'];
  minimumPrice?: ProductionPreviewRequest['minimumPrice'];
  mobilizationHours?: ProductionPreviewRequest['mobilizationHours'];
  discount?: ProductionPreviewRequest['discount'];
  adjustments?: Array<EstimationAdjustment & { description?: string; category?: string }>;
}

export interface EstimationTemplateScope {
  rooms: EstimationTemplateRoom[];
  packages?: unknown[] | null;
}

export function estimationTemplateSurfaces(room: EstimationTemplateRoom) {
  if (
    room.surfaces?.length &&
    room.items?.length &&
    JSON.stringify(room.surfaces) !== JSON.stringify(room.items)
  ) {
    throw new EstimationInputError(
      'rooms',
      'This template contains different items and surfaces. Select one scope representation before applying it.',
    );
  }
  return room.surfaces?.length ? room.surfaces : (room.items ?? []);
}

export function estimationTemplateImportBasis(
  surface: Pick<EstimationTemplateSurface, 'rateBasis' | 'importBasis'>,
) {
  const imported = surface.importBasis;
  const knownCompleteSystem = imported?.format === 'crewmodo-complete-system-import-v1';
  if (knownCompleteSystem && !imported?.source?.trim()) {
    throw new EstimationInputError(
      'importBasis.source',
      'Identify the source of this complete-system import declaration.',
    );
  }
  const declared = surface.rateBasis ?? imported?.rateBasis;
  if (
    (surface.rateBasis && imported?.rateBasis && surface.rateBasis !== imported.rateBasis) ||
    (knownCompleteSystem &&
      ((declared && declared !== 'complete_system') ||
        (imported?.coverageBasis && imported.coverageBasis !== 'complete_system')))
  ) {
    throw new EstimationInputError(
      'importBasis',
      'The imported rate and coverage basis declarations conflict. Review the source assembly.',
    );
  }
  return {
    rateBasis: declared ?? (knownCompleteSystem ? ('complete_system' as const) : undefined),
    coverageBasis:
      imported?.coverageBasis ?? (knownCompleteSystem ? ('complete_system' as const) : undefined),
  };
}

export function readEstimationTemplateAssembly(
  template: EstimationTemplateScope,
): EstimationTemplateAssembly | null {
  if (template.packages != null && !Array.isArray(template.packages)) {
    throw new EstimationInputError(
      'packages',
      'This template has an unsupported package representation. Keep the original scope.',
    );
  }
  if (!template.packages?.length) return null;
  const value = template.packages[0] as Partial<EstimationTemplateAssembly> | null;
  if (
    template.packages.length !== 1 ||
    value?.format !== ESTIMATION_TEMPLATE_ASSEMBLY_FORMAT ||
    value.calculationVersion !== 'repaint-v2'
  ) {
    throw new EstimationInputError(
      'packages',
      'This template contains package pricing that cannot be converted safely. Keep the original estimate or review it in its source editor.',
    );
  }
  return value as EstimationTemplateAssembly;
}

export function estimationTemplateWarnings(template: EstimationTemplateScope): string[] {
  const warnings = new Set<string>();
  for (const room of template.rooms)
    for (const surface of room.surfaces?.length ? room.surfaces : (room.items ?? [])) {
      let basis: ReturnType<typeof estimationTemplateImportBasis>;
      try {
        basis = estimationTemplateImportBasis(surface);
      } catch (error) {
        warnings.add(error instanceof Error ? error.message : 'Review conflicting import basis.');
        continue;
      }
      if (!basis.rateBasis)
        warnings.add(
          'Legacy template rate basis is unspecified. Review the source rate; coefficients have not been reinterpreted.',
        );
      if (surface.importBasis && !basis.coverageBasis)
        warnings.add(
          'Imported material coverage basis is unspecified. Review whether coverage includes all coats.',
        );
      if (basis.coverageBasis === 'complete_system')
        warnings.add(
          'Imported complete-system coverage needs an explicit per-coat product conversion before pricing.',
        );
    }
  if (template.packages?.length)
    warnings.add(
      'Template scope and cost defaults are retained; new estimates use current tenant prices, not a signed historical budget.',
    );
  return [...warnings];
}

export function validateEstimationTemplateScope(template: EstimationTemplateScope) {
  const assembly = readEstimationTemplateAssembly(template);
  const ids = new Set<string>();
  for (const room of template.rooms)
    for (const surface of estimationTemplateSurfaces(room)) {
      const basis = estimationTemplateImportBasis(surface);
      if (
        !assembly &&
        (surface.operations ||
          surface.coatingLayers ||
          surface.sellingRate != null ||
          surface.burdenedRate != null ||
          (basis.rateBasis && basis.rateBasis !== 'legacy_per_coat'))
      ) {
        throw new EstimationInputError(
          'packages',
          'Native operations, coating layers and cost overrides require a crewmodo-assembly-v2 package. They cannot be priced as a legacy template.',
        );
      }
      if (assembly && (!surface.id || !surface.productionRateId || ids.has(surface.id))) {
        throw new EstimationInputError(
          'rooms',
          'Each native assembly substrate needs a unique identifier and an explicit production rate.',
        );
      }
      if (surface.id) ids.add(surface.id);
    }
  for (const adjustment of assembly?.adjustments ?? []) {
    if (ids.has(adjustment.id))
      throw new EstimationInputError(
        'adjustments',
        'Assembly scope and adjustments need unique identifiers.',
      );
    ids.add(adjustment.id);
  }
  return assembly;
}

/** No flattening of operations, products, scope policies or direct-cost budgets. */
export function assertEstimationTemplateCompatible(
  template: EstimationTemplateScope,
  target: 'production' | 'quick',
) {
  const assembly = validateEstimationTemplateScope(template);
  if (target === 'quick' && (template.rooms.length || template.packages?.length)) {
    throw new EstimationInputError(
      'template',
      "Quick estimates cannot preserve this assembly's operations, coating layers and cost budgets. Open it in the production estimator.",
    );
  }
  for (const room of template.rooms)
    for (const surface of estimationTemplateSurfaces(room)) {
      const basis = estimationTemplateImportBasis(surface);
      if (basis.coverageBasis === 'complete_system') {
        throw new EstimationInputError(
          'importBasis.coverageBasis',
          'Complete-system material coverage cannot be applied as per-coat coverage. Review and explicitly convert the source product before using this template.',
        );
      }
    }
  return { assembly, warnings: estimationTemplateWarnings(template) };
}

/** Resolve only catalog identity/basis; never turn imported coefficients into rates. */
export function estimationTemplateProductionRequest<T extends EstimationTemplateRate>(
  template: EstimationTemplateScope,
  rates: T[],
): ProductionPreviewRequest {
  const { assembly } = assertEstimationTemplateCompatible(template, 'production');
  return {
    calculationVersion: assembly?.calculationVersion ?? 'repaint-v1',
    ...(assembly
      ? {
          materialSellingPolicy: assembly.materialSellingPolicy,
          minimumPrice: assembly.minimumPrice,
          mobilizationHours: assembly.mobilizationHours,
          discount: assembly.discount,
          adjustments: assembly.adjustments,
        }
      : {}),
    items: template.rooms.flatMap((room, roomIndex) =>
      estimationTemplateSurfaces(room).map((surface, index) => {
        const rate = resolveEstimationTemplateRate(surface, rates, room.kind);
        if (!rate)
          throw new EstimationInputError(
            'productionRateId',
            `Select a matching active catalog rate for ${surface.label || surface.category || 'this substrate'}; unit and declared basis must match.`,
          );
        return { ...surface, id: surface.id ?? `template-${roomIndex}-${index}`, productionRateId: rate.id };
      }),
    ),
  };
}

export interface EstimationTemplateRate {
  id: string;
  category?: string | null;
  surfaceType?: string | null;
  description?: string | null;
  unit?: string | null;
  isActive?: boolean | null;
  rateBasis?: EstimationRateBasis | null;
}

export function estimationSurfaceKind(rate?: Omit<EstimationTemplateRate, 'id'> | null): string {
  const text = [rate?.category, rate?.surfaceType, rate?.description]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/_/g, ' ');
  if (/soffit|eave/.test(text)) return 'soffit';
  if (/fascia/.test(text)) return 'fascia';
  if (/corner board|cornerboard|corner/.test(text)) return 'corner_boards';
  if (/cabinet/.test(text)) return 'cabinets';
  if (/trim|baseboard|casing|crown/.test(text)) return 'trim';
  if (/door/.test(text)) return 'doors';
  if (/ceiling/.test(text)) return 'ceilings';
  if (/siding|exterior.*body|exterior body/.test(text)) return 'exterior_body';
  if (/wall/.test(text)) return 'walls';
  if (rate?.unit === 'linear_ft') return 'linear';
  return 'area';
}

export function estimationTemplateUnit(category: string): 'sqft' | 'linear_ft' | 'each' | undefined {
  const kind = estimationSurfaceKind({ category });
  if (['trim', 'fascia', 'corner_boards'].includes(kind)) return 'linear_ft';
  if (['doors', 'cabinets'].includes(kind)) return 'each';
  if (['walls', 'ceilings', 'exterior_body', 'soffit'].includes(kind)) return 'sqft';
  return undefined;
}

/** Templates must never silently substitute an unrelated substrate or measurement unit. */
export function resolveEstimationTemplateRate<T extends EstimationTemplateRate>(
  template: {
    productionRateId?: string | null;
    category?: string | null;
    label?: string | null;
    unit?: string | null;
    rateBasis?: EstimationRateBasis;
    importBasis?: EstimationTemplateImportBasis;
  },
  rates: T[],
  kind?: string,
): T | undefined {
  const unit = template.unit || estimationTemplateUnit(template.category || template.label || '');
  const { rateBasis } = estimationTemplateImportBasis(template);
  const active = rates.filter(
    (rate) =>
      rate.isActive !== false &&
      (!unit || rate.unit === unit) &&
      (!rateBasis || (rate.rateBasis ?? 'legacy_per_coat') === rateBasis),
  );
  if (template.productionRateId) return active.find((rate) => rate.id === template.productionRateId);
  const desired = estimationSurfaceKind({ category: template.category || template.label });
  if (desired === 'area') return undefined;
  const candidates = active.filter((rate) => estimationSurfaceKind(rate) === desired);
  candidates.sort((a, b) => {
    const exterior = (rate: T) =>
      /exterior|external/.test([rate.category, rate.description].join(' ').toLowerCase());
    const preferred = (rate: T) => (kind === 'exterior' ? exterior(rate) : !exterior(rate));
    return Number(preferred(b)) - Number(preferred(a)) || a.id.localeCompare(b.id);
  });
  return candidates[0];
}
