# AGENTS.md - Crewmodo

Multi-tenant SaaS for small trade contractors, initially optimized for painting contractors.

## Stack
- Frontend: React 18 + Vite + React Router, Tailwind, custom design-system CSS, PWA
- API: Cloudflare Workers + Hono
- DB: Neon Postgres + Drizzle ORM / Drizzle Kit
- Auth: passwordless magic links with role-based access control
- Storage: Cloudflare R2 for files/uploads, Cloudflare KV for lightweight edge state
- Payments: Stripe subscriptions, Stripe Connect, Checkout, and webhooks
- Email: Resend transactional email with editable templates
- Integrations: Google Places/Calendar, Twilio-style SMS, QuickBooks planning, OpenAI OCR

## Getting Started
```bash
corepack pnpm install
corepack pnpm dev
```

## Structure
- `apps/web` - Vite React PWA
- `apps/api` - Workers API
- `packages/db` - Drizzle schema + migrations
- `packages/core` - Business logic (runtime-agnostic)
- `scrapers/paint-suppliers` - Supplier catalog ingestion tooling

## Multi-tenancy
All tables have `org_id`. RLS enforced. Middleware sets `app.current_org_id`.

## Development Rules
- Never commit secrets
- All POST endpoints need Idempotency-Key
- Add PostHog event for user-facing actions
- Write tenant isolation tests for new tables
- Follow `docs/action-copy-guidelines.md` for button, link, and menu copy.

## Deployment
- Dev: `main` → Cloudflare Pages `crewmodo-dev` + Worker `dev`
- Staging: `staging` → Cloudflare Pages `crewmodo-staging` + Worker `staging`
- Production: `production` → Cloudflare Pages `crewmodo-web` + Worker `production`

See `CLAUDE.md` for architecture details.
