# Crewmodo

**CRM built for trade contractors, starting with deep support for painting operations.**

Crewmodo handles the entire workflow from lead capture to final payment, with features tailored to field service teams and deep painting-specific workflows such as job costing, production rates, before/after photos, and review automation.

## Tech Stack

- **Frontend:** Astro, TypeScript, Tailwind CSS
- **Backend:** Hono on Cloudflare Workers
- **Database:** Drizzle ORM + PostgreSQL (Neon)
- **Auth:** Magic links via Resend
- **Payments:** Stripe
- **E-signature:** Documenso
- **Calendar:** Google Calendar API
- **SMS:** Twilio
- **Accounting:** QuickBooks Online
- **Storage:** Cloudflare R2
- **Monorepo:** npm workspaces

## Quick Start

### Prerequisites

- Node.js 20+
- Cloudflare account
- Neon Postgres database
- Resend transactional email

### Setup

1. **Clone and install:**
```bash
git clone https://github.com/dblackker/crewmodo.git
cd crewmodo
npm install
```

2. **Environment variables:**
Copy `.env.example` to `.env` and fill in:
```bash
DATABASE_URL=postgresql://...
CLOUDFLARE_API_TOKEN=...
STRIPE_SECRET_KEY=sk_test_...
GOOGLE_CLIENT_ID=...
TWILIO_ACCOUNT_SID=...
APP_URL=http://localhost:4321
ENVIRONMENT=development
```

3. **Database setup:**
```bash
corepack pnpm db:push
corepack pnpm db:seed:golden
```

The golden seed is safe to rerun. It resets only the demo workspace with slug
`golden-brush-demo` and keeps the rest of the database untouched. The fixture
data lives in `packages/db/src/seeds/golden-data.ts`; the executable seeder is
`packages/db/src/seeds/golden.ts`.

4. **Run dev servers:**
```bash
# Terminal 1: API
cd apps/api
npm run dev

# Terminal 2: Web
cd apps/web
npm run dev
```

Visit `http://localhost:4321`

## Architecture

### Monorepo Structure

```
crewmodo/
├── apps/
│   ├── api/          # Hono API (Cloudflare Workers)
│   └── web/          # Astro frontend
├── packages/
│   └── db/           # Drizzle schema + migrations
└── package.json
```

### Database Schema

Key tables:
- `organizations` – Tenant isolation
- `users` + `memberships` – Auth & RBAC
- `leads` – Lead management
- `estimates` – Good/Better/Best pricing
- `jobs` – Job tracking with costing
- `change_orders` – Post-signature modifications
- `job_photos` – Before/progress/after
- `message_templates` – Email/SMS templates
- `subscriptions` – SaaS billing

See `packages/db/src/schema.ts` for full schema.

### API Routes

- `POST /v1/auth/magic-link` – Request sign-in link
- `GET /v1/auth/verify` – Verify magic link token
- `GET /v1/leads` – List leads
- `POST /v1/estimates` – Create estimate
- `POST /v1/estimates/:id/sign` – E-signature
- `GET /v1/jobs` – List jobs
- `POST /v1/uploads/photo` – Upload job photos
- `POST /v1/billing/create-checkout` – Stripe checkout
- `GET /v1/templates` – Message templates
- `POST /v1/change-orders` – Create change order

Full API docs: [OpenAPI spec](./docs/api.yaml)

## Features

### Core CRM
- ✅ Lead management with source tracking
- ✅ Good/Better/Best estimates
- ✅ E-signature via Documenso
- ✅ Stripe payments (50% deposit)
- ✅ Job costing & time tracking
- ✅ Production rate calculator

### Scheduling
- ✅ Week view calendar
- ✅ Google Calendar sync
- ✅ Drag-drop job scheduling
- ✅ Unscheduled jobs queue

### Communication
- ✅ Magic link auth (no passwords)
- ✅ SMS inbox (Twilio)
- ✅ Email templates (customizable)
- ✅ Automated review requests

### Accounting
- ✅ QuickBooks Online sync
- ✅ Expense tracking
- ✅ Receipt uploads

### SaaS Billing
- ✅ Starter ($49/mo), Pro ($149/mo), Enterprise ($399/mo)
- ✅ Stripe Checkout + Customer Portal
- ✅ Free trial support

## Deployment

### Environments

- **Development:** Local, `ENVIRONMENT=development`
- **Staging:** `staging.crewmodo.com`, auto-deploy from `develop` branch
- **Production:** `app.crewmodo.com`, manual approval from `main` branch

### Deploy to Cloudflare

```bash
# Staging
git push origin develop
# Auto-deploys to staging.crewmodo.com

# Production
git checkout main
git merge develop
git push origin main
# Requires approval, deploys to app.crewmodo.com
```

### DNS Setup for Resend

Transactional platform email sends from `mail.crewmodo.com` to isolate sender reputation from the apex domain.
Resend manages the required DNS verification records for that sender subdomain:

```
resend._domainkey.mail.crewmodo.com TXT "<Resend DKIM public key>"
send.mail.crewmodo.com MX feedback-smtp.us-east-1.amazonses.com priority 10
send.mail.crewmodo.com TXT "v=spf1 include:amazonses.com ~all"
_dmarc.mail.crewmodo.com TXT "v=DMARC1; p=none; rua=mailto:admin@crewmodo.com"
```

Set `EMAIL_PROVIDER=resend`, `EMAIL_FROM=no-reply@mail.crewmodo.com`, and `RESEND_API_KEY` on each Worker environment.

### Stripe Webhooks

Configure in Stripe Dashboard:
- SaaS billing endpoint: `https://api.crewmodo.com/v1/billing/webhook`
- Estimate payment endpoint: `https://api.crewmodo.com/v1/payments/webhook`
- SaaS billing events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`
- Estimate payment events: `checkout.session.completed`, `charge.refunded`

Use separate webhook signing secrets for staging and production. Keep Stripe test keys on dev/staging and live keys only on production.

## Architectural Decisions

### Authentication Strategy

**Decision:** Use passwordless magic link authentication for core SMB sign-in, with SSO/MFA as the enterprise upgrade path instead of a home-grown password database.

**Rationale:**
- Painting contractors use mobile devices on job sites
- Password managers uncommon in this demographic
- Reduces support burden because there is no app password to reset
- Avoids storing password hashes and handling password breach workflows
- Better mobile UX for owners, estimators, and crew leads
- Enterprise customers typically expect Google/Microsoft SSO, SAML/OIDC, MFA, audit logs, and admin session controls

**Trade-offs:**
- Email deliverability dependency
- 15-minute token expiration
- Requires a transactional email provider (Resend)
- Magic link requests are rate-limited per email and per IP/network. Defaults are higher in development for demos and configurable with `MAGIC_LINK_EMAIL_LIMIT` and `MAGIC_LINK_IP_LIMIT`.

### Why Hono on Cloudflare Workers?

**Decision:** Edge runtime instead of traditional server

**Rationale:**
- Global low-latency for contractors in field
- Auto-scaling, no server management
- Cost-effective (millions of requests free)
- Integrates with Cloudflare ecosystem (R2, KV, D1)

**Trade-offs:**
- No Node.js APIs (use Web Standards)
- 10ms CPU limit per request
- Cold starts (minimal with Workers)

### Why Drizzle ORM?

**Decision:** Drizzle over Prisma

**Rationale:**
- Smaller bundle size (critical for Workers)
- SQL-like, less abstraction
- Better TypeScript inference
- Faster queries

**Trade-offs:**
- Smaller community
- Fewer convenience methods

### Why Monorepo?

**Decision:** npm workspaces with `apps/` and `packages/`

**Rationale:**
- Shared types between API and web
- Atomic changes across stack
- Single CI/CD pipeline
- Easier refactoring

**Trade-offs:**
- Larger repo size
- Requires workspace-aware tooling

### Why Good/Better/Best Estimates?

**Decision:** Tiered pricing built into core product

**Rationale:**
- Industry standard for painting (upsell strategy)
- Increases average job value 20-30%
- Differentiator vs generic CRMs
- Painters think in tiers (basic paint vs premium)

### Why 50% Deposit?

**Decision:** Default 50% deposit on estimate acceptance

**Rationale:**
- Industry standard for painting
- Covers material costs
- Reduces no-shows
- Configurable per org

## Development

### Running Tests

```bash
npm test                 # Unit tests
npm run test:e2e        # Playwright E2E
npm run test:api        # API integration tests
```

### Database Migrations

```bash
npm run db:generate     # Generate migration
npm run db:push         # Push to database
npm run db:studio       # Open Drizzle Studio
```

### Code Style

- TypeScript strict mode
- ESLint + Prettier
- Conventional commits
- Feature flags for risky changes

## Monitoring

Production monitoring (optional, $200/mo for enterprise):

- **Sentry** – Error tracking
- **Better Uptime** – Uptime monitoring + status page
- **Axiom** – Log aggregation
- **Checkly** – Synthetic monitoring
- **Metabase** – Business metrics

See [Monitoring Guide](./docs/monitoring.md)

## Contributing

1. Branch from `develop`: `git checkout -b feature/my-feature`
2. Make changes + tests
3. PR to `develop`
4. Auto-deploys to staging
5. After QA, merge to `main` for production

## License

Proprietary – All rights reserved

## Support

- Docs: https://crewmodo.com/docs
- Email: support@crewmodo.com
- Issues: GitHub Issues
