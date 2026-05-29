# Crewmodo Architecture

## Overview

Crewmodo is a multi-tenant SaaS CRM built for trade contractors, initially optimized for painting contractors, deployed on Cloudflare Workers edge runtime.

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Client Layer                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │  Web App │  │ Mobile   │  │ API      │                  │
│  │ (Astro)  │  │ (PWA)    │  │ Clients  │                  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                  │
└───────┼─────────────┼─────────────┼────────────────────────┘
        │             │             │
        └─────────────┴─────────────┘
                      │
        ┌─────────────▼─────────────┐
        │   Cloudflare Workers      │
        │   (Hono API)              │
        │   - Auth middleware       │
        │   - Tenant isolation      │
        │   - Rate limiting         │
        └─────────────┬─────────────┘
                      │
        ┌─────────────┼─────────────┐
        │             │             │
┌───────▼──────┐ ┌───▼────┐ ┌─────▼──────┐
│ Neon Postgres│ │ KV     │ │ R2         │
│ (Primary DB) │ │ (Cache)│ │ (Files)    │
└──────────────┘ └────────┘ └────────────┘
        │
        │ (webhooks, sync)
        │
┌───────▼──────────────┐
│ External Services    │
├──────────────────────┤
│ Stripe (payments)    │
│ QuickBooks (accounting)│
│ Google Calendar      │
│ Twilio (SMS)         │
│ MailChannels (email) │
│ Documenso (e-sign)   │
└──────────────────────┘
```

## Data Flow

### Authentication Flow

```
1. User enters email on /login
2. POST /v1/auth/magic-link
   - Generate token (UUID)
   - Store in KV: magic:{token} → {userId, orgId} (TTL: 15 min)
   - Send email via MailChannels
3. User clicks link: GET /v1/auth/verify?token=xxx
   - Validate token exists in KV
   - Delete token (one-time use)
   - Create session: session:{token} → {userId, orgId} (TTL: 7 days)
   - Set HttpOnly cookie
   - Redirect to /dashboard
```

### Multi-Tenancy

**Strategy:** Row-level security via `orgId` column

Every table has `org_id` foreign key:
```sql
SELECT * FROM estimates WHERE org_id = $1
```

Middleware extracts `orgId` from session and injects into request context:
```ts
app.use('*', async (c, next) => {
  const session = await getSession(c);
  c.set('orgId', session.orgId);
  await next();
});
```

**Benefits:**
- Simple queries
- Easy to audit
- Works with all ORMs

**Trade-offs:**
- Must remember to filter by `orgId` everywhere
- Harder to scale to thousands of orgs (sharding)

### Request Lifecycle

```
1. Cloudflare Edge receives request
2. WAF checks (rate limit, bot protection)
3. Worker executes:
   - Parse request
   - Auth middleware (validate session cookie)
   - Tenant middleware (set orgId)
   - Route handler
   - DB query (Neon via connection pooling)
   - Response
4. Cached at edge if cacheable
```

Average latency: 50-150ms globally

## Database Design

### Core Tables

**organizations**
- Tenant root
- `id`, `name`, `slug`, `created_at`

**users**
- `id`, `email`, `name`, `created_at`
- No passwords (magic links only)

**memberships**
- Junction table: `user_id`, `org_id`, `role`
- Roles: `owner`, `admin`, `member`

**leads**
- `org_id`, `name`, `email`, `phone`, `source_id`, `status`
- Status: `new`, `contacted`, `qualified`, `converted`, `lost`

**estimates**
- `org_id`, `lead_id`, `total`, `status`, `good/better/best` JSON
- Status: `draft`, `sent`, `viewed`, `accepted`, `declined`

**jobs**
- `org_id`, `estimate_id`, `name`, `status`, `budget`, `actual_cost`
- Status: `scheduled`, `in_progress`, `completed`, `invoiced`

**change_orders**
- `org_id`, `job_id`, `description`, `amount`, `status`
- Status: `pending`, `approved`, `rejected`

### Indexes

```sql
-- Common query patterns
CREATE INDEX idx_leads_org_status ON leads(org_id, status);
CREATE INDEX idx_estimates_org_status ON estimates(org_id, status);
CREATE INDEX idx_jobs_org_status ON jobs(org_id, status);
CREATE INDEX idx_estimates_lead ON estimates(lead_id);
```

### Migrations

Using Drizzle migrations:
```bash
npm run db:generate  # Create migration file
npm run db:push      # Apply to database
```

Backwards-compatible only for production:
- Add columns (nullable or with default)
- Create tables
- Add indexes concurrently

Never:
- Drop columns
- Rename columns
- Change column types (create new + migrate)

## API Design

### RESTful Conventions

```
GET    /v1/leads          # List
GET    /v1/leads/:id      # Get one
POST   /v1/leads          # Create
PATCH  /v1/leads/:id      # Update
DELETE /v1/leads/:id      # Delete
```

### Authentication

All routes except `/auth/*` require session cookie:
```
Cookie: session=abc123...
```

Middleware validates and sets `c.get('orgId')`.

### Error Handling

```ts
return c.json({ 
  error: 'Validation failed',
  details: { field: 'email', message: 'Invalid format' }
}, 400);
```

Status codes:
- `200` – Success
- `201` – Created
- `400` – Bad request
- `401` – Unauthorized
- `403` – Forbidden
- `404` – Not found
- `429` – Rate limited
- `500` – Server error

### Rate Limiting

Per-org limits:
- 1000 req/min for API
- 10 req/min for `/auth/magic-link` (prevent abuse)

Implemented via Cloudflare Rate Limiting rules.

## Frontend Architecture

### Astro Islands

Static HTML with hydrated islands:
```astro
---
import Layout from '../components/Layout.astro';
---

<Layout>
  <div id="app" data-props={JSON.stringify(props)}></div>
</Layout>

<script>
  // Hydrate React/Vue component
  import App from './App.tsx';
  hydrate(App, document.getElementById('app'));
</script>
```

**Benefits:**
- Fast initial load (static HTML)
- Interactive where needed
- SEO-friendly

### State Management

- Server state: Fetched on navigation
- Client state: Vanilla JS or small framework
- No Redux/MobX (overkill)

### Styling

Tailwind CSS utility classes:
```html
<button class="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
  Save
</button>
```

## Security

### Authentication

- Magic links (no passwords)
- Session tokens stored in HttpOnly cookies
- 7-day session TTL
- CSRF protection via SameSite=Lax

### Authorization

Role-based access control:
- `owner` – Full access
- `admin` – Can manage team, settings
- `member` – Can create estimates, jobs

Check in route handlers:
```ts
if (user.role !== 'owner' && user.role !== 'admin') {
  return c.json({ error: 'Forbidden' }, 403);
}
```

### Data Protection

- All data filtered by `orgId`
- No cross-tenant data leaks
- Input validation via Zod
- SQL injection prevented by Drizzle parameterized queries
- XSS prevented by Astro auto-escaping

### Secrets

Stored in Cloudflare Workers secrets:
```bash
wrangler secret put STRIPE_SECRET_KEY
```

Never in code or `.env` files.

## Performance

### Caching Strategy

**Edge Cache:**
- Static assets: 1 year (immutable)
- API responses: 0 (always fresh for now)

**Database:**
- Connection pooling via Neon
- Prepared statements
- Indexes on hot paths

**Client:**
- Service worker for offline support (future)

### Bundle Size

Target: <100kb JS

Current:
- Astro: ~20kb
- Tailwind: ~10kb (purged)
- App code: ~30kb
- Total: ~60kb ✅

## Deployment

### Environments

**Development:**
- Local Workers dev server
- Local Postgres or Neon branch
- `ENVIRONMENT=development`

**Staging:**
- `staging.crewmodo.com`
- Auto-deploy from `develop` branch
- Production-like data (anonymized)

**Production:**
- `app.crewmodo.com`
- Manual approval from `main` branch
- Real customer data

### CI/CD

GitHub Actions:
```yaml
on:
  push:
    branches: [develop, main]

jobs:
  test:
    - npm ci
    - npm test
    - npm run typecheck
  
  deploy:
    needs: test
    - wrangler deploy --env ${{ github.ref == 'refs/heads/main' && 'production' || 'staging' }}
```

### Rollback

Cloudflare Workers supports instant rollback:
```bash
wrangler rollback --env production
```

Database rollbacks require migration reversal (manual).

## Monitoring

### Metrics to Track

**Application:**
- Request rate, latency (p50/p95/p99)
- Error rate (5xx)
- Active users (DAU/WAU/MAU)

**Business:**
- MRR, churn, LTV
- Estimates created per org
- Conversion rate (estimate → job)

**Infrastructure:**
- Worker CPU time
- KV read/write ops
- R2 storage
- Neon connections

### Alerting

- Error rate > 1% → PagerDuty
- P95 latency > 2s → Slack
- Worker CPU > 80% → Investigate

## Scaling Considerations

### Current Limits

- Cloudflare Workers: 10ms CPU, 128MB memory
- Neon Postgres: 10k connections, 10GB storage
- KV: 1GB storage, eventual consistency

### When to Scale

**Workers:**
- If CPU > 10ms → Optimize queries or break into subrequests
- If memory > 128MB → Stream responses

**Database:**
- If connections maxed → Add PgBouncer
- If storage > 80% → Upgrade Neon plan
- If queries slow → Add read replicas

**Multi-region:**
- Workers are global by default
- Database is single-region (for now)
- Consider read replicas in EU/APAC if latency issue

## Future Architecture

### Phase 2 (12-18 months)

- **Queues:** Cloudflare Queues for async jobs (PDF generation, email batches)
- **Durable Objects:** Real-time collaboration on estimates
- **Analytics:** ClickHouse for product analytics
- **Search:** Elasticsearch for full-text search

### Phase 3 (24+ months)

- **Multi-region DB:** CockroachDB or Neon read replicas
- **GraphQL:** For mobile app
- **WebSockets:** Real-time updates
