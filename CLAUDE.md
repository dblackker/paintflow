# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Crewmodo is a CRM built for small trade contractors, starting with deep support for painting contractors. It is a multi-tenant SaaS application for the full workflow: lead capture → pipeline → estimates/proposals → scheduling → production → change orders → invoices/payments → follow-up.

**Key Differentiator:** Unlike generic CRMs (Jobber, Housecall Pro), Crewmodo is purpose-built for painters with production rates, job costing, and painting-specific workflows.

## Tech Stack

- **Frontend:** React 18 + Vite + React Router + TypeScript + Tailwind CSS + custom design-system CSS
- **Backend:** Hono on Cloudflare Workers
- **Database:** Drizzle ORM + PostgreSQL (Neon)
- **Auth:** Passwordless magic links, session token bridge for local/dev, RBAC middleware
- **Payments:** Stripe subscriptions, Stripe Connect, Checkout, refunds, and webhooks
- **Email:** Resend transactional email with editable templates
- **Storage:** Cloudflare R2 for uploads/files and Cloudflare KV for lightweight edge state
- **AI/OCR:** OpenAI OCR for supplier invoice import/review workflows
- **Monorepo:** pnpm workspaces

## Development Commands

### Setup
```bash
corepack pnpm install
corepack pnpm db:push          # Apply schema to database
corepack pnpm db:seed:golden   # Seed demo data
```

### Development
```bash
# Terminal 1: API
cd apps/api
corepack pnpm dev    # Runs on http://localhost:8787

# Terminal 2: Web
cd apps/web
corepack pnpm dev    # Runs on http://localhost:5173
```

### Database
```bash
corepack pnpm --filter @crewmodo/db db:generate  # Generate migration from schema changes
corepack pnpm db:push                            # Push schema to database
corepack pnpm db:studio                          # Open Drizzle Studio GUI
```

### Testing
```bash
corepack pnpm test:e2e          # Playwright E2E tests
corepack pnpm test:e2e:signup   # Signup E2E tests
```

### Type Checking
```bash
corepack pnpm --filter @crewmodo/web type-check
corepack pnpm --filter @crewmodo/api build
```

## Architecture Decisions

### Magic Links Over Passwords

**Why:** Painting contractors work from mobile devices on job sites. Password managers are uncommon in this demographic. Magic links reduce support burden and are more secure.

**Implementation:** 
- `POST /v1/auth/magic-link` generates UUID token
- Stored in Cloudflare KV with 15-min TTL
- Email sent via Resend
- `GET /v1/auth/verify?token=xxx` validates and creates session
- Session stored in KV with 7-day TTL, HttpOnly cookie

**Trade-off:** Email deliverability dependency

### Multi-Tenancy Strategy

**Row-level security via `org_id` column**

Every table has `org_id` foreign key. Middleware extracts `orgId` from session and injects into request context. All queries filter by `orgId`.

**Why:** Simple, auditable, works with all ORMs

**Trade-off:** Must remember to filter everywhere; harder to shard

### Edge Runtime (Cloudflare Workers)

**Why:** 
- Global low-latency for field workers
- Auto-scaling, no server management
- Cost-effective
- Integrates with R2, KV

**Limitations:**
- 10ms CPU limit
- 128MB memory
- No Node.js APIs (Web Standards only)

### Drizzle ORM

**Why over Prisma:**
- Smaller bundle size (critical for Workers)
- SQL-like, less abstraction
- Better TypeScript inference
- Faster queries

### Estimate, Invoice, and Change Order Workflows

Crewmodo keeps legal agreement and payment collection linked but distinct. Signed proposals can trigger deposit invoices; change orders can require customer approval and payment schedule handling; quick invoices exist for contractors who need to bill without a full estimate flow.

## Project Structure

```
crewmodo/
├── apps/
│   ├── api/              # Hono API
│   │   ├── src/
│   │   │   ├── routes/   # Route handlers
│   │   │   ├── middleware/ # Auth, tenant
│   │   │   └── index.ts  # App entry
│   │   └── wrangler.toml # Cloudflare config
│   └── web/              # Vite React PWA
│       └── src/
│           ├── pages/    # React route screens
│           └── components/
├── packages/
│   ├── core/             # Runtime-agnostic business logic
│   └── db/               # Drizzle schema
│       └── src/
│           └── schema.ts # All tables
├── scrapers/             # Supplier catalog ingestion tooling
└── package.json
```

## Database Schema

Key tables (see `packages/db/src/schema.ts`):

- `organizations` – Tenant root
- `users` – No passwords, email only
- `memberships` – User-org junction with role
- `leads` – Lead management
- `estimates` – Proposals, scopes, signatures, payment schedules
- `jobs` – Job tracking with costing
- `change_orders` – Post-signature modifications
- `job_photos` – Before/progress/after
- `message_templates` – Email/SMS templates
- `subscriptions` – SaaS billing

## API Conventions

### Authentication

All routes except `/auth/*` require session cookie:
```
Cookie: session=abc123...
```

### RESTful Patterns

```
GET    /v1/leads          # List (filter by orgId)
GET    /v1/leads/:id      # Get one
POST   /v1/leads          # Create
PATCH  /v1/leads/:id      # Update
DELETE /v1/leads/:id      # Delete
```

### Error Responses

```ts
return c.json({ 
  error: 'Validation failed',
  details: { field: 'email', message: 'Invalid format' }
}, 400);
```

Status codes: 200, 201, 400, 401, 403, 404, 429, 500

## Code Style

- TypeScript strict mode
- ESLint + Prettier
- Conventional commits (`feat:`, `fix:`, `chore:`)
- Feature flags for risky changes

## Common Tasks

### Add a new API route

1. Create `apps/api/src/routes/my-feature.ts`:
```ts
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/tenant';

const route = new Hono();
route.use('*', authMiddleware);

route.get('/', async (c) => {
  const orgId = c.get('orgId');
  // ... handler
});

export default route;
```

2. Register in `apps/api/src/index.ts`:
```ts
import myFeatureRoute from './routes/my-feature';
app.route('/v1/my-feature', myFeatureRoute);
```

### Add a database table

1. Edit `packages/db/src/schema.ts`:
```ts
export const myTable = pgTable('my_table', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  // ... columns
});
```

2. Generate and push:
```bash
corepack pnpm --filter @crewmodo/db db:generate
corepack pnpm db:push
```

### Add a new page

Create a React screen under `apps/web/src/pages/` and register it in `apps/web/src/router.tsx`:
```tsx
export function MyPage() {
  return (
    <section className="space-y-4">
      <h1 className="pf-page-title">My page</h1>
    </section>
  );
}
```

## Environment Variables

Required:
- `DATABASE_URL` – Neon Postgres connection string
- `CLOUDFLARE_API_TOKEN` – For deployments
- `STRIPE_SECRET_KEY` – Stripe payments
- `APP_URL` – API base URL for the current Worker environment
- `PUBLIC_URL` – Web app base URL for customer-facing links
- `ENVIRONMENT` – `development`, `staging`, or `production`

Optional:
- `RESEND_API_KEY` – transactional email
- `GOOGLE_CLIENT_ID` – Google Calendar sync
- `VITE_GOOGLE_MAPS_API_KEY` – browser key for Google Places address autocomplete
- `TWILIO_ACCOUNT_SID` – SMS
- `QUICKBOOKS_CLIENT_ID` – Accounting sync

## Deployment

### Branches

- `main` → dev deploy (`crewmodo-dev.pages.dev`)
- `staging` → staging deploy (`staging.crewmodo.com`)
- `production` → production deploy (`crewmodo.com` / `app.crewmodo.com`)

### Deploy

```bash
# Dev
git push origin main

# Staging
git push origin staging

# Production
git push origin production
```

### DNS for Resend

Transactional email sends from `no-reply@mail.crewmodo.com`. Keep Resend DNS verification records on the `mail.crewmodo.com` sender subdomain so platform email reputation is isolated from the apex domain.

## Testing Strategy

### Unit Tests
- Pure functions
- Database queries
- Business logic

### Integration Tests
- API endpoints
- Database transactions
- External service mocks

### E2E Tests
- Critical user flows:
  - Signup → onboarding → create estimate
  - Magic link auth
  - Payment flow

## Performance Targets

- API p95 latency: <200ms
- Page load: <1s
- Bundle size: <100kb JS
- Lighthouse score: >90

## Security Considerations

- All data filtered by `orgId` (no cross-tenant leaks)
- Input validation via Zod
- SQL injection prevented by Drizzle
- XSS risk reduced by React escaping and avoiding raw HTML unless explicitly sanitized
- Rate limiting on auth endpoints
- Secrets in Cloudflare Workers secrets (never in code)

## Common Pitfalls

1. **Forgetting `orgId` filter** – Always filter queries by `orgId`
2. **N+1 queries** – Use Drizzle `with` for relations
3. **Blocking the event loop** – Workers have 10ms CPU limit
4. **Large responses** – Stream or paginate
5. **Missing indexes** – Check query performance in Neon dashboard

## Getting Help

- Architecture: See `docs/ARCHITECTURE.md`
- API docs: `docs/api.yaml`
- Monitoring: `docs/monitoring.md`
- Issues: GitHub Issues

## Key Files to Know

- `packages/db/src/schema.ts` – All database tables
- `apps/api/src/middleware/tenant.ts` – Multi-tenancy logic
- `apps/api/src/routes/auth.ts` – Magic link auth
- `apps/web/src/router.tsx` – React route registration
- `apps/web/src/pages/Dashboard.tsx` – Main dashboard
- `apps/api/wrangler.toml` – Cloudflare Workers config
