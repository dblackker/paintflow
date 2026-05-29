# Crewmodo Launch Pricing Strategy

## Positioning

Crewmodo should launch as an operations platform for contractors, not a cheap estimator or basic CRM. The product already combines lead management, estimating, proposals, payment workflow, scheduling, time tracking, job costing, supplier invoice OCR, messaging, notifications, and reporting. That supports a price point above lightweight CRM tools while staying well below enterprise field-service platforms.

The recommended launch posture is:

- Keep the public pricing simple.
- Make the middle plan the obvious default.
- Include enough field-only crew seats that time tracking adoption is not punished.
- Use usage limits for expensive infrastructure features like SMS, OCR, AI, and storage.
- Preserve founder pricing through Stripe Price IDs rather than custom code.

## Recommended Public Pricing

| Plan | Launch price | Target customer | Included users |
| --- | ---: | --- | --- |
| Starter | $79/month | Owner-operator or very small crew moving out of spreadsheets | 1 admin + 3 field-only crew |
| Growth | $199/month | Small and mid-sized contractors running sales, estimating, scheduling, time, and job cost together | 3 admins + 10 field-only crew |
| Pro | $399/month | Multi-crew operators needing reporting, automation, OCR, permissions, and higher usage limits | 8 admins + 25 field-only crew |

Early customers can be manually grandfathered into founder pricing:

| Plan | Founder price |
| --- | ---: |
| Starter | $49/month |
| Growth | $149/month |
| Pro | $299/month |

Founder pricing should be framed as an early-adopter benefit, not the default value of the product.

## Tier Gating

Starter should prove the core workflow:

- Lead pipeline
- Quick estimates
- Public proposal links
- E-sign
- Basic jobs and scheduling
- Manual payment tracking
- Basic reporting

Growth should be the main plan:

- Everything in Starter
- Production estimator
- Payment schedules
- Change orders
- Crew time tracking with GPS
- Time approvals
- Job costing
- Customer messaging
- Notifications
- Email templates
- Supplier catalog

Pro should unlock operating leverage:

- Everything in Growth
- Supplier invoice OCR/import
- Advanced reporting
- Recommended actions and automations
- Advanced roles and permissions
- Multi-crew scheduling
- API/integration access
- Priority support
- Higher SMS/OCR/AI/storage limits

## Seat Model

Use two seat types.

Admin users are owners, office staff, estimators, managers, and crew leads who need broad access. These should be limited by plan because they create support and product complexity.

Field-only crew are painters, prep workers, and helpers who mostly clock in/out, view assigned jobs, and upload photos. These should be included generously because charging too much for field-only access will reduce time tracking adoption.

Suggested overages:

- Additional admin user: $25-$40/month
- Additional field-only user: $5-$10/month

Do not block core punch-in/out too aggressively. Time tracking data is valuable to job costing, payroll review, and customer profitability.

## Stripe Future-Proofing

Do not edit old Stripe Prices when pricing changes. Create new Prices and point new signups at the new Price IDs.

Example:

- `Growth Founder 2026` at $149/month
- `Growth Launch 2026` at $199/month
- `Growth Standard 2027` at $249/month

Existing customers stay on their original Stripe subscription item price. New customers get whatever Price ID is configured in the app environment.

Use Stripe metadata to make pricing policy clear:

```text
pricing_policy=founder
price_version=2026_founder
grandfathered=true
```

The app should treat plan as the feature package and Stripe Price ID as the commercial term. That keeps feature access and billing strategy from becoming tangled.

## Current Implementation Note

The code keeps the existing internal plan keys for compatibility:

- `starter` displays as Starter
- `pro` displays as Growth
- `enterprise` displays as Pro

This avoids immediate environment variable churn because the current app already expects:

- `STRIPE_STARTER_PRICE_ID`
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_ENTERPRISE_PRICE_ID`

If Crewmodo later adds a true enterprise/contact-sales tier, introduce a new internal key and migration deliberately rather than renaming the existing production billing keys in place.
