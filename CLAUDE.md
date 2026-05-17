# CLAUDE.md - PaintFlow Architecture

## Vision
One app for painting contractors: leads → estimates → jobs → invoices → profit tracking.

## Key Decisions
- Cloudflare-first edge architecture
- Drizzle ORM (Workers-compatible)
- RLS for multi-tenancy
- PWA first, native later
- Follow-up drips are P0

## Data Flow
User → Cloudflare CDN → Pages (Astro) → Workers API → Neon (via Hyperdrive) → R2/Stripe/Twilio

## Multi-Tenancy
- `org_id` on all tables
- RLS policy: `org_id = current_setting('app.current_org_id')`
- Middleware extracts org from session on every request

## Core Domain
- Lead → Estimate → Job → Invoice
- Job Costing: budget vs actual → margin %
- Drips: Cron → Queue → Twilio/Resend

## Adding New Feature
1. Add Drizzle schema in `packages/db`
2. Generate migration
3. Add API route in `apps/api` with Zod validation
4. Add RLS policy
5. Add PostHog event
6. Write tenant isolation test

## Testing
- Unit tests with Vitest
- E2E with Playwright against preview env
- Tenant isolation tests must pass in CI

See `docs/adr/` for architectural decisions.
