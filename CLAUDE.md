# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PaintFlow is a CRM built specifically for painting contractors. It's a multi-tenant SaaS application with a focus on the painting industry workflow: leads → estimates (Good/Better/Best) → jobs → payments.

**Key Differentiator:** Unlike generic CRMs (Jobber, Housecall Pro), PaintFlow is purpose-built for painters with production rates, job costing, and painting-specific workflows.

## Tech Stack

- **Frontend:** Astro + TypeScript + Tailwind CSS
- **Backend:** Hono on Cloudflare Workers
- **Database:** Drizzle ORM + PostgreSQL (Neon)
- **Auth:** Magic links via MailChannels (no passwords)
- **Payments:** Stripe
- **Monorepo:** npm workspaces

## Development Commands

### Setup
```bash
npm install
npm run db:push      # Apply schema to database
npm run db:seed      # Seed test data
```

### Development
```bash
# Terminal 1: API
cd apps/api
npm run dev          # Runs on http://localhost:8787

# Terminal 2: Web
cd apps/web
npm run dev          # Runs on http://localhost:4321
```

### Database
```bash
npm run db:generate  # Generate migration from schema changes
npm run db:push      # Push schema to database
npm run db:studio    # Open Drizzle Studio GUI
```

### Testing
```bash
npm test             # Unit tests
npm run test:e2e     # Playwright E2E tests
npm run test:api     # API integration tests
```

### Type Checking
```bash
npm run typecheck    # TypeScript check
```

## Architecture Decisions

### Magic Links Over Passwords

**Why:** Painting contractors work from mobile devices on job sites. Password managers are uncommon in this demographic. Magic links reduce support burden and are more secure.

**Implementation:** 
- `POST /v1/auth/magic-link` generates UUID token
- Stored in Cloudflare KV with 15-min TTL
- Email sent via MailChannels
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

### Good/Better/Best Estimates

**Why:** Industry standard for painting. Increases average job value 20-30%. Built into core product as differentiator.

## Project Structure

```
paintflow/
├── apps/
│   ├── api/              # Hono API
│   │   ├── src/
│   │   │   ├── routes/   # Route handlers
│   │   │   ├── middleware/ # Auth, tenant
│   │   │   └── index.ts  # App entry
│   │   └── wrangler.toml # Cloudflare config
│   └── web/              # Astro frontend
│       └── src/
│           ├── pages/    # File-based routing
│           └── components/
├── packages/
│   └── db/               # Drizzle schema
│       └── src/
│           └── schema.ts # All tables
└── package.json
```

## Database Schema

Key tables (see `packages/db/src/schema.ts`):

- `organizations` – Tenant root
- `users` – No passwords, email only
- `memberships` – User-org junction with role
- `leads` – Lead management
- `estimates` – Good/Better/Best pricing
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
npm run db:generate
npm run db:push
```

### Add a new page

Create `apps/web/src/pages/my-page.astro`:
```astro
---
import Layout from '../components/Layout.astro';
---

<Layout title="My Page">
  <h1>Content</h1>
</Layout>
```

## Environment Variables

Required:
- `DATABASE_URL` – Neon Postgres connection string
- `CLOUDFLARE_API_TOKEN` – For deployments
- `STRIPE_SECRET_KEY` – Stripe payments
- `APP_URL` – Base URL (e.g., https://app.paintflow.app)
- `ENVIRONMENT` – `development`, `staging`, or `production`

Optional:
- `GOOGLE_CLIENT_ID` – Google Calendar sync
- `TWILIO_ACCOUNT_SID` – SMS
- `QUICKBOOKS_CLIENT_ID` – Accounting sync

## Deployment

### Branches

- `develop` → Auto-deploys to `staging.paintflow.app`
- `main` → Manual approval → `app.paintflow.app`

### Deploy

```bash
# Staging
git push origin develop

# Production
git checkout main
git merge develop
git push origin main
```

### DNS for MailChannels

Add to `paintflow.app` DNS:
```
_mailchannels.paintflow.app TXT "v=mc1 cfid=paintflow.workers.dev"
```

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
- XSS prevented by Astro auto-escaping
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
- `apps/web/src/pages/dashboard.astro` – Main dashboard
- `wrangler.toml` – Cloudflare Workers config
