# PaintFlow

Multi-tenant SaaS for solopreneur painting contractors. Cloudflare-first, PWA, edge-native.

**Repo:** https://github.com/dblackker/paintflow

## Stack

- **Frontend:** Astro 5 PWA
- **API:** Cloudflare Workers + Hono
- **DB:** Neon Postgres + Drizzle ORM
- **Auth:** Magic links + Workers KV sessions
- **Multi-tenancy:** RLS with `org_id`

## Quick Start

```bash
pnpm install
pnpm dev
```

## What's Built

### ✅ Auth & Multi-tenancy
- Magic link flow with KV sessions
- Automatic user/org creation on first login
- RLS policies for data isolation
- HttpOnly secure cookies

### ✅ Leads Pipeline
- `GET/POST /v1/leads` API with auth
- Pipeline UI with add modal
- Tenant-isolated queries

### ✅ Estimates
- Good/Better/Best builder UI with live totals
- API for CRUD estimates with packages
- Lead selector with auto-load
- Form validation and error handling
- PDF generation via Cloudflare Browser Rendering
- Send endpoint triggers drip enrollment

### ✅ Drip Automation
- Cloudflare Cron scheduled handler
- Day 1/3/7 follow-up logic
- KV-based deduplication

### ✅ Stripe Billing
- Checkout session creation for estimates
- Webhook handler for payment success
- Updates estimate status to 'accepted'

### ✅ Job Costing
- Schema: jobs, time_entries, expenses
- API with margin calculations
- Dashboard UI with budget vs actual
- Color-coded margin indicators (>30% green, >15% yellow, <15% red)

### ✅ 2-Way SMS
- Twilio webhook for inbound messages
- Messages table with lead association
- Send API endpoint
- Inbox UI with conversation list

## Environment Variables

```
DATABASE_URL=
KV_NAMESPACE_ID=
RESEND_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
CF_ACCOUNT_ID=
CF_API_TOKEN=
APP_URL=http://localhost:4321
```

## Project Structure

```
paintflow/
├── apps/web/          # Astro PWA
│   ├── src/pages/login.astro
│   ├── src/pages/dashboard.astro
│   ├── src/pages/leads.astro
│   ├── src/pages/estimates/new.astro
│   ├── src/pages/jobs/index.astro
│   └── src/pages/sms/index.astro
├── apps/api/          # Workers API
│   ├── src/routes/auth.ts
│   ├── src/routes/leads.ts
│   ├── src/routes/estimates.ts
│   ├── src/routes/billing.ts
│   ├── src/routes/jobs.ts
│   ├── src/routes/sms.ts
│   ├── src/routes/pdf.ts
│   └── src/cron/drips.ts
├── packages/db/       # Drizzle schema
└── packages/core/     # Business logic
```

## API Endpoints

- `POST /v1/auth/magic-link` - Send magic link
- `GET /v1/auth/verify?token=...` - Verify token
- `GET/POST /v1/leads` - Leads CRUD
- `GET/POST /v1/estimates` - Estimates CRUD
- `POST /v1/estimates/:id/send` - Send estimate
- `POST /v1/billing/checkout` - Create Stripe session
- `POST /v1/billing/webhook` - Stripe webhook
- `GET/POST /v1/jobs` - Jobs CRUD
- `GET /v1/jobs/:id/costs` - Cost breakdown
- `POST /v1/sms/inbound` - Twilio webhook
- `POST /v1/sms/send` - Send SMS
- `POST /v1/pdf/estimate/:id` - Generate PDF

## Next Steps

- Google Calendar sync
- Production rates database
- Public estimate accept page
- Email sending via Resend
- File uploads to R2

## License

Proprietary
