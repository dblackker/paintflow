import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertEstimationTemplateCompatible,
  estimationTemplateImportBasis,
  estimationTemplateProductionRequest,
  estimationTemplateSurfaces,
  estimationTemplateWarnings,
  readEstimationTemplateAssembly,
  resolveEstimationTemplateRate,
  type EstimationTemplateScope,
} from '../../packages/core/src/estimation-template';
import { templateSchema, templateInterchange } from '../../apps/api/src/routes/estimate-templates';
import { calculateProductionPreview } from '../../packages/core/src/estimation-production';
import { deriveEstimatorMeasurement } from '../../packages/core/src/estimation-measurement';

const rateId = '33333333-3333-4333-8333-333333333333';
const finishId = '44444444-4444-4444-8444-444444444444';
const primerId = '55555555-5555-4555-8555-555555555555';
const measurement = deriveEstimatorMeasurement(
  { length: 24, width: 24, height: 8, doors: 1 },
  'walls',
  'measured',
);
function nativeTemplate() {
  return {
    name: 'Native repaint',
    category: 'full_estimate',
    isShared: false,
    isSmart: true,
    rooms: [
      {
        id: 'room-1',
        name: 'Living room',
        kind: 'interior',
        metrics: measurement.metrics,
        surfaces: [
          {
            id: 'walls-1',
            category: 'walls',
            label: 'Walls',
            productionRateId: rateId,
            unit: 'sqft',
            quantity: '768',
            coats: 2,
            prepLevel: 'none',
            applicationMethod: 'brush_roll',
            rateBasis: 'complete_system',
            sellingRate: '71.25',
            burdenedRate: '38.50',
            optional: false,
            selected: true,
            customerVisible: true,
            measurement,
            geometryKind: 'walls',
            notes: 'Retain crew scope',
            colorName: 'Reviewed white',
            colorCode: 'WHITE',
            colorRelationship: 'different',
            importBasis: {
              rateBasis: 'complete_system',
              coverageBasis: 'per_coat',
              source: 'Contractor reviewed assembly',
            },
            provenance: { source: 'contractor', version: '2', note: 'Reviewed scope, not a signed price' },
            operations: [
              {
                id: 'application',
                kind: 'application',
                description: 'Finish walls',
                coats: 2,
                sellingRate: '71.25',
                burdenedRate: '38.50',
              },
              {
                id: 'setup',
                kind: 'setup',
                description: 'One-time masking',
                hours: '2.25',
                sellingRate: '65',
                burdenedRate: '35',
              },
              {
                id: 'primer',
                kind: 'primer',
                hours: '1.5',
                sellingRate: '65',
                burdenedRate: '35',
                provenance: { source: 'Reviewed spot-prime takeoff' },
              },
            ],
            coatingLayers: [
              {
                id: 'finish',
                phase: 'finish',
                materialId: finishId,
                coats: 2,
                coveragePerGallon: '350',
                lossAllowancePercent: '7.5',
                colorName: 'Reviewed white',
                colorCode: 'WHITE',
                colorSupplier: 'Contractor',
                substrateRestriction: 'Drywall',
                provenance: { coverageSource: 'Product sheet' },
              },
              {
                id: 'primer',
                phase: 'primer',
                materialId: primerId,
                coats: 1,
                quantity: '96',
                coveragePerPack: '100',
                coverageUnit: 'sqft',
                lossAllowancePercent: '5',
                colorName: 'Primer white',
              },
            ],
          },
        ],
      },
    ],
    packages: [
      {
        format: 'crewmodo-assembly-v2',
        calculationVersion: 'repaint-v2',
        materialSellingPolicy: 'consumption',
        minimumPrice: '1200.00',
        mobilizationHours: '1.75',
        discount: '12.50',
        adjustments: [
          {
            id: 'access',
            description: 'Access equipment',
            category: 'equipment',
            quantity: '2',
            unitPrice: '125.25',
            costPerUnit: '40.00',
            hoursPerUnit: '1.5',
            burdenedRate: '38.50',
            costUnknown: false,
            optional: true,
            selected: true,
            provenance: { source: 'Reviewed rental quote' },
          },
        ],
      },
    ],
  };
}
const scope = (value: unknown) => value as EstimationTemplateScope;
const catalog = {
  rates: [
    {
      id: rateId,
      category: 'walls',
      unit: 'sqft',
      ratePerHour: '80',
      coats: 2,
      rateBasis: 'complete_system' as const,
      coatRates: { '1': '120', '2': '80', '3': '60' },
      hourlyRate: '65',
      burdenedRate: '35',
      sellingRateSource: 'override' as const,
    },
  ],
  materials: [
    {
      id: finishId,
      unit: 'gallon',
      costPerUnit: '35.00',
      coverageSqFt: '350',
      coverageBasis: 'per_gallon' as const,
      markupPercent: '20',
    },
    {
      id: primerId,
      unit: 'quart',
      costPerUnit: '12.00',
      coverageSqFt: '100',
      coverageBasis: 'per_pack' as const,
      markupPercent: '15',
    },
  ],
  settings: { defaultLaborRate: '65', defaultBurdenedRate: '35', salesTaxRate: '0.0725' },
};

test('native template JSON/schema round trip retains operations, descriptions, layers, measurement, basis and private budgets', () => {
  const original = JSON.parse(JSON.stringify(nativeTemplate()));
  const parsed = templateSchema.parse(JSON.parse(JSON.stringify(original)));
  assert.deepEqual(parsed, original);
  const before = estimationTemplateProductionRequest(scope(original), catalog.rates);
  const after = estimationTemplateProductionRequest(scope(parsed), catalog.rates);
  assert.deepEqual(after, before);
  const calculation = calculateProductionPreview(after, catalog);
  assert.deepEqual(calculation, calculateProductionPreview(before, catalog));
  assert.equal(calculation.calculation.calculationVersion, 'repaint-v2');
  assert.equal(calculation.calculation.totals.costComplete, true);
  assert.ok(calculation.calculation.totals.laborBudgetMinor! > 0);
  assert.equal(calculation.resolvedInput.surfaces[0].operations?.[0].sellingRate, '71.25');
  assert.equal(calculation.resolvedInput.surfaces[0].operations?.[0].burdenedRate, '38.50');
  assert.equal(after.adjustments?.[0].costPerUnit, '40.00');
  assert.deepEqual(parsed.rooms[0].surfaces?.[0].measurement, JSON.parse(JSON.stringify(measurement)));
  assert.equal(templateInterchange(scope(parsed)).productionCompatible, true);
});

test('native and package pricing cannot be flattened into quick items or silently interpreted as legacy', () => {
  const native = nativeTemplate();
  assert.throws(() => assertEstimationTemplateCompatible(scope(native), 'quick'), /cannot preserve/);
  const untagged = { ...native, packages: undefined };
  assert.equal(templateSchema.safeParse(untagged).success, false);
  assert.throws(
    () => assertEstimationTemplateCompatible(scope(untagged), 'production'),
    /require a crewmodo-assembly-v2/,
  );
  for (const packages of [
    [{ subtotal: 900, total: 950, productionInput: {} }],
    [native.packages[0], native.packages[0]],
  ]) {
    assert.throws(
      () => readEstimationTemplateAssembly({ rooms: [], packages }),
      /cannot be converted safely/,
    );
    assert.equal(templateSchema.safeParse({ ...native, packages }).success, false);
  }
});

test('legacy templates keep v1 and warn about ambiguous basis without inferring from quantities, rates or labels', () => {
  const legacy = {
    rooms: [
      {
        name: 'Legacy',
        surfaces: [{ category: 'walls', label: 'Two coat complete system', quantity: 768, coats: 2 }],
      },
    ],
  };
  const request = estimationTemplateProductionRequest(scope(legacy), catalog.rates);
  assert.equal(request.calculationVersion, 'repaint-v1');
  assert.equal(request.items[0].quantity, 768);
  assert.deepEqual(estimationTemplateImportBasis({}), { rateBasis: undefined, coverageBasis: undefined });
  assert.match(estimationTemplateWarnings(scope(legacy)).join(' '), /unspecified/);
  assert.equal(templateInterchange(scope(legacy)).calculationVersion, 'repaint-v1');
});

test('complete-system import declaration requires source, detects conflicts and rejects unsupported complete-system material coverage', () => {
  const declaration = { format: 'crewmodo-complete-system-import-v1', source: 'Reviewed contractor import' };
  assert.deepEqual(estimationTemplateImportBasis({ importBasis: declaration }), {
    rateBasis: 'complete_system',
    coverageBasis: 'complete_system',
  });
  assert.throws(
    () => estimationTemplateImportBasis({ importBasis: { format: declaration.format } }),
    /Identify the source/,
  );
  const native = nativeTemplate();
  const surface = native.rooms[0].surfaces[0];
  const imported = {
    ...native,
    rooms: [{ ...native.rooms[0], surfaces: [{ ...surface, importBasis: declaration }] }],
  };
  assert.equal(templateSchema.safeParse(imported).success, true);
  assert.throws(
    () => assertEstimationTemplateCompatible(scope(imported), 'production'),
    /cannot be applied as per-coat/,
  );
  assert.equal(templateInterchange(scope(imported)).productionCompatible, false);
  assert.deepEqual(
    estimationTemplateImportBasis({
      importBasis: { format: 'Estimate Rocket export', source: 'Unverified file' },
    }),
    { rateBasis: undefined, coverageBasis: undefined },
  );
});

test('conflicting import metadata is a gracefully unsafe catalog row and does not break healthy rows', () => {
  const bad = nativeTemplate();
  bad.rooms[0].surfaces[0].importBasis.rateBasis = 'legacy_per_coat';
  assert.equal(templateSchema.safeParse(bad).success, false);
  const rows = [bad, nativeTemplate()].map((value) => templateInterchange(scope(value)));
  assert.equal(rows[0].productionCompatible, false);
  assert.match(rows[0].warnings.join(' '), /conflict/);
  assert.equal(rows[1].productionCompatible, true);
  assert.equal(templateInterchange(scope({ rooms: [null] })).productionCompatible, false);
  assert.equal(
    templateInterchange(scope({ rooms: [], packages: { total: 950 } })).productionCompatible,
    false,
  );
});

test('catalog identity, unit and basis remain authoritative; imported metadata never supplies coefficients', () => {
  const native = nativeTemplate();
  const templateSurface = scope(native).rooms[0].surfaces![0];
  assert.equal(
    resolveEstimationTemplateRate(templateSurface, [{ ...catalog.rates[0], rateBasis: 'legacy_per_coat' }]),
    undefined,
  );
  assert.throws(
    () =>
      estimationTemplateProductionRequest(scope(native), [
        { ...catalog.rates[0], rateBasis: 'legacy_per_coat' },
      ]),
    /basis must match/,
  );
  assert.equal(resolveEstimationTemplateRate({ ...templateSurface, unit: 'each' }, catalog.rates), undefined);
  assert.equal(
    resolveEstimationTemplateRate({ ...templateSurface, productionRateId: 'missing' }, catalog.rates),
    undefined,
  );
  assert.equal(
    resolveEstimationTemplateRate(templateSurface, [{ ...catalog.rates[0], isActive: false }]),
    undefined,
  );
  const request = estimationTemplateProductionRequest(scope(native), catalog.rates);
  assert.equal(
    calculateProductionPreview(request, catalog).resolvedInput.surfaces[0].labor.productionRatePerHour,
    '80',
  );
});

test('strict schemas reject unrepresentable native fields instead of discarding them', () => {
  const native = nativeTemplate();
  const room = native.rooms[0],
    surface = room.surfaces[0];
  for (const patch of [
    { unknownBudget: 123 },
    { layers: surface.coatingLayers },
    { measurement: { source: 'measured', rawNotes: 'Retained' }, importedHourlyRate: 50 },
  ]) {
    assert.equal(
      templateSchema.safeParse({ ...native, rooms: [{ ...room, surfaces: [{ ...surface, ...patch }] }] })
        .success,
      false,
    );
  }
  assert.equal(
    templateSchema.safeParse({
      ...native,
      rooms: [
        {
          ...room,
          surfaces: [{ ...surface, operations: [{ ...surface.operations[0], unknownBudget: 55 }] }],
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    templateSchema.safeParse({
      ...native,
      rooms: [
        {
          ...room,
          surfaces: [{ ...surface, coatingLayers: [{ ...surface.coatingLayers[0], totalGallons: 55 }] }],
        },
      ],
    }).success,
    false,
  );
});

test('native empty layers, independent primer labor and excluded options remain explicit', () => {
  const original = nativeTemplate();
  const room = original.rooms[0],
    substrate = room.surfaces[0];
  const data = {
    ...original,
    rooms: [{ ...room, surfaces: [{ ...substrate, optional: true, selected: false, coatingLayers: [] }] }],
    packages: [
      {
        ...original.packages[0],
        adjustments: original.packages[0].adjustments.map((row) => ({
          ...row,
          optional: true,
          selected: false,
        })),
      },
    ],
  };
  const parsed = templateSchema.parse(JSON.parse(JSON.stringify(data)));
  const request = estimationTemplateProductionRequest(scope(parsed), catalog.rates);
  assert.deepEqual(request.items[0].coatingLayers, []);
  assert.equal(request.items[0].operations?.find((operation) => operation.kind === 'primer')?.hours, '1.5');
  assert.equal(request.items[0].selected, false);
  assert.equal(request.adjustments?.[0].selected, false);
  const result = calculateProductionPreview(request, catalog).calculation;
  assert.equal(result.items.find((row) => row.id === substrate.id)?.included, false);
  assert.equal(result.items.find((row) => row.id === 'access')?.included, false);
});

test('divergent item/surface scopes and duplicate native identities fail closed; empty surfaces retain legacy items', () => {
  const native = nativeTemplate(),
    room = native.rooms[0];
  assert.equal(
    templateSchema.safeParse({
      ...native,
      rooms: [{ ...room, items: [{ ...room.surfaces[0], quantity: '999' }] }],
    }).success,
    false,
  );
  assert.equal(templateSchema.safeParse({ ...native, rooms: [room, room] }).success, false);
  assert.equal(
    templateSchema.safeParse({
      ...native,
      packages: [
        {
          ...native.packages[0],
          adjustments: [{ ...native.packages[0].adjustments[0], id: room.surfaces[0].id }],
        },
      ],
    }).success,
    false,
  );
  const legacy = { name: 'Legacy', surfaces: [], items: [{ category: 'walls', quantity: '100' }] };
  assert.deepEqual(estimationTemplateSurfaces(legacy), legacy.items);
});

test('navigation carries full template package metadata and quick switching explicitly blocks budget loss', () => {
  const page = readFileSync(new URL('../../apps/web/src/pages/Templates.tsx', import.meta.url), 'utf8');
  const quick = readFileSync(
    new URL('../../apps/web/src/pages/estimates/EstimateNew.tsx', import.meta.url),
    'utf8',
  );
  assert.match(page, /estimateTemplate: scope/);
  assert.match(page, /packages: payload\.data\.packages/);
  assert.match(page, /assertEstimationTemplateCompatible\(scope, 'production'\)/);
  assert.match(quick, /assertEstimationTemplateCompatible\(state\.estimateTemplate, 'quick'\)/);
  assert.match(quick, /event\.preventDefault\(\)/);
  assert.match(quick, /without losing its entered hours, material allowances and prices/);
});
