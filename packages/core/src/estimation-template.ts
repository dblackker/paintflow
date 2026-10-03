export interface EstimationTemplateRate {
  id: string;
  category?: string | null;
  surfaceType?: string | null;
  description?: string | null;
  unit?: string | null;
  isActive?: boolean | null;
}

export function estimationSurfaceKind(rate?: Omit<EstimationTemplateRate, 'id'> | null): string {
  const text = [rate?.category, rate?.surfaceType, rate?.description].filter(Boolean).join(' ').toLowerCase().replace(/_/g, ' ');
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
  template: { productionRateId?: string | null; category?: string | null; label?: string | null; unit?: string | null },
  rates: T[], kind?: string,
): T | undefined {
  const unit = template.unit || estimationTemplateUnit(template.category || template.label || '');
  const active = rates.filter((rate) => rate.isActive !== false && (!unit || rate.unit === unit));
  if (template.productionRateId) return active.find((rate) => rate.id === template.productionRateId);
  const desired = estimationSurfaceKind({ category: template.category || template.label });
  if (desired === 'area') return undefined;
  const candidates = active.filter((rate) => estimationSurfaceKind(rate) === desired);
  candidates.sort((a, b) => {
    const exterior = (rate: T) => /exterior|external/.test([rate.category, rate.description].join(' ').toLowerCase());
    const preferred = (rate: T) => kind === 'exterior' ? exterior(rate) : !exterior(rate);
    return Number(preferred(b)) - Number(preferred(a)) || a.id.localeCompare(b.id);
  });
  return candidates[0];
}
