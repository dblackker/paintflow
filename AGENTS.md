# AGENTS.md - PaintFlow

Multi-tenant SaaS for solopreneur painting contractors.

## Stack
- Frontend: Astro 5 + React, Tailwind, shadcn, PWA
- API: Cloudflare Workers + Hono
- DB: Neon Postgres + Drizzle ORM
- Auth: Better Auth
- Storage: Cloudflare R2
- Payments: Stripe

## Getting Started
```bash
pnpm install
pnpm dev
```

## Structure
- `apps/web` - Astro PWA
- `apps/api` - Workers API
- `packages/db` - Drizzle schema + migrations
- `packages/ui` - Shared components
- `packages/core` - Business logic (runtime-agnostic)

## Multi-tenancy
All tables have `org_id`. RLS enforced. Middleware sets `app.current_org_id`.

## Development Rules
- Never commit secrets
- All POST endpoints need Idempotency-Key
- Add PostHog event for user-facing actions
- Write tenant isolation tests for new tables
- Follow `docs/action-copy-guidelines.md` for button, link, and menu copy.

## Deployment
- Preview: PR → Cloudflare Pages + Neon branch
- Prod: merge to main → auto deploy

See `CLAUDE.md` for architecture details.
