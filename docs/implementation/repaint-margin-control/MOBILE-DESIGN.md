# Mobile Design And Acceptance Spec

Design contract for the [implementation plan](README.md). Owner: shared-design agent, with workflow owners implementing screen compositions and QA validating them.

## 1. Experience Standard

Crewmodo should feel like a calm, precise field tool: readable in a truck, usable with one thumb, fast under interruption, and trustworthy around money. "Amazing" means the owner immediately sees the next useful action and never has to decode contradictory totals, hunt for controls, or recover lost form input.

Use the existing Inter/system font stack, Lucide-backed [Icon component](../../../apps/web/src/components/Icon.tsx), Material-role tokens, and shared Button/Input/Modal foundations. Improve those foundations instead of introducing another UI kit, icon pack, type scale, or disconnected CSS theme.

Retain a restrained palette: neutral page, white repeated rows/items, existing brand primary for actions, secondary text for context, teal accents sparingly, and semantic green/amber/red. Do not make every panel a blue/gray card or add gradients, decorative imagery, large dashboard heroes, or gratuitous animation. This is operational software.

### Non-Negotiable Rules

- No required horizontal scrolling, including tables, action strips, calendar/pipeline views, and narrow modals. Do not hide overflow to conceal inaccessible data.
- Usable at 360 CSS pixels, with graceful reflow at 320 for accessibility testing where practical.
- One obvious primary task action per screen/form. Secondary actions remain available without competing filled buttons.
- Interactive app targets at least 48x48 CSS pixels on touch layouts, with nonoverlapping target bounds. Icons can remain 20-24px inside that area.
- Primary task actions reachable near the bottom; top app bar is for location, back, menu, and global notifications, not the only way to complete the task.
- Default short edit/review actions to bottom sheets. Long multi-part creation uses a page/step editor, not a chain of stacked dialogs.
- No card-inside-card sections. Use full-width/unframed sections and dividers; framed repeated items and genuinely framed tools are exceptions.
- Every actionable record row exposes a consistent trailing overflow action. Do not add a menu to every message bubble or decorative datum merely to satisfy the rule.
- Search before deep navigation where a selection list is long. Preserve chosen context, filters, and scroll when navigating back.
- Every important asynchronous operation answers: saving/processing, completed, failed, or not recorded. A spinner is not the entire error recovery strategy.
- No financial or clock success implied before the server/provider has acknowledged the relevant stage.

Android recommends 48dp targets; this web product adopts a 48 CSS-pixel touch-layout policy. WCAG 2.2 AA's target-size minimum is different, so do not label 48px itself an AA requirement. [Android touch guidance](https://support.google.com/accessibility/android/answer/7101858), [WCAG target-size criterion](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html).

## 2. Layout And Visual Rhythm

| Element | Design rule |
| --- | --- |
| Page gutters | 16px on phones; 24px on tablet/desktop through shared layout tokens. |
| Spacing rhythm | 4/8/12/16/24/32px tokens; 8px maximum normal icon-label gap. |
| Main content | Single column on phones. Forms have a readable desktop max width; job/report workspaces can use larger widths. No arbitrary full-width input stretching. |
| Section hierarchy | Small title plus content, 24px section separation. No duplicate route title below the app bar. |
| List rows | Stable trailing action column; grow vertically when essential text needs wrapping. No fixed row height that clips enlarged text. |
| Item framing | At most 8px radius for repeated records; low/no elevation. Use spacing and outline rather than dark backgrounds to separate rows. |
| Sheets | Existing sheet conventions may use larger top corners. One modal surface; backdrop below sheet and above app shell. |
| Touch inputs | Minimum 48px height, comfortable horizontal padding, 16px entered text on mobile, label separate from placeholder. |
| Totals | Align label and value; use tabular numerals; amounts stay intact or move as a whole to the next line. |
| Status | Compact icon/text chip, not a wide brightly filled banner unless it represents an urgent blocking state. |
| Financial summaries | Limited number of comparable values. Distinguish recorded cost from forecast and collected cash; don't collapse different meanings into "Revenue." |

Use semantic type classes/tokens from [design-system.css](../../../apps/web/src/styles/design-system.css): section title, body, label, helper, metadata, and value. If a role is missing, the shared-design owner adds it once with a rationale and dev-gallery example. Do not sprinkle custom `text-*`, weights, or muted colors across new pages. Zero letter spacing; no viewport-width font scaling.

Keep ordinary body text at the established 16px scale. Critical status/actions must not use tiny helper text. Use concise 14px supporting roles where appropriate; large numerical values belong only in a genuine summary, not every row. Essential information can wrap; long names in dense entry rows ellipsize with a accessible full-name label/detail path.

### Semantic State Examples

| State | Treatment |
| --- | --- |
| Paid / approved / clocked in | Positive icon/text, controlled green emphasis. |
| Due / missing assignment / incomplete costs | Amber icon/text and explicit next action. |
| Failed / rejected / invalid | Error role with concise correction; soft error container for inline form errors. |
| Refunded / credited / voided | Distinct neutral/amber state with explicit amount/history; not interchangeable with unpaid or a generic red error. |
| Processing / awaiting provider | Neutral progress treatment and explanatory label. |
| Draft / not started | Neutral state, not a warning by default. |

Never rely on color alone. Refunds are not automatically "bad"; invalid payment state is. Keep status naming/tone in a central map consumed by all surfaces.

Measure WCAG AA contrast: at least 4.5:1 for ordinary text and 3:1 for qualifying large text; applicable interactive boundaries/state indicators also need non-text contrast checks. Muted helpers and soft error containers must remain readable. Do not assume a named Material color automatically makes every foreground/background pairing compliant. [Text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [Non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html).

## 3. Shared Component Contracts

These are proposed component responsibilities, not existing APIs to invent in parallel. Prefer extending an existing component when it already serves the purpose.

### Actions And Menus

- `Button`: primary, secondary/tonal, text/ghost, subtle destructive, destructive confirmation; stable loading dimensions, accessible busy state, and disabled protection for anchors as well as buttons.
- `IconButton`: one shared square target, tooltip for pointer/focus, accessible name, no oval flex shrinking. Uses current Lucide icon mapping.
- `RecordActions`: trailing overflow, touch sheet on phones, positioned menu on desktop; supports permission/eligibility reasons, keyboard navigation, focus return, destructive items last.
- `ActionDock`: optional bottom action area that coordinates with bottom navigation/keyboard/safe area. Its actual height contributes to content inset. Do not stack independent fixed footers over the same pixels.

Do not use `+` for opening a record. Opening is the record title/link or an explicit `View job`; plus is for creating/adding. Destructive operations require contextual confirmation and, where required by domain policy, a reason.

### Fields And Information

- `FormField`: durable label, required indication, helper slot, one error region with stable ID, `aria-invalid` and nonduplicated `aria-describedby`.
- `InfoPopover`: small 20px info/warning glyph in a real 48px target; tap/click, keyboard activation, Escape/outside dismissal, meaningful name, and a correctly layered popover. Keep label row alignment stable. Tooltip hover alone is insufficient.
- `NumberField`: decimal keyboard where applicable, precise parsing, select-on-focus for time quantity, meaningful limits, no accidental wheel changes. Preserve invalid raw input while showing correction; don't convert blank to zero prematurely.
- `JobPicker`: searchable, address first, job number/project/customer second; recent worked jobs first where the existing API supports it; optional assignment warning only when no job is selected.
- `PhotoPicker`: gallery/file as well as explicit camera capture where available; no forced camera-only shared file input. Per-file progress, preview, cancel/retry and accessible status.

### Modal Sheet Foundation

Improve [Modal](../../../apps/web/src/components/Modal.tsx) before workflow agents multiply ad hoc solutions:

- Render through a shared portal/layer root, outside transformed/clipped route containers.
- `role=dialog`, `aria-modal=true`, visible title association, initial focus, contained tab sequence, focus restoration, background inertness, Escape dismissal where safe.
- Reference-count scroll locking or enforce one active modal; closing a nested child must not unlock a still-open parent.
- Backdrop tap dismisses only when that is safe; dirty forms ask to keep/discard. No accidental deletion of entered work.
- Short sheets fit content; long content scrolls inside the sheet with persistent but nonoccluding actions. On very short screens, use full-height presentation rather than clipping.
- Dynamic viewport/keyboard handling and safe-area padding; input and action remain visible with keyboard open, landscape orientation, and browser chrome changes.

Follow the [WAI-ARIA modal pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Do not apply modal semantics without actually preventing background interaction.

### Async And Financial Display

- `AsyncRegion`: stable skeleton for first load; keep usable existing data during refresh with small local progress/scrim only where needed. Error preserves context and offers retry.
- `ServiceState`: distinguish unreachable critical service from genuinely empty data. Optional weather, analytics, or disconnected accounting cannot blank the whole job workflow.
- `SyncStatus`: explicit saved/local draft/queued/failed/confirmed states, limited to actual supported behavior.
- `FinancialSummary`: consumes the shared financial DTO; it never calculates totals independently.
- `CostCompleteness`: distinguishes unknown/incomplete/reviewed with drilldown. Does not invent a fake percent completeness from an amount ratio.
- `ActivityTimeline`: one sequence per entity with timestamp, amount when relevant, actor/source, and detail links; atomic money/date values don't split arbitrarily. Secondary one-line metadata can ellipsize instead of uncontrolled wrapping.

Success/error toasts use one shared bottom-center treatment positioned above the active navigation/action inset. Deduplicate by logical event, do not replay historical activity as a new toast, and announce status without stealing focus. Persistent failures requiring action remain visible near the affected task instead of disappearing only in a toast.

## 4. Screen Specifications

### 4.1 Production Estimate: Guided Detail Without Clutter

Primary task: prepare an accurate scope and send a clear proposal.

Phone order:

1. Customer/jobsite context and estimate status.
2. Template or optional starter-scope entry; collapse after use or explicit skip. No forced empty room.
3. Compact room/space list. Expand one room to edit substrates; room names belong above substrate rows.
4. Substrate essentials: substrate, measurement, coats, product. Prep/method/adjustments behind a clearly labeled expandable detail section when nondefault details are not needed.
5. Sticky/anchored compact total and `Review proposal`. Save draft is a text/secondary action and only uses valid lifecycle language for the current document state.

`Add room` is at the point where another room appears, not the only action at the very top. Use room length/width/height to derive supported measurements with an explicit apply action; changing a derived measurement never silently overwrites a manual override.

A product may determine its sheen; do not duplicate a contradictory sheen picker. Known colors group correctly for purchase calculations; missing colors do not silently group as identical. Display enough estimate/budget evidence for the estimator to audit without exposing calculations to the homeowner.

Sending journey: review proposal -> preview templated email -> explicit send -> persisted result and usable preview link. No autonomous sending while a user is editing. Keep customer view compact by room/space, substrate, coats, product and overall subtotal/tax/total; measurement details remain internal unless explicitly needed.

Complexity target: moderate detail under disclosure, not a permanently expanded wall of controls. Measure task completion on a representative three-room example; an arbitrary under-60-second complete multi-room bid is not a safety requirement. Repeated simple actions should fit under sixty seconds.

### 4.2 Job List And Detail: Costs With Meaning

List row: meaningful job title/number, street address, customer name link, status/date, compact financial/cost coverage context, trailing overflow. No redundant phone/email/client mailing address taking over this list. Tap title opens job; calendar/date action opens contextual schedule. Preserve list filter/scroll on back.

Detail first screen:

```text
[Back]  Job                           [Global actions]
Exterior repaint   JOB-1042
142 Cedar Street
Customer name                             [more]
In production    Jun 12-16

Contract value     Recorded cost
$8,000             $3,100
Costs incomplete: purchases need review
[Review costs]

Work / Costs / Documents  (reflow, no sideways strip)
Recent costs and exceptions...
```

This is a hierarchy illustration, not literal seeded data or a demand for additional global actions. Financial values come from the shared DTO. Do not display predicted 61% profit from the values above; remaining labor/materials are unknown.

Use anchored sections or limited tabs that fit, not a horizontally scrolling set of many labels. Add time/cost/change-order actions live near their sections or overflow. Keep job-level financial status visually consistent with list and customer detail. Actual-cost type filters appear only with multiple real categories; reflow rather than scrolling chips sideways.

### 4.3 Crew Clock: Almost No Decisions

```text
CLOCKED IN
142 Cedar Street
Started 7:30 AM    Elapsed 3 hr 20 min

[Clock out]
Job actions / correction    (subtle secondary entry)
```

Clocked-out state shows job selection and `Clock in`. Current job is status, not a permanently expanded switch-job editor. Job switch and forgotten-punch flows open compact sheets with reason/time when relevant. Respect existing long-shift confirmation and policy configuration. Present actual override fields above the final submit action, never as always-visible fields in a normal clock-out.

Keep approved positive state and the existing distinguishable clock-out action. Approval action is primary; reject is subtle destructive, not a competing full red button. No instructional paragraphs; compact info popovers explain unusual cases. Active job suppresses missing-job warning.

GPS map, date controls, and subtitle collapse together. Retain preference. A map is supplementary; the accessible list of locations/timestamps remains usable if tiles fail. Do not load thousands of historical punches into the viewport.

### 4.4 Bulk Crew Time: Fast And Accountable

Job-contextual sheet: job/date at top, role filters under disclosure/search, common hours input, selected count and average hours, then editable employee rows.

Each row has name + hours + selection on one row at 360px. Name ellipsizes; hours input is not squeezed or moved to another row. Full-name accessibility is retained. Typed values select on focus and use decimal keyboard. Hidden selections remain selected only by explicit user intent; filter changes never auto-select or clear them silently.

Footer shows `Log time` with selected count/context if needed. Disable duplicate submit; on success close or reset under a clear policy, show confirmation, update affected entries. No confusing `Log + add job` action.

### 4.5 Supplier Invoice Review: Document First

Import entry: `Upload receipt` or `Upload supplier invoice`, file selection/camera/gallery, then `Stage for review`. No raw OCR text/CSV preparation.

Review phone layout:

1. Supplier, invoice number/date, total, processing/duplicate state.
2. Original document thumbnail and full-screen view action; avoid permanently embedding a giant PDF viewport above the task.
3. Job picker with top plausible matches, address/job ID/customer.
4. Compact extraction exceptions and line summary; expanded lines expose pack/gallons/unit price, tax/fees/credits without horizontal tables.
5. Pricing-update choice only when applicable, plus explicit review total/date.
6. Bottom `Approve` enabled only when prerequisites are valid; secondary reject/keep for later.

Duplicates show where the existing approved record lives, when reviewed, and `View record`/`View file`. Reviewed imports leave the needs-review list but remain accessible in history. A stale concurrent review response preserves context and explains who/what already completed it, without a generic "already reviewed" dead end.

### 4.6 Invoices, Payments, Receipts, And Client Portal

Invoice detail first screen: invoice number/title, customer/jobsite context, amount/status, due date, and one eligible next action. Payments, receipt and timeline remain discoverable below. Clicking a payment drills into its detail/receipt and original invoice. Refund movements appear on the same timeline and financial breakdown.

Action menu is contextual: view/share/send reminder/record payment where eligible; cancel/void/refund last. Do not invite a payment on a refunded/closed obligation. Manual payment sheet makes received amount/date/method/reference explicit, with send-receipt toggle. Manual refund uses `Record refund` and clearly says the entry does not move money.

Client portal is a separate branded surface, without internal drawer/bottom navigation. Company logo, client/job identity, documents, scheduled dates and outstanding eligible invoices are clear. Signing and payment are successive but distinct; the contractor's configured schedule is visible. If Stripe is unavailable, use the shared concise error/toast and alternative contact/manual instructions where appropriate, not a permanent top warning repeated across every document.

Checkout handoff sets temporary attempt state. Returning through browser back/pageshow refreshes authoritative balances and removes a stale spinner; only a confirmed provider state indicates paid/processing. Public tokens and URLs are not leaked into analytics or unrelated links.

### 4.7 Dashboard, Reports, And Setup

Dashboard: compact mobile summary, then a short actionable exception list. Show stale communication, missing review, overdue balance, or schedule discrepancy only when actionable and authorized. One recommendation action with context prefilled; optional dismiss/snooze/reason. No repeated quick-entry panels.

Reports: financial concepts labeled honestly; mobile record/list breakdowns instead of desktop tables. Recorded actual costs are not complete final costs by default. Show as-of/source/coverage where it changes interpretation. Filter/date changes retain previous data with local updating state, not a full-screen layout reset.

Setup: single vertical flow with completion markers near the selected/completed item, readable desktop width, and resumable navigation. Setup checklist is above the workflow where that context is useful. Fixed/sticky actions do not cover the current step. Rate/tax/deposit helpers open usable info popovers; payment schedule and Connect readiness are distinct from subscription billing.

## 5. Performance, Connectivity, And Recovery

- Skeleton geometry matches settled layout; no placeholder zero balances or flashing empty forms before data arrives.
- Preserve prior data during refresh, but show stale/as-of state when relevant. Disable only actions that rely on invalidated state.
- Retry a scoped request without losing form data, chosen record, filter, date, or scroll. Avoid whole-page reload after moving a job or saving time.
- Photos are compressed/resized only under explicit file/quality rules, with original/file metadata requirements retained. Show meaningful progress for long upload/OCR work.
- Offline banner is compact and contextual. Draft saved locally is different from server saved; queued upload differs from completed upload.
- Logout/account switching clears scoped local data; expiry and quota/eviction failure are visible. Never claim guaranteed persistence from local browser storage.
- Respect `prefers-reduced-motion`. Short sheet/state transitions may use 150-250ms motion, but no motion is required to understand state.

## 6. Acceptance Matrix

| Test | Required evidence |
| --- | --- |
| Phone widths | Screenshots and overflow checks at 360, 390, and 430px; long names/addresses and large monetary amounts. |
| Tablet/desktop | 768, 1280, and 1440px; responsive density, no missing navigation, no clipped record actions. |
| Text sizing | 200% zoom/text growth, relevant WCAG reflow at 320px, essential information/action accessible. [Reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html). |
| Touch targets | Bounding-box checks for touched controls: at least 48x48 in touch layouts, no intersecting adjacent hit areas. |
| Scroll/occlusion | Scroll to last row/field with nav and action dock visible; assert content/action not hidden. Don't pass by setting page overflow hidden. |
| Keyboard/sheets | On-screen keyboard open, landscape/short-height viewport, safe area; focused field and submit reachable; background cannot scroll. |
| Accessibility | Correct names/labels/error association, visible focus, Escape, focus containment/restore, contrast, screen-reader status announcements. |
| Failure states | Slow API, critical outage, optional-service failure, expired session/token, 409 stale version, 429 usage limit, failed upload, provider unknown outcome. |
| Browser history | List -> detail -> back preserves state; Stripe -> back clears stale busy UI; modal close does not unexpectedly leave route. |
| Native devices | Staging pass on real iOS Safari/iPad and Android Chrome. Emulation alone does not prove native gallery, keyboard, GPS, BFCache, or permission behavior. |
| Task usability | Record taps/time/errors for normal clock, bulk time, receipt stage/review, payment record, three-room estimate. Reconsider repeated simple tasks over sixty seconds; don't remove critical confirmations to chase speed. |

Before/after screenshots must use identical fixtures and viewports. QA and the design owner inspect them, not just approve a successful screenshot command. Attach a short screen recording for keyboard, sheet, or multi-stage flows where a still image cannot prove behavior.

Release-blocking design defects: horizontal overflow, hidden action, conflicting primary actions, misleading financial state, duplicate errors, inaccessible sheets, lost draft, and a successful-looking action that did not persist. Cosmetic refinements can follow, but these cannot.
