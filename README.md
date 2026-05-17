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

## Environment Variables

```
DATABASE_URL=
KV_NAMESPACE_ID=
RESEND_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
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
│   └── src/pages/jobs/index.astro
├── apps/api/          # Workers API
│   ├── src/routes/auth.ts
│   ├── src/routes/leads.ts
│   ├── src/routes/estimates.ts
│   ├── src/routes/billing.ts
│   ├── src/routes/jobs.ts
│   └── src/cron/drips.ts
├── packages/db/       # Drizzle schema
└── packages/core/     # Business logic
```

## Next Steps

- PDF generation via Cloudflare Browser Rendering
- Twilio 2-way SMS inbox
- Google Calendar sync
- Production rates database
- Public estimate accept page

## License

Proprietary
