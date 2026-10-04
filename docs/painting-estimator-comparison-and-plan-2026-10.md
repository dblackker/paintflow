# Painting Estimation: Competitor Analysis And Improvement Plan

Prepared October 4, 2026. Crewmodo was previously named PaintFlow; both names refer to this product.

## 1. Decision Summary

Keep the shared calculation engine. Improve the painting model and the field workflow around it, rather than rewriting estimation or copying a competitor's screens.

The three benchmarks are **PaintScout, DripJobs, and Estimate Rocket**. They are relevant painter-focused estimating products with publicly documented production calculations. There is no reliable public market-share ranking establishing these as the three most-used products. This is a selection of three strong direct benchmarks, not a claimed market-share leaderboard. Broad contractor CRMs and commercial plan-takeoff systems solve somewhat different problems.

Recommended sequence:

1. Correct scope-generation and coating-selection defects; protect existing work from destructive starter regeneration.
2. Make rate semantics explicit, then support complete-coat production rates, independent prep, and operation-specific methods.
3. Connect estimated hours to burdened labor cost and clarify materials, markup, overhead, and margin.
4. Make a room/elevation the fast mobile input unit, with inherited specifications and progressive disclosure.
5. Deliver a dependable signed-scope-to-crew-budget handoff and use qualified actual costs to improve future bids.

The strongest differentiator is not another proposal theme. It is **fast repaint capture with an explainable estimate, a usable crew budget, and a trustworthy comparison to actual labor and supplier purchases**.

## 2. Evidence And Boundaries

### Baseline

- Reviewed implementation commit: `9478783`, the feature content subsequently squash-merged into GitHub `main` as `909e8e97e9a03fd0be4609bb979e5af37919afa5`.
- Inspected the React production estimator, shared production/quick/template adapters, authoritative API pricing, schema, signature handoff, financial-position helper, and existing implementation documents.
- Ran `node --import tsx --test tests/unit/estimation*.test.ts`: **27 passed, zero failed or skipped**.
- Ran additional read-only synthetic probes against the real production adapter. Results appear below.
- No production database, pricebook, signed document, external account, or application code was changed for this analysis.

Competitor evidence comes from official documentation accessed October 4, 2026. Published descriptions establish documented behavior, not implementation quality, exact proprietary formulas, or how every paid configuration behaves. No authenticated competitor project or exported quote was available for a side-by-side product test.

Labels used here:

- **Documented:** described in an official competitor source.
- **Verified:** inspected in Crewmodo source or reproduced with its pure calculation adapter.
- **Inference:** an interpretation or likely consequence, not a measured customer outcome.
- **Proposed:** a future change, not already implemented.
- **Unknown:** insufficient evidence; do not turn this into an unsupported competitor weakness.

The earlier [product strategy assessment](product-strategy-assessment-2026-10.md) predates the merged calculation foundation. Its per-substrate rounding and multiple-engine findings are not descriptions of the current shared engine. Follow the current [implemented contracts](implementation/repaint-margin-control/CONTRACTS.md) and [evidence](implementation/repaint-margin-control/EVIDENCE.md) when identifying completed work.

### Code Evidence Map

| Source | What was inspected |
| --- | --- |
| [Shared engine](../packages/core/src/estimation.ts), lines 199-341 | Labor, coverage conversion, compatible purchase groups, allocation, options, discounts, tax. |
| [Production adapter](../packages/core/src/estimation-production.ts), lines 7-8 and 83-142 | Prep/method constants, tenant pricebook inputs, default labor rate, material fallback, adapter capabilities. |
| [API resolver](../apps/api/src/lib/production-estimation.ts), lines 10-39 and 68-78 | Accepted production inputs and organization-scoped rate/material lookups. |
| [Estimate save pricing](../apps/api/src/routes/estimates.ts), lines 127-178 | Server calculation and historical calculation snapshots. |
| [Production UI](../apps/web/src/pages/estimates/EstimateProduction.tsx), lines 287-321, 739-867, 1240-1341, 1585-1717 | Room assumptions, measurements, products, scope generation, paint schedule, repeated controls. |
| [Rate schema](../packages/db/src/schema.ts), lines 447-460 | One rate-per-hour, one selling rate, prep multiplier, default coat count. |
| [Rate initialization](../apps/api/src/routes/production-rates.ts), lines 26-90 | Generic seeded rates and automatic insertion during GET. |
| [Quick adapter](../packages/core/src/estimation-quick.ts), lines 19-70 | Rounded selling unit prices and separate quick-summary hours/materials. |
| [Template resolver](../packages/core/src/estimation-template.ts), lines 10-49 | Explicit identity/unit resolution, with textual classification for legacy categories. |
| [Job financial position](../packages/core/src/job-financial-position.ts), lines 25-107 | Recorded costs, missing-cost warnings, no final-margin fabrication. |
| [Signature handoff](../apps/api/src/routes/estimates.ts), lines 505-545; [job creation](../apps/api/src/lib/estimate-handoff.ts) | Accepted scope, job, deposit invoice, and portal handoff. |

Line numbers identify this snapshot; they will change as implementation proceeds.

## 3. The Three Competitor Models

### 3.1 PaintScout: Production Rates And Room-First Estimating

**Documented calculation model.** A rate can express output per labor-hour, hours per item, or selling dollars per measured unit. Its coat-specific entry represents the **entire selected coating count**, not an additional coat. Consequently, `hours = quantity / selectedCompleteCoatRate` or `quantity * selectedHoursPerItem`; a two-coat rate must not be multiplied by two again. [Rate calculations](https://help.paintscout.com/support/customization/pricing-and-rates/how-production-rates-are-calculated).

**Documented configuration.** Categories organize substrates; rate defaults can include products, coverage, descriptions, customer visibility, and an hourly-rate override. Coat-independent tasks can disable coat-based calculation. Separate application-method rates can carry different material coverage. [Production rate configuration](https://help.paintscout.com/support/customization/pricing-and-rates/production-rates-section-overview).

**Documented process.** Add a room or single surface, enter length/width/height or direct measurement, and choose substrates. Painting time follows the selected rate; separately entered prep hours add labor. [Areas](https://help.paintscout.com/support/estimating/areas-and-rates/adding-areas-to-an-estimate), [prep hours](https://help.paintscout.com/support/estimating/areas-and-rates/prep-hours).

**Documented materials.** Coverage can use square feet per gallon, linear feet per gallon, or gallons per item; product coverage represents one coat. Material pricing uses exact calculated consumption. Work-order quantities can aggregate and display exact, nearest-unit, or upward-rounded amounts without changing that pricing basis. [Coverage](https://help.paintscout.com/support/customization/pricing-and-rates/coverage-rates), [rounding policy](https://help.paintscout.com/support/customization/products/product-rounding).

**Documented pricing guidance.** The hourly sell rate can include burdened labor, overhead, and optionally paint/sundries, divided by `1 - desired margin`. Materials must not be included in that hourly rate and charged separately again. [Hourly-rate guidance](https://help.paintscout.com/support/customization/pricing-and-rates/how-to-calculate-your-hourly-rate).

**Documented continuity.** Smart templates resolve current settings for new estimates. Work orders expose room/substrate hours, products, and private crew notes. Offline building saves locally and syncs later, but offline sending/search/downloading are excluded. [Smart templates](https://help.paintscout.com/support/customization/templates-and-presets/smart-templates), [work orders](https://help.paintscout.com/support/estimating/managing-estimates-and-work-orders/work-orders/working-with-work-orders), [offline scope](https://help.paintscout.com/support/getting-started/how-do-i-use-paintscout-offline).

**Lesson for Crewmodo, an inference:** adopt explicit complete-coat semantics, fast room geometry, and crew-facing outputs. Do not copy exact-consumption pricing unquestioningly: contractors may reasonably choose to recover the cost of whole cans purchased for a job.

### 3.2 DripJobs: Production Estimation Connected To Sales And Profit Review

**Documented calculation model.** Substrates have one-, two-, and three-coat rate entries. Time-based entries increase price as hours increase; output-per-hour entries decrease price as speed increases. Prep work is treated separately from repeated paint coats. The documentation gives nonlinear multi-coat examples, reinforcing that coat count need not imply identical passes. Some explanatory passages about later-coat speed are ambiguous; verify the actual selected-column behavior before building an import adapter. [Substrate configuration](https://intercom.help/dripjobs/en/articles/14326998-production-rates-understanding-substrate-rate-configuration-multi-coat-pricing).

**Documented cost model.** Company settings distinguish burdened hourly cost from hourly sell rate and product markup. Project reports distinguish estimated product acquisition cost, material selling price, paint/prep hours, internal labor cost, and labor selling price. [Settings](https://intercom.help/dripjobs/en/articles/9627944-production-rates-settings), [project reports](https://intercom.help/dripjobs/en/articles/13163824-production-rates-reports).

**Documented process.** Select an interior/exterior area, adjust dimensions, choose categories and substrates, review specifications, and add crew/client notes. Reusable proposal templates can include optional areas and a deposit. [Template workflow](https://intercom.help/dripjobs/en/articles/8448546-dripjobs-production-rates-how-to-create-a-proposal-template).

**Documented controls.** A proposal can override labor selling rate/material markup; global changes do not automatically update existing proposals. Substrate-level gallon rounding shows added volume and its price impact. [Proposal overrides](https://intercom.help/dripjobs/en/articles/14714356-production-rates-how-to-update-labor-rate-and-material-markup-for-an-individual-proposal), [gallon rounding](https://intercom.help/dripjobs/en/articles/15084924-how-to-round-up-gallons-on-your-proposal-areas).

**Source caution.** The public interactive demo's example `462 / 100 * 80 = 462` is arithmetically inconsistent; the expression equals `$369.60` before other charges. It is not a reliable calculation oracle. Grouping across unknown colors, precise cents policy, and current purchase-to-actual inventory semantics are not established by these public pages. [Production-rate overview/demo](https://dripjobs.com/production-rates).

**Lesson for Crewmodo, an inference:** show cost and sell price separately before sending; make formula provenance and added allowances understandable. Do not reproduce a lengthy multi-step wizard for every ordinary room.

### 3.3 Estimate Rocket: Reusable Labor/Material Assemblies

**Documented calculation model.** Assemblies combine labor production with material coverage. A wall assembly already labeled two coats can use an effective complete-system coverage, such as `350 / 2 = 175 sqft/gallon`. Its selected assembly's labor rate also describes that task. Applying another coat multiplier to these complete-system coefficients would count coats twice. [Assembly configuration](https://support.estimaterocket.com/item-templates/edit-assembly).

**Documented interior example.** A 768-square-foot two-coat wall assembly at 80 square feet/hour produces 9.60 labor-hours; coverage of 175 square feet/gallon produces approximately 4.39 gallons. Items can also use linear feet, counts, direct hours, or dollars. [Interior workflow](https://support.estimaterocket.com/item-templates/using-the-interior-painting-item-template).

**Documented exterior example.** A 3,000-square-foot siding assembly at 42 square feet/hour produces 71.43 hours; effective coverage of 162.5 square feet/gallon produces 18.46 gallons. Doors/windows can be counts and soffit/fascia linear measures; constituent quantities total into production information. [Exterior workflow](https://support.estimaterocket.com/item-templates/using-the-exterior-painting-item-template).

**Documented setup.** Generic template labor/material prices should be replaced with the contractor's own values. Different labor resources can represent prep versus painting skill levels. Smart line items connect customer descriptions to labor, materials, and estimated profit. [Template setup](https://support.estimaterocket.com/item-templates/what-to-do-with-your-new-estimate-rocket-templates), [smart line-item examples](https://support.estimaterocket.com/item-templates/example-item-template).

**Lesson for Crewmodo, an inference:** a reusable assembly is more useful than a list of unrelated default fields. A room/substrate preset should specify the operations, coating system, labor assumptions, and material demand that make up its price. The actual quantity still belongs to the job.

### 3.4 Cross-Product Comparison

This table summarizes the sources above; a blank/unknown is not evidence of absence.

| Dimension | PaintScout | DripJobs | Estimate Rocket | Current Crewmodo |
| --- | --- | --- | --- | --- |
| Primary organizing unit | Room/area and substrates | Area, categories, substrates | Project with estimating assemblies | Room/space and substrates |
| Labor rate interpretation | Multiple variable types; complete selected coat count | Time/output rate types; coat tables | Task/assembly production or direct hours | Output/hour only; linear coat multiplier |
| Prep | Independent entered hours or coat-independent rate | Separate prep tasks/hours | Labor-only tasks/assemblies | Rate prep multiplier, prep-level multiplier, plus adjustment hours |
| Burdened labor versus selling rate | Hourly-rate composition guidance | Explicit separate company cost/sell settings | Labor resources and estimated costs | Core supports burden; production adapter does not supply it |
| Material coverage | Area, linear, count | Configurable products and formula view | Assembly-specific effective coverage | Per-pack square-foot coverage; explicit linear/count area conversions |
| Buying/price rounding | Exact-use pricing; configurable work-order rounding | Optional substrate gallon round-up | Quantity calculation documented; pack grouping unknown | Compatible-group whole-pack acquisition pricing |
| Template behavior | Static and smart variants documented | Proposal templates and per-proposal overrides | Reusable assemblies and material/labor resources | Rate/product identity preserved; saves resolve current tenant catalog |
| Crew output | Automatic work-order view | Crew/client notes and project reports | Assembly labor/material totals for work order | Paint schedule and linked jobs; complete operating-budget handoff still partial |
| Field interruptions | Offline estimate building documented | Exact offline behavior not verified | Exact offline behavior not verified | Saved drafts exist; durable local recovery is unfinished |

**No universal industry formula exists.** Coat-rate interpretation, opening treatment, material pricing basis, and overhead recovery must be explicit contractor policies. The software should be consistent and explainable, not claim every painter should use the same rate.

## 4. Crewmodo's Current Mathematics

### 4.1 Production Labor

Verified formula in the current production path:

```text
hours = quantity / (ratePerHour * methodProductivity)
        * coats * ratePrepMultiplier * selectedPrepMultiplier
        + prepAdjustmentHours + paintAdjustmentHours

laborSellingPrice = hours * rateHourlySellingPrice
```

Current prep factors: none `0.8`, light `1.0`, standard `1.2`, heavy `1.5`.
Current method factors: brush/roll `1.0`, spray/back-roll `1.35`, spray-only `1.6`.

These are hard-coded application policies, not published industry standards. The rate-level prep factor can multiply the selected prep factor as well. Positive quantity with negative adjusted hours is clamped to zero; zero measured quantity contributes zero even if adjustment hours are entered.

This model can represent a well-calibrated **per-coat baseline rate**. It cannot safely accept a competitor's **complete two-coat rate** without conversion, and it cannot represent faster subsequent coats without manual corrections. It also conflates preparation effort with application speed. Prep adjustments are additive and can represent one-time labor, but the separate operation is not retained in the calculated result.

### 4.2 Materials And Pricing

```text
coatingArea = measured area
           or linearFeet * paintedWidthInches / 12
           or itemCount * paintedSqFtPerItem

theoreticalPacks = coatingArea * coats * (1 + allowance) / coveragePerPack
purchasedPacks   = ceil(sum(theoreticalPacks in a compatible group))
materialCost    = purchasedPacks * contractorCostPerPack
materialPrice   = materialCost * (1 + markup)
```

The engine has explicit phase, allowance, and multiple coverage-unit primitives. The normal production adapter exposes one product per substrate, fixes coverage to square feet per purchased pack, and passes `allowancePercent: '0'`. Material absence uses hard-coded cost allowances per measured unit per coat: `$0.35/sqft`, `$0.18/linear ft`, or `$8/item`, then markup. These are not validated contractor pricebook data.

Compatible groups include product/variant, sheen, phase, color identity, coverage, pack size, cost, markup, and any supplied restriction. Unknown colors deliberately get isolated groups. This avoids assuming incompatible paint can be shared, but makes unresolved-color quotations conservative. Identity currently includes both color code and name; differing names for the same supplier/code can fragment a group.

Pack size and coverage are explicit. `coverageSqFt` means **coverage per purchased pack**, not always coverage per gallon. A five-gallon product entered with one-gallon coverage would be materially mispriced. One available pack size is selected per material; an optimized mixture of quarts, gallons, and five-gallon pails is not modeled.

The engine separates acquisition cost from selling price, allocates cents deterministically, excludes unselected options from base totals, allocates discounts, and applies a recorded percentage/fraction tax rate. Current production resolution takes tax from the organization's global setting, not the supplied jobsite. Tax overrides, taxable categories, and jurisdiction resolution need a common policy adapter; this is not a claim that existing invoice tax configuration is absent.

### 4.3 Scope And Lifecycle

Verified strengths worth preserving:

- Empty initial scope; rooms/spaces and substrates; interior/exterior starter generation.
- Direct measurement override, coats, prep, application method, product, color, crew notes, optional scope, customer visibility.
- Shared pure engine used for preview and server pricing; the server resolves tenant-owned active rates/products.
- Exact bounded decimal arithmetic and safe cents totals; calculated and stored snapshots.
- Draft saving, sent-estimate revisions, signed-document protections, proposal/email preview, signature and linked job/invoice paths.
- Compatible-group purchasing, paint schedule, supplier purchase history, and actual cost capture.
- Job financial summaries distinguish recorded cost position from final margin and do not invent profit when evidence is incomplete.

These are already implemented capabilities. Do not re-budget them as a new engine, new CRM, new invoice entity, or new customer portal.

Important remaining boundaries:

- Production inputs do not pass a burdened labor rate into the engine, so this path returns `laborBudgetMinor: null`.
- Quick quotes preserve useful hours/material data in their quick summary, but persist selling adjustments into the production calculation contract. Do not infer a complete production cost budget from adjustment totals.
- Signed acceptance, job creation, and invoice handoff remain a multi-operation path. Successful pricing tests do not establish transactional lifecycle reliability.
- Optional scope currently represents published, additive customer prices. Purchase-efficiency savings after combining accepted options must not silently alter those agreed prices.
- Removed customer self-service color selection remains out of scope. This plan needs internal estimating color assumptions, not restoration of that feature.

## 5. Findings Ranked By Impact

### P0: Correct Scope And Avoid Lost Work

**F01 - Trim None still generates trim.** `buildInteriorScope` sets the perimeter multiplier to zero but still adds door/window casing. One default bedroom produces `0 + 14 + 16 = 30 linear feet` of trim when None is selected. This can add unwanted scope and price. [Production UI](../apps/web/src/pages/estimates/EstimateProduction.tsx), lines 770-778.

**F02 - Heavy prep can replace finish paint with primer.** `surfaceMaterialId` chooses the estimate primer when prep is heavy and a substrate does not explicitly override its product. There is only one material slot. This can price a primer-only system while presenting a repaint, rather than adding primer and retaining finish paint. [Production UI](../apps/web/src/pages/estimates/EstimateProduction.tsx), lines 856-857; [adapter](../packages/core/src/estimation-production.ts), lines 127-134.

**F03 - Rebuilding starter scope replaces edited rooms without a choice.** Review reopens the generator; its build handlers call `setRooms(nextRooms)` or `setRooms([next])` directly. There is no append/replace confirmation in this path. [Production UI](../apps/web/src/pages/estimates/EstimateProduction.tsx), lines 793, 831, and 1251-1266.

**F04 - Reusing room metrics changes the measurement convention.** Generated interior walls deduct assumed openings; Use room metrics replaces that with gross perimeter times height. Generated trim includes casing; the same action replaces it with bare perimeter. The result can change scope and price rather than merely refreshing dimensions. Room metrics are not an editable first-class room measurement form in `RoomCard`. [Production UI](../apps/web/src/pages/estimates/EstimateProduction.tsx), lines 767-772 and 839-846.

### P1: Reliable Labor, Material, And Price Assumptions

**F05 - Rate semantics are undocumented in the data contract.** One output/hour rate is multiplied by coats. No complete-system/per-coat flag or coat table exists. Importing rate values from either of the complete-system competitor examples would overstate labor. Add an explicit basis before migration or onboarding guidance encourages copying rates. [Schema](../packages/db/src/schema.ts), lines 447-460; [engine](../packages/core/src/estimation.ts), lines 214-228.

**F06 - Application speed can be counted twice.** Rate descriptions can already say spray; `defaultMethod` infers spray-only, then the universal `1.6` factor speeds up the selected rate again. Whether this is wrong for an individual rate depends on its calibration, but there is no field proving that a second modifier is appropriate. [Production UI](../apps/web/src/pages/estimates/EstimateProduction.tsx), lines 306-310; [rate defaults](../apps/api/src/routes/production-rates.ts), lines 26-38; [adapter](../packages/core/src/estimation-production.ts), lines 7-8 and 118-121.

**F07 - Preparation and access lack independent budgets.** Prep multiplier, paint coats, and method speed interact even when masking is done once. Setup, protection, cleaning, repairs, access/lifts, mobilization, and cleanup can be entered as manual adjustments, but those adjustments have no typed labor/acquisition-cost budget. This is an omission in the model, not proof that users never charge for those tasks.

**F08 - Cost and sell pricing are not fully connected.** The core supports burdened labor, but the production adapter only provides selling rate. Seeded per-rate prices override organization defaults; changing the company's default hourly rate may therefore not affect most lines. A 30% material markup is not a 30% gross margin. Estimated margin requires real cost assumptions, not sales-rate subtraction or fake zero costs. [Adapter](../packages/core/src/estimation-production.ts), lines 59-63 and 117-137.

**F09 - Conservative paint purchasing is insufficiently controllable.** Unknown-color groups increase pack costs, normal production allowance is fixed at zero, and a single pack size can overshoot small demand. Show consumption, buying allowance, and buying cost distinctly. Add explicit shared finish/color assumptions without merging genuinely incompatible variants. Keep actual contractor prices separate from generic supplier-list defaults.

**F10 - Ceiling/wall color separation is not an active pricing operation.** Historical detail/schema fields mention ceiling-color separation, but current production inputs/UI do not drive a corresponding masking/cut-in operation. It is not enough to set two color names. The proposal needs the chosen finish relationship and its included separation work. [Production request schema](../apps/api/src/lib/production-estimation.ts), lines 10-39; [historical detail rendering](../apps/web/src/pages/estimates/EstimateDetails.tsx), line 189.

**F11 - Measurement assumptions need an explicit policy.** Starter dimensions, fractions of windows, opening allowances, roofline, generic painted widths, and door faces are heuristics. Automatic openings subtraction is not universally correct for labor. The PCA's explanatory estimating article treats small openings differently from large deductions and distinguishes measurement conventions from actual geometry. Support separate labor takeoff and coating area, with a named policy; do not claim current arbitrary deductions are PCA-certified. [PCA measurement discussion](https://www.pcapainted.org/blog/pcas-industry-standards-on-estimating/).

**F12 - Tax is not resolved from estimate jobsite in this production path.** A single organization percentage is applied to all included selling lines. Reuse the platform's tax-rule configuration through a shared resolver with explicit override/source/effective-date snapshot. Do not present a ZIP lookup as legally authoritative for every jurisdiction. Professional tax validation is a separate requirement.

### P2: Efficient Mobile Work And Qualified Learning

**F13 - Too many controls remain expanded per substrate.** `RoomCard` displays label, dimensions/override, coats, prep, method, product, two labor adjustments, color/status, note, visibility, optionality, total, and removal together. Some grids are two columns even on phones. This is a source-based density assessment, not a new measured usability score. Use concise rows and an edit sheet rather than making every field a permanent fixture.

**F14 - Draft saving is not interruption recovery.** A user must save successfully to retain work. The production page has no localStorage/IndexedDB recovery path. Add tenant/user-scoped local drafts, conflict handling, and unmistakable local-versus-server saved states; do not silently send or accept agreements offline.

**F15 - Actuals need attribution before rate learning.** Job-level time/purchases support job-level variance, but they cannot accurately establish a wall or trim production rate without measured scope and task-attributed hours. Purchased gallons are not necessarily applied gallons or waste. Add lightweight attribution and closeout completeness before generating rate recommendations.

## 6. Worked Calculations And Reproductions

All rates, prices, crew sizes, and dimensions below are examples, not recommended industry defaults. Competitor examples demonstrate semantics, not a fair performance test of identically configured businesses.

### 6.1 Do Not Multiply A Complete Two-Coat Rate Again

For the documented Estimate Rocket example, 768 square feet at a complete two-coat rate of 80 square feet/hour is `768 / 80 = 9.60 hours`. Effective two-coat coverage of 175 square feet/gallon gives `768 / 175 = 4.388571 gallons`.

Using those same raw numbers in Crewmodo's current per-coat model with two coats would produce `768 / 80 * 2 = 19.20 hours` before prep, and `768 * 2 / 175 = 8.777143 gallons`. Neither engine must be wrong: the **input basis differs**. Import a compatible complete-system rate, or convert and label it; never silently reuse the numbers. [Documented comparison fixture](https://support.estimaterocket.com/item-templates/using-the-interior-painting-item-template).

### 6.2 Separate Preparation From Later-Coat Efficiency

Proposed operation example:

```text
1,000 sqft; first pass 100 sqft/hour; second pass 150 sqft/hour
Painting = 1,000/100 + 1,000/150 = 16.666667 labor-hours
Preparation = 4 labor-hours, once
Total = 20.666667 labor-hours
```

Read-only probe against today's adapter with the same area, a single rate of 100, two coats, standard prep, and an additional four prep hours:

```text
Painting with multiplied prep = 1,000/100 * 2 * 1.2 = 24 hours
Additional preparation        = 4 hours
Total                         = 28 hours
At $65 selling/hour           = $1,820 labor price
```

The difference does not prove every current quote is too high. It shows why a combined, linearly scaled prep/application model cannot explain different first/second-pass behavior. This probe also returned `laborBudgetMinor: null` and used the rate's `$65` rather than the organization's `$90` default.

### 6.3 Unknown Colors And Purchase Allowance

Verified adapter probe: three 80-square-foot surfaces, two coats, coverage 400 square feet per one-gallon pack, cost `$50/pack`:

| Color assumption | Consumption | Purchase groups | Bought quantity | Contractor cost |
| --- | --- | --- | --- | --- |
| Same explicitly identified color | 0.4 + 0.4 + 0.4 gallons | One | 2 gallons | $100 |
| All unspecified | Same 1.2 gallons | Three isolated | 3 gallons | $150 |

Today's safeguard is deliberate. The improvement is an explicit `shared provisional color group`, not unconditional merging. Differences in product, sheen, tint base, restrictions, or phase still prevent pooling. Show that the additional gallon is an allowance caused by unresolved purchasing assumptions.

### 6.4 Room Geometry Should Be Entered Once

For a 12 by 14 foot room, height eight feet:

```text
Perimeter = 2 * (12 + 14) = 52 linear feet
Gross walls = 52 * 8 = 416 sqft
Ceiling = 12 * 14 = 168 sqft
Baseboard = 52 linear feet before an explicit exclusion policy
Painted baseboard area at six inches = 52 * 6/12 = 26 sqft
```

Labor may use a configured gross takeoff while material demand uses net coating area. Door/window casing, door faces, and ceiling color-separation edges need their own operations or count rules. A perimeter alone cannot determine ceiling area: many room shapes have the same perimeter. Retain length/width or an explicit ceiling area.

### 6.5 Markup, Margin, Tax, And Days Are Different Concepts

```text
$1,000 direct cost with 30% markup: price $1,300; gross margin 23.08%
$1,000 direct cost at 30% target gross margin: price $1,428.57
```

Exclude collected sales tax from operating margin. Allocate discount to the taxable selling basis according to the snapshotted policy. Payment milestones divide the agreed receivable; they do not create extra revenue.

`60 labor-hours / (3 painters * 8 productive hours/day) = 2.5 crew-days`, not 60 elapsed hours and not an unconditional three-day promised schedule. Access, cure/dry sequencing, weather, trips, and business calendars affect elapsed duration. Crew-size estimates must not reduce labor-hours or multiply labor cost again.

## 7. Proposed Calculation Model

### 7.1 Explicit Measurements

Preserve measured quantity and selling quantity as different concepts. A proposal can sell one room package while still carrying its actual takeoff.

Each measurement stores unit, source (`measured`, `derived`, `starter_allowance`, `override`), raw dimensions, deduction policy, labor quantity, coating quantity, and override reason where applicable. Stable room/substrate IDs survive edits and copying.

- Interior: length, width, height; optional direct perimeter/wall area for irregular rooms; explicit ceiling area fallback.
- Exterior: elevation width/height and optional gables; fast perimeter/story starter remains an allowance, not an exact takeoff.
- Trim: linear measure with preset painted width or calibrated linear coverage.
- Doors/windows: counts, faces/type, calibrated hours and gallons per item.
- Cabinets: counted doors/drawers or calibrated area, with a preparation/coating-system preset.

Do not require a ladder measurement to quote ordinary trim. Let owners use validated count/linear allowances and override them with measured evidence.

### 7.2 Versioned Assemblies And Operations

An assembly is a reusable specification, not another customer-facing line item category:

```text
Area -> Substrate -> Assembly -> Operations + Coating Layers
```

Suggested operation types: protection/masking, washing, repairs, sanding/caulk, spot/full primer application, finish application, color separation, cleanup, mobilization, equipment, and subcontract allowance. Each operation owns its quantity, labor basis, cost assumptions, and scope description.

For the first release expose two rate modes:

1. **Units/hour for selected complete system:** `hours = quantity / selectedCoatRate`.
2. **Hours/item for selected complete system:** `hours = quantity * selectedCoatHours`.

Retain `legacy_per_coat` for historical compatibility. Advanced per-pass rates are optional internal assembly detail, not another mandatory form. Direct hours and fixed selling adjustments remain available, but require explicit budget cost or an unknown-cost marker.

```text
LaborHours = sum(operationHours)
LaborBudget = sum(operationHours * snapshottedBurdenedRate)
LaborSelling = sum(operationHours * snapshottedSellingRate)
DirectCost = LaborBudget + MaterialPurchaseCost + Equipment + Subcontracts + Sundries
```

Prep/setup operations occur once at their correct project/area/substrate scope. Do not discount prep labor merely because the finish application is sprayed. A spray preset can include masking/setup plus faster application and its own material loss; it is not always cheaper.

Avoid treating negative total labor as valid. Reject corrections below zero with an inline error; retain a reason for material departures from calibrated rates.

### 7.3 Coating System And Product Demand

Support separate layers for spot primer, full primer, and finish, each with its own coverage, number of coats, product, method, and demand. Prep severity must not choose a replacement product behind the user's back.

```text
LayerGallons = netCoatingArea * layerCoats / oneCoatCoveragePerGallon
              * (1 + explicitLossAllowance)
PurchasePlan = allowedPackCombination(compatibleGroupDemand)
```

Initial purchase plan: aggregate compatible demand, then round using the configured pack size, as today. Mixed-pack optimization follows later; it must obey product/base availability and contractor preferences rather than blindly pick the cheapest can.

Add a contractor-level choice:

- **Purchase-based:** price materials from whole-pack acquisition cost, recommended default continuity with today's behavior.
- **Consumption-based:** price exact theoretical usage; still show an independent whole-pack order budget and expected leftover allowance.

Never silently switch an existing estimate's basis. An explicit provisional color group can represent shared walls before exact color is known. Wall and ceiling color relationships should be `same`, `different`, or `unconfirmed`, and carry any included cut-in/masking operation. Same color does not imply the same product/sheen or one shared buying group.

Capture one-coat coverage per gallon as the normalized value and derive per-pack coverage. Existing per-pack fields require an explicit, audited conversion. Track manufacturer reference separately from contractor-calibrated coverage and last acquisition-price date/source. Supplier retail/catalog data is not proof of the contractor's negotiated cost.

### 7.4 Pricing And Commercial Review

Keep the default model simple: configured labor sell rates plus marked-up materials and typed extras. Show estimated direct cost and gross margin beside selling totals when the budget is complete.

Add target-margin assistance later, explicitly distinguishing direct-cost gross margin from profit after allocated overhead. If overhead is already recovered in selling rates, do not add it as a second automatic selling charge. Project minimums, mobilization, and contingency are named, auditable adjustments, not unexplained price padding.

Centralize the tax resolver for quotes, change orders, and invoices. Record jobsite, selected rule, taxable categories, override actor/reason, tax basis, rate, source, and effective timestamp. Freeze accepted scope, options, budget, and tax assumptions together. Rules require jurisdiction review; software cannot manufacture legal tax certainty from a ZIP.

## 8. Mobile-First Estimator Journey

### 8.1 Entry And Setup

1. Contextual customer/jobsite preselection; search or create customer inline.
2. Choose template or add a room/elevation. Starter generation is an optional estimate-level shortcut, never inside a substrate.
3. Show inherited products, coatings, and rates in a compact defaults section. Setup needs lead to their exact settings destination and return to the estimate.

No required numbered wizard. Estimates can be built incrementally during a site visit. A template already provides scope; do not show a second starter builder by default.

### 8.2 Room Capture

Room row: `Bedroom 1 | 4 substrates | estimated hours | price`, with a 48px quick-action menu. Selecting it opens a full-height mobile sheet with a visible bottom action and reserved safe-area space.

Capture name, length/width/height, included substrates, and any exceptional condition. Apply inherited specs automatically. Allow duplicate room, use previous room specs, and multi-room product changes. Show estimated/derived measurements as such and provide deliberate overrides rather than simultaneous duplicate inputs.

Substrate row: name, coats, concise product, measurement, and exception indicator. Expand only the selected row. Show details in four short groups: Measurement, Coating, Preparation, Advanced. Common tasks should not need every group opened.

Keep dimensions adjacent only when they fit comfortably; never make two narrow fields or a horizontal table the required mobile workflow. No card-inside-card hierarchy for major sections. Use section headers and separators with unframed rows.

### 8.3 Review And Send

- Thumb-reachable summary: price and `Review proposal`; secondary Save draft in contextual actions.
- Internal costing review: labor-hours, burdened labor, theoretical gallons, purchased packs, material acquisition cost, extras, selling subtotal, tax, total, and estimated margin when available.
- Exceptions first: missing product/cost, unresolved measure, unusual correction, provisional color group, or incomplete coating system.
- Customer preview: rooms/elevations with included substrates, coats, paint product/sheen, preparation commitments, exclusions/options, jobsite, one overall price, tax, payment schedule, and agreement terms.
- Do not expose internal production rates, costs, or measurement calculations by default. Proposal itemization explains scope, not every arithmetic input.
- Preview the email before sending. Keep existing dual-signature and authorization rules; acceptance is separate from payment.

### 8.4 Acceptance And Production

Freeze the accepted calculation and publish its operating budget. Contractor policy governs deposit requirements and booking readiness; a paid deposit does not invent calendar dates.

Crew view: jobsite, room/substrate tasks, product/coating instructions, work-order hours, private notes, relevant photos, and outstanding readiness actions. Owners see costs/margin; crew permissions do not reveal private pricing unless authorized.

Supplier purchases and approved time compare to the correct baseline plus approved change-order budget deltas. A changed product or color cannot silently rewrite a signed price. Report any cost absorption, approved variation, and remaining uncertainty separately.

### 8.5 Interrupted And Weak-Connection Use

Debounced local draft storage keyed by organization/user/estimate, with an explicit Restore/Discard prompt. Clear accessible drafts on sign-out and account switch; define retention and sensitive-data handling. Server saves retain existing idempotency and expected-version checks.

Show `Saved locally`, `Saved`, `Saving`, or `Needs attention`; never claim a financial mutation succeeded offline. Sending, signature, payment, and budget activation require online confirmation. Handle stale server changes through a review/merge choice, not silent overwrite.

## 9. Implementation Checklist And Dependency Order

This extends the existing [repaint implementation checklist](implementation/repaint-margin-control/CHECKLIST.md). E01-E06 are foundation work already accepted; E07 and T04 remain relevant. Do not replace their evidence with new planning checkmarks. The unchecked list below preserves the original proposed scope; section 13 records the October 4 implementation and remaining gates separately.

### Phase A: Scope Safety And Measurement Consistency

- [ ] **PE01:** Fix Trim None, heavy-prep product fallback, and starter replace behavior. Owner: estimation UI/core. Add targeted regression tests before changes; confirm draft and template parity.
- [ ] **PE02:** Extract pure starter/room measurement functions with explicit derivation and opening policy. Same room metrics produce consistent wall/ceiling/trim demand; manual overrides remain intact until explicitly reset.
- [ ] **PE03:** Add a small current-pricebook explanation: rate basis, rate-level versus organization sell rate, prep assumption, material pack/coverage basis, missing-price allowances. No forced setup wizard; unresolved essentials block sending, not draft capture.

**Exit gate:** Trim None produces zero trim; finish is retained with primer; regenerate requires append/replace choice; use-room-metrics cannot silently lose casing/opening policy. No changes to historical signed totals.

### Phase B: Versioned Rate And Coating Model

- [ ] **PE04:** Add explicit rate mode, coat table, operation basis, method identity, and rate version/provenance. Preserve a legacy calculation path; detect imported complete-system values.
- [ ] **PE05:** Separate one-time preparation/setup and application operations. Support hours/item as well as units/hour; remove universal method boosts from method-calibrated rates.
- [ ] **PE06:** Add primer/finish layers and wall/ceiling color-relationship operations. Store included separation scope on the proposal and crew view.
- [ ] **PE07:** Resolve burdened cost and selling price independently; support default inheritance with an intentional rate override. Typed extras carry cost and labor budget or an explicit unknown flag.

**Exit gate:** The new model reproduces independently calculated fixtures; first versus later pass, setup once, spray masking, doors/faces, and primer-plus-finish all reconcile. Existing agreement renderer remains version-aware.

### Phase C: Materials And Commercial Policies

- [ ] **PE08:** Normalize coverage per gallon versus pack, expose per-operation loss allowance, and add explicit shared provisional color groups. Canonical supplier/color identity takes precedence over label spelling when known.
- [ ] **PE09:** Separate consumption budget, order plan, acquisition cost, and customer material price. Preserve purchase-based default; offer an explicit optional consumption policy. Mixed-pack optimization is a later subtask, not a blocker for the initial correction.
- [ ] **PE10:** Reuse tax configuration through one quote/change-order/invoice resolver with jobsite and auditable overrides. Reconcile accepted options, discounts, and milestone invoices to cents.
- [ ] **PE11:** Add cost-complete estimate review, markup-versus-margin explanation, stale-price indicators, explicit minimum/mobilization allowances, and optional target-margin assistance.

**Exit gate:** Price/budget provenance is visible; optional and base scope reconcile under the recorded contract policy; unspecified colors cannot cause hidden padding; unsupported tax/cost assumptions are not presented as certainty.

### Phase D: Fast Mobile Capture And Recovery

- [ ] **PE12:** Replace expanded substrate forms with compact room/substrate rows and progressive edit sheets. Reuse existing fields, sheets, menus, typography, and async states. One primary action and 48px touch targets.
- [ ] **PE13:** Support bulk inherited specs, duplicate room, measurement reuse, photos near relevant scope, and safe quick/production/template interchange without losing budgets.
- [ ] **PE14:** Implement tenant/user-scoped local draft recovery, stale-version review, and connectivity indicators. Integrate existing T04 rather than build a second draft system.
- [ ] **PE15:** Complete E07 with desktop/mobile/iOS-engine browser scenarios: 360/390/768/1440 widths, virtual keyboard, long product names, 20-room scope, interrupted draft, and send-price-change review.

**Exit gate:** No required horizontal scrolling or hidden sheet actions; a repeated standard room needs no re-entry of shared specs; slow saves preserve inputs and suppress duplicate actions; local recovery never crosses users/tenants.

### Phase E: Budget Handoff And Learning

- [ ] **PE16:** Publish one immutable accepted operating budget with stable operation IDs, selected options, and approved change-order budget deltas. Recover sign/job/invoice handoff through durable operations; no duplicate activation/email on retries.
- [ ] **PE17:** Compare budget to approved time and dated supplier purchases. Distinguish ordered/purchased, returned, transferred, leftover, and actually used paint where known. Otherwise show purchase variance, not invented waste.
- [ ] **PE18:** Add optional task attribution and cost-closeout review; generate rate suggestions only from qualified comparable jobs. Owner previews and approves a new pricebook version; no automatic signed-document repricing.

**Exit gate:** Estimates can be traced into actuals without double-counting labor/purchases. Recommendations include sample size, conditions, exclusions, and evidence; incomplete data does not silently train the next estimate.

### Execution And Ownership

Start with Phase A, then freeze Phase B contracts. Rate/coating work and mobile research may run in parallel, but schema/core types must have one coordinator. Phase C depends on the new operation semantics; Phase D can ship incrementally behind backward-compatible adapters. Phase E needs preserved operation identities and qualified actuals.

Suggested work streams:

| Stream | Exclusive primary areas | Deliverable |
| --- | --- | --- |
| Calculation/domain | `packages/core/src/estimation*`, new operation/measurement helpers | Versioned DTOs, independent worked fixtures, deterministic results. |
| API/data coordinator | Schema/migrations, pricing resolver, estimate/job lifecycle | Tenant-scoped authoritative pricing, compatible migration, snapshots, atomic/recoverable handoff. |
| Mobile estimation | Production/quick/template React components | Fast room capture, inherited settings, sheets, preview, draft recovery. |
| QA/production feedback | Unit/integration/E2E tests, actuals adapters | Regressions, safe two-tenant corpus, usability evidence, qualified variance. |

Use separate small implementation commits behind additive compatibility. Do not combine an estimator UI replacement with reinterpretation of signed financial history. Promote main/dev to staging after full gates; production only after migration rehearsal and reviewed residual risks. Scope-based gates are more useful than an unsupported calendar promise.

## 10. Data And API Design

These are proposed additions, not a demand for a new service architecture:

| Contract/entity | Suggested contents | Migration/ownership rule |
| --- | --- | --- |
| Versioned rate/assembly | Rate mode, coat entries, operation type, method, explicit unit, inherited/override sell and cost basis, product defaults | Additive tenant-scoped records; existing rates become explicit legacy mode without repricing. |
| Room measurement | Geometry, deduction policy, provenance, derived values, override values | Persistent stable IDs; extract calculations into pure helpers rather than React-only functions. |
| Coating layer | Primer/finish, coats, product variant, one-coat coverage, loss factor, color relation/group | Accepted snapshot includes the full layer definition; no inferred primer substitution. |
| Pricing snapshot v2 | Exact inputs, line operations, material groups/order plan, costs/sell/tax, warnings, versions | Preserve v1 reader; never backfill signed documents by running v2. |
| Job budget version | Accepted document/version, operation IDs, approved change deltas, time/material budgets | Append-only reviewed scope changes, not edits to the accepted baseline. |
| Rate observation | Comparable quantity, qualified hours/phase, access/method, source job/version, closeout status | Keep exclusions and confidence; tenant-local defaults until aggregation consent/privacy is designed. |

Keep pure calculations in `packages/core`, tenant catalog resolution/transactions in the Workers API, and React as an editor/projection. Reuse existing estimate storage and routes when JSON snapshots suffice; do not create duplicate estimate/room entities simply because legacy relational tables also exist.

API preview returns a versioned result, field errors, warnings, rate/material/tax provenance, and cost completeness. Save resolves authoritative tenant prices and compares the preview version. Materially changed prices require explicit review before send. Editable quotes retain clear snapshot-versus-current-price behavior; signed scopes remain frozen.

Every new table and child query needs tenant-isolation tests. Every mutation needs the existing idempotency contract and stale-version handling. Add action analytics for capture/review/save/send while excluding addresses, customer identities, and sensitive quote content. Redact provider data in logs and attach correlation IDs to failed calculations/saves.

Avoid side-effecting GET initialization for new rate defaults. Install versioned sample pricebooks through an explicit setup operation; label them sample/unreviewed, and preserve intentional deletions/customization. Defaults must be calibrated by the contractor before they are sold as pricing guidance.

## 11. Acceptance Corpus

Independent expected outcomes must come from hand-calculated fixtures or separately reviewed spreadsheets, not the same engine generating its own expectations.

1. Legacy v1 estimate yields the same cents and scope after v2 deployment; accepted historical preview is unchanged.
2. Complete two-coat fixture: 768 sqft / 80 sqft/hour = 9.60 hours; coverage basis conversion does not double coat demand.
3. Prep once with different later-coat speed; adding a coat cannot multiply masking/setup by default.
4. Changing application method uses its chosen calibrated assembly and allowance, without an additional universal speed boost.
5. Trim None, doors excluded, ceilings excluded, and optional-only scope cannot leak into base scope.
6. Gross labor/net coating policies and room metric reuse preserve deliberate deductions/overrides.
7. Primer one coat plus finish two coats produces both products and both labor operations.
8. Same versus different ceiling color has the included separation operation and proposal wording; changed contract scope requires a revision/change order.
9. Compatible 0.4 + 0.4 + 0.4 gallons aggregate before rounding; unknown/different variants never pool silently.
10. Quart/gallon/five-gallon coverage conversion, same supplier/code with label aliases, loss allowances, and consumption/purchase policy reconcile.
11. Missing burden/cost displays unknown margin; a sell-rate or manual price-only adjustment cannot become fabricated direct cost.
12. Jobsite tax rule, overrides, discounts, chosen options, deposit/progress/final invoices, and refunds preserve original snapshotted cents policy.
13. Template, quick estimate, production preview, stored snapshot, customer preview, and accepted job budget agree where semantics are equivalent; intentional quick unit-price rounding is explicit.
14. Regeneration is append or confirmed replace; deleted rooms, stale saves, duplicate clicks, and failed sends cannot lose/repeat work.
15. Signed acceptance retried after each failure boundary yields one job/budget/invoice and recoverable customer communication.
16. Original estimate plus approved change order compares to actual labor/purchases once; returned/transferred gallons are not labeled waste.
17. New rates/layers/products from tenant B cannot be resolved by tenant A or public tokens outside their allowed document scope.
18. Mobile layouts, large text, keyboard focus, touch sheets, rotation, weak network, restore/discard, and account switch work without clipping or stale private drafts.

Test rates are synthetic. Do not run real customer emails, charges, refunds, production reseeds, or financial data repairs from these tests.

## 12. Outcome Measures And Restraint

Proposed pilot targets, not current measured results:

- Median repeated standard-room capture under 60 seconds after initial setup; record taps, required fields, and correction rate.
- No silent quantity/coat/basis changes between template, preview, save, acceptance, and work order.
- Exact quote/budget/invoice reconciliation on the acceptance corpus.
- Reduced estimator adjustments and fewer unknown-cost/color assumptions before sending.
- Estimate-to-approved-actual labor/material variance measured only for cost-complete comparable jobs; start with a baseline before claiming improvement percentages.
- Draft recovery success and no duplicate operation under interrupted/slow connections.

Not in the initial plan: autonomous AI pricing, AI image measurements presented as exact, commercial PDF takeoff, BIM, inventory ERP, a full scheduler rewrite, custom spreadsheet formulas, a restored customer color-selection portal, or mandatory good/better/best packages.

**Production recommendation:** preserve the current engine foundation, but do not claim competitor-level estimating confidence solely because its math tests pass. Approve a wider estimator release after Phase A defects are fixed, rate/coating semantics are explicit, and mobile plus accepted-budget lifecycle gates are demonstrated. Rate accuracy still depends on the contractor's calibrated observations and complete costs.

## 13. October 4 Implementation Review And Rollout

This is the implementation and validation record for `codex/estimator-v2`. `[x]` means the stated initial-release implementation is present with the listed evidence; explicitly deferred improvements and operational release gates are listed separately. Section 9 retains the original planning checklist. Local validation uses a disposable PostgreSQL database and synthetic providers, not live customer charges, emails, production migrations, or contractor calibration.

### 13.1 PE Status And Evidence

| Status | Task | Evidence and remaining scope |
| --- | --- | --- |
| [x] | PE01 Scope safety | Production editor and `estimation-measurement.test.ts` cover Trim None, base versus casing, retained finish under heavy prep, explicit primer, append versus confirmed replace, and removal of the last substrate's empty room. Browser recovery/regeneration cases preserve user edits. |
| [x] | PE02 Geometry | Pure `estimation-measurement.ts` is shared by starter generation and Use room metrics. Named editable opening/casing policy and measured/derived/allowance/override provenance survive duplication and recovery; deliberate overrides, including zero, require replacement confirmation. Seven focused unit cases pass. |
| [x] | PE03 Pricebook review | Internal review shows rate basis, inheritance/provenance, missing prep and legacy basis, product/cost warnings, and markup versus direct-cost margin. Missing send essentials block sending, not draft capture; no unexplained allowance or universal multiplier substitutes for missing inputs. |
| [x] | PE04 Rate semantics | Versioned complete-system/per-pass/hours-item bases, coat tables, method identity, inheritance, and provenance are implemented and unit-tested. The declared `crewmodo-complete-system-import-v1` format identifies complete-system basis and requires a source; conflicting declarations are rejected. Complete-system material coverage requires reviewed per-coat conversion before pricing. Arbitrary vendor files are not automatically decoded or inferred; no CSV parser was added. |
| [x] | PE05 Independent operations | V2 supports identified operations, calibrated method rates, one-time prep hours, and hours/item. UI prep hours do not multiply finish coats; primer has a separate application operation. Core independent fixtures cover setup/masking/cut-in once and no universal spray/prep boost. |
| [x] | PE06 Complete coating scope | Separate primer/finish products, coats, loss, and primer application labor are editable. Different/unconfirmed wall-ceiling colors reveal explicit one-time masking/cut-in hours and scope descriptions; loaded separation work remains editable even for same colors. Stable IDs, multiple loaded operations, zero/removal, and unrelated application/prep work survive recovery and save/reload. Positive separation descriptions become included proposal/crew commitments without exposing costs/hours. Six browser cases independently verify 8.46 versus 16.38 total hours at one versus three coats while separation labor stays fixed. |
| [x] | PE07 Cost versus sell | Core resolves burdened cost separately from selling rate. Typed add-ons expose direct cost, hours, burdened override, and explicit unknown cost. Browser evidence verifies known labor remains $361.19 when direct cost is unknown; margin remains unknown rather than fabricated. |
| [x] | PE08 Material identity | Unit corpus covers gallon/pack coverage normalization, canonical supplier/code identity, per-layer loss, isolated unknown colors, and compatible provisional pooling. UI exposes loss and shared provisional groups; measured net coating remains distinct from labor geometry. |
| [x] | PE09 Material policies | Purchased packs remain the default selling policy; optional consumption selling does not change acquisition cost or order-plan rounding. Independent pooling and pack-basis fixtures reconcile. Mixed-pack optimization remains the later subtask already identified in PE09. |
| [x] | PE10 Tax policy | Shared quote/change-order/invoice resolver, jobsite ZIP/ZIP+4 input, reasoned decimal override, selected-option tax, discounts, frozen payment allocation, and explicit legacy unknown policy have unit and PostgreSQL integration evidence. Public tax and acceptance snapshot remain authoritative; mocked browser results do not certify jurisdiction rules or live providers. |
| [x] | PE11 Commercial review | Cost completeness, direct-cost margin, stale-price/provenance warnings, optional project minimum and one-time mobilization are visible and persisted/recovered. Both commercial fields participate in preview dependencies and form identity. Six browser cases verify direct $5,000/two-hour save/reload without another edit, cached/in-flight preview invalidation, and changed failed-save payload/key identity. Reserved `estimator:minimum`/`estimator:mobilization` lines are server-priced, not user-priced duplicates. Optional target-margin assistance remains explicitly deferred under section 7.4, not implemented. |
| [x] | PE12 Progressive editor | Compact expandable room/substrate rows, two-line product summaries, readable units, visible/accessible field labels, and scoped 48px controls reuse existing typography and Modal lifecycle. The fixed title and separate non-scrolling Done editing footer keep focused fields reachable at 900px and simulated 480px keyboard height without covering content. |
| [x] | PE13 Reuse and interchange | Duplicate room, shared/bulk products with explicit override consent, metrics reuse, and contextual camera/upload reuse existing estimate photos. Photos require a saved estimate and use room captions, not synthetic room IDs as database IDs. Native `crewmodo-assembly-v2` template entry preserves operations/layers, rate and budget overrides, measurement policy, typed extras and commercial defaults through save/reload. Only the primary application/layer follows primary coats/correction edits; secondary application coats/corrections and extra primer operations remain unchanged. Six browser cases verify native entry and rejection of unsafe use responses. Quick/template adapters reject incompatible flattening rather than silently discard budgets; universal native-to-quick conversion is not claimed. |
| [x] | PE14 Draft isolation | Authenticated account identity, org/user/estimate keys, seven-day retention, Restore/Discard, stale-server review, offline status, cross-tab conflict, and direct sign-out/account-switch/401 cleanup are implemented. Tests include cleanup before any editor mount and Save draft -> edit -> reload recovery; save clears the old baseline without indefinitely suppressing later edits. |
| [x] | PE15 Mobile acceptance | The original 12 scenarios across Chromium, mobile Chromium, and WebKit provide 36 automated cases. Two commercial, two separation, and two native-template scenarios add 18, for 54 passing cases. Widths 360/390/768/1440, 20 rooms, long products, 900/480px footer visibility without scrolling the footer into view, prep-field gaps, accessible labels, readable units, trim/primer, regenerate/delete, draft/account isolation, and changed-send-price review are covered. This closes the agreed automated estimator scope; physical iOS/Android keyboard, rotation, enlarged text and degraded-network pilot remain release gates. |
| [x] | PE16 Durable handoff | Immutable accepted budgets, selected options, approved change deltas, sanitized public packages, v2 `expectedUpdatedAt` and terms-version checks, and atomic sign/job/invoice acceptance are implemented. `estimation-acceptance-v2.test.ts` has real PostgreSQL concurrency/failure-boundary/tenant evidence in the 107/107 integration pass, including atomic reviewed-scope/jobsite guards. Durable delivery recovery is tested with synthetic providers; live delivery remains an operational gate. |
| [x] | PE17 Qualified actuals | Approved time, approved change budgets counted once, dated purchases/returns, missing budgets and explicit unknowns are implemented. Purchase variance is not labeled actual waste. Real PostgreSQL API/tenant evidence in `estimation-observations-api.test.ts` is included in the 107/107 integration pass, with no skipped tests. |
| [x] | PE18 Reviewed learning | Optional task attribution, qualified comparability/closeout, exclusions and sample evidence, owner preview/approval, and append-only rate versions are implemented. `estimation-observations-api.test.ts` provides real PostgreSQL approval/versioning/tenant evidence in the 107/107 pass. Incomplete costs do not train rates automatically, and historical signed documents are never repriced. |

### 13.2 Verified API And Private Metadata Contracts

- Authenticated `GET /v1/auth/session` is present in `apps/api/src/index.ts`. It returns `{ data: { orgId, userId } }` with `Cache-Control: no-store`; `authMiddleware` requires a valid server session. Identity is not inferred from token contents, customer selection, or a tenant header. Source audit and the worker-route unit verify unauthorized 401 and authenticated server-session identity.
- Optional `editorState` is present in `productionCalculationSchema` in `apps/api/src/lib/production-estimation.ts`: an object bounded to 2,000,000 serialized characters, not a claimed UTF-8 byte limit. Parsing preserves room/default/measurement recovery metadata in `productionInput`; authoritative pricing uses typed items/operations/layers and tenant catalog/tax inputs, not this metadata. Contract units verify preservation and oversize rejection. This is private editor metadata, not a customer export.
- New drafts request `calculationVersion: 'repaint-v2'`; loaded legacy drafts retain their saved version until an explicit unsigned upgrade review. Existing and historical signed agreements remain frozen and are never run through v2 for repricing.
- The draft helper exports `clearEstimatorDrafts` and `setEstimatorDraftAccount` from `apps/web/src/pages/estimates/estimator-draft.ts`. Direct account updates and cleanup work without an editor mount. Logout/AuthBridge and API401 use the same cleanup integration; the public cleanup event is `crewmodo:estimator-drafts-clear`.
- Requests include current jobsite postal code and optional `{ ratePercent, reason }` tax override. `/settings#estimation-tax-settings` remains the shared settings destination. Minimum/mobilization and typed extra budgets are request fields and recovery state; reserved generated lines are server-priced.
- Optional `operation.description` is supported by the core DTO and bounded to 300 characters by the API schema. Positive masking/cut-in operations publish only their description or a safe generic fallback in `item.scopeCommitments`. Public proposal projection excludes operation hours/costs and editor metadata; proposal and crew-facing scope retain the included work.
- Job list/detail responses whitelist operational fields for accounts without financial access. Private accepted-budget snapshots and cost endpoints require financial permissions; crew budget edits are rejected. `job-budget-access.test.ts` verifies owner access, crew denial, safe operational edits, and foreign-tenant isolation against PostgreSQL.
- Native templates use `crewmodo-assembly-v2` with `repaint-v2`. Shared compatibility checks retain operation/layer identities, budgets and policies, block conflicting scope representations and unsupported package formats, and prevent quick-quote flattening of incompatible native scope. Template defaults are not a frozen historical selling snapshot: new estimates use current tenant catalog prices. Complete-system coverage needs an explicit reviewed conversion; no general CSV importer/customer export was added.

### 13.3 Verification Ledger

- Full unit suite: **277 passed, 0 failed, 0 skipped**. Independent fixtures cover measurement, complete-system/per-coat semantics, primer/separation labor, gallon/pack pooling, exact cents, tax, public redaction, native-template compatibility, and API bounds.
- Full real PostgreSQL integration suite: **107 passed, 0 failed, 0 skipped**. Additive migrations, acceptance concurrency and rollback, same-timestamp scope/jobsite races, idempotent invoices/delivery, frozen terms/tax, qualified actuals/rate approval, private budget permissions, and tenant/RLS isolation are exercised.
- Full browser suite: **194 passed, 0 failed** (6.3 minutes) against an isolated temporary preview on port 5191. Chromium, mobile Chromium, and WebKit cover product workflows; Firefox additionally covers signup. The 54 estimator cases include 360/390/768/1440px layouts, simulated short keyboard height, 20-room scope, commercial changes, explicit separation operations, native-template preservation, draft isolation, and interrupted approval retries.
- Final 360px editing-sheet and 1440px room-list screenshots were visually inspected for field spacing, readable units, reachable actions, and overflow. Browser artifacts: `/tmp/crewmodo-browser-freeze`. Automated WebKit is not a physical iOS-device test.
- API/web typechecking, production build, typography lint and button lint **pass**. Lint warning budgets remain **310 typography / 21 buttons**; existing legacy warnings are not claimed to have been eliminated. Playwright now accepts an isolated preview port, and signup fixtures no longer hard-code a different origin. GitHub CI must also pass before merge.
- Actual auth/session, editorState and bounded operation-description contracts were audited. Test providers are synthetic: no live emails, charges, refunds, production reseeds, or financial repairs were run. Physical-device/network pilots and approved live-provider checks remain release gates.

### 13.4 Delivery Recovery And Release Order

A separate every-15-minute delivery recovery trigger (`*/15 * * * *`) is present in Wrangler and the worker dispatcher. The existing evening operations-reminder trigger (`*/30 1-6 * * *`) is unchanged. The new tick runs only accepted-estimate outbox recovery, not missed-punch reminders, drips, or review requests.

The accepted-delivery outbox caps provider attempts at eight and the recovery window at 23 hours. A prepared Resend payload and stable delivery idempotency key are frozen before retry; claims use leases and attempt-fenced writes. Exhausted/expired or undeliverable work moves to `needs_attention` (dead-letter attention). An owner/operator must check the provider outcome before any manual action; do not blindly resend or generate a new provider key after ambiguous delivery. A saved signed agreement/invoice does not imply its customer email was delivered.

1. Cross-review the branch, record final aggregate tests and confirm the deferred improvements and release gates below. Require passing GitHub CI before merging to `main` (dev); staging and production promotion are separate decisions.
2. Rehearse additive migration and v1/v2 reader compatibility in the approved test/staging environment. Preserve signed historical cents, tax, scope, and acceptance snapshots; never backfill them by recalculation.
3. Review contractor rate/coat/method/prep tables, burdened cost, dated product purchase-price basis, gallon/pack coverage, color/loss grouping, and jurisdiction tax policy. Sample/unreviewed catalog values and stale or missing costs are warnings, not calibrated pricing authority. Passing arithmetic tests does not establish field productivity, a current supplier quote, overhead recovery, or legal tax correctness.
4. Complete physical-device/accessibility and interrupted-network pilot gates. The PostgreSQL/synthetic-provider corpus already exercises durable acceptance/outbox recovery; validate deployment scheduling and provider behavior in an approved sandbox without real customer emails or charges. Confirm the operational `needs_attention` escalation before enabling wider delivery.
5. Promote only after team acceptance, with version-preserving rollback compatibility. Do not reinterpret issued/signed history or claim measured estimating accuracy/variance improvement before qualified contractor observations exist.

Explicit color-separation editing and safe native-v2 template entry are implemented, not remaining software gaps. Target-margin assistance is deferred under section 7.4, and mixed-pack optimization remains the later PE09 subtask. Contractor paint-pricing/productivity calibration, dated acquisition-cost verification, physical-device/network pilots and live-provider deployment checks are pending limitations/release gates, not product non-goals or claims of measured accuracy. Section 12's restraint remains unchanged; no general CSV/customer export, new photo storage or AI measurement/pricing feature was added.
