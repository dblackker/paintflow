# Customer Color Selection Future Spec

## Goal

Let customers choose paint colors from the public proposal or customer portal without creating production risk for the contractor. The workflow should be optional, server-controlled, and easy to disable if it causes confusion during sales demos or early production use.

## Lessons From The Removed Prototype

- Color selection should not be bolted directly onto the public proposal without a clear contractor setup path.
- Wall and ceiling color assumptions affect labor pricing, especially masking and cut-in work. The estimate must lock whether ceilings match walls or use a separate color before customers can choose colors.
- Whole-home color reuse is useful, but grouping by paint product alone is too broad. Grouping must respect space, substrate, and pricing assumptions.
- Job readiness warnings are valuable, but they should only appear when the color-selection workflow is intentionally enabled for the workspace.
- Public API endpoints should return a disabled/not available state when the feature is off, and internal screens should hide the workflow completely.

## Recommended Feature Flag Strategy

Use a server-evaluated feature flag before reintroducing this workflow.

Suggested flag:

```json
{
  "customerColorSelection": true
}
```

Evaluation should happen in the API, not only the browser. The browser can receive evaluated flags for UI rendering, but server endpoints must enforce the flag.

Good future locations:

- Database-backed org preferences for a small internal rollout.
- OpenFeature-compatible provider if Crewmodo later needs environments, percentage rollout, audit history, or remote config.
- Cloudflare-native flags if the app standardizes on Cloudflare for runtime controls.

## Proposal Requirements

The proposal should explicitly show:

- Paint product by substrate.
- Color status by substrate: TBD, selected by contractor, customer selection needed, approved.
- Ceiling color assumption for each room when ceilings are included:
  - Same color as walls.
  - Different ceiling color included.
  - Customer-selected ceiling color requires revised proposal if not priced.
- A note that signed proposals are immutable and color changes after signing may require a change order if they affect labor, material, or schedule.

## Estimator Requirements

Before sending a proposal, the estimator should be able to set:

- Whether the customer may choose colors.
- Whether one color can apply to repeated matching substrates.
- Whether ceilings match walls or require separate color selection.
- Whether customer selections are required before scheduling or just before paint ordering.
- Whether freeform colors are allowed when a catalog color is missing.

The estimate payload should store these as explicit proposal terms, not inferred UI state.

## Customer Workflow

Customer-facing flow:

1. Customer opens proposal or portal link.
2. Customer reviews included scope and paint products.
3. Customer selects colors only for required groups.
4. Customer can apply one color to matching groups when allowed.
5. Customer can type a custom swatch if catalog search does not find it.
6. Customer submits selections.
7. Contractor receives an activity event and notification.
8. Job readiness updates from "colors needed" to "colors selected."

## Contractor Workflow

Contractor-facing flow:

1. Estimate is sent with color rules locked.
2. If colors are incomplete and job is scheduled or in production, show a readiness item.
3. Contractor can send a color reminder from the job or customer detail page.
4. Submitted colors become part of the job production handoff.
5. Color changes after approval should create activity history and may require a change order if pricing changes.

## Data Model Direction

Avoid storing customer selections only inside estimate package JSON long-term.

Preferred future model:

- `estimate_color_requirements`
  - org id
  - estimate id
  - package name
  - room/space
  - substrate
  - paint product id
  - selection rule
  - required before stage
- `customer_color_selections`
  - org id
  - estimate id
  - job id
  - requirement id
  - catalog color id nullable
  - supplier
  - color name
  - color code
  - freeform note
  - selected by
  - selected at
  - approval status

Estimate package JSON can still include a denormalized snapshot for proposal rendering.

## Guardrails

- Do not let customers choose a different ceiling color when the proposal priced ceilings as same color as walls.
- Do not let customers collapse walls and ceilings into one grouped color unless the estimate explicitly allows it.
- Do not block signing/payment if the contractor marks color selection as post-approval.
- Do not show color readiness warnings when the feature flag is off.
- Do not require catalog-only selection; paint suppliers have colors that may not import cleanly.

## Rollout Plan

1. Add feature flag and server enforcement.
2. Add estimator configuration, hidden by default.
3. Add read-only proposal color requirements.
4. Add customer selection UI behind the flag.
5. Add contractor notification and activity log.
6. Add job readiness warnings behind the same flag.
7. Add tests for feature-off behavior, same-wall-ceiling enforcement, separate-ceiling enforcement, and freeform color submission.
