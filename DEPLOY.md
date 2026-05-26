# Deployment Guide

## Prerequisites

- Cloudflare account with Workers and Pages enabled
- Neon Postgres database
- Wrangler CLI installed
- pnpm installed

## Setup

### 1. Create Cloudflare Resources

```bash
# Create KV namespace for sessions
wrangler kv:namespace create "KV"
wrangler kv:namespace create "KV" --preview

# Update apps/api/wrangler.toml with the IDs
```

### 2. Set Secrets

```bash
cd apps/api

# Database
wrangler secret put DATABASE_URL

# Twilio
wrangler secret put TWILIO_ACCOUNT_SID
wrangler secret put TWILIO_AUTH_TOKEN
wrangler secret put TWILIO_PHONE_NUMBER

# Stripe
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put STRIPE_STARTER_PRICE_ID
wrangler secret put STRIPE_PRO_PRICE_ID
wrangler secret put STRIPE_ENTERPRISE_PRICE_ID

# Email
wrangler secret put MAILCHANNELS_API_KEY

# Auth and cron
wrangler secret put SESSION_SECRET
wrangler secret put CRON_SECRET

# Google Calendar OAuth
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# QuickBooks OAuth
wrangler secret put QB_CLIENT_ID
wrangler secret put QB_CLIENT_SECRET

# Cloudflare API (for Browser Rendering)
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_API_TOKEN
```

### 3. Deploy Database

Run migrations against the target Neon database:

```bash
pnpm db:migrate
```

### 4. Deploy API

```bash
pnpm deploy:api
```

Or manually:
```bash
cd apps/api
wrangler deploy
```

### 5. Deploy Web App

```bash
pnpm deploy:web
```

Or manually:
```bash
pnpm --filter @paintflow/web build
wrangler pages deploy apps/web/dist --project-name=paintflow
```

## Environment Variables

Set in Cloudflare dashboard or wrangler.toml:

- `APP_URL` - API base URL, for example `https://api.paintflow.app`
- `PUBLIC_URL` - Public web app URL
- `PUBLIC_API_URL` - Public API URL used by the web app
- `CORS_ORIGINS` - Comma-separated web origins allowed to call the API
- `COOKIE_DOMAIN` - Cookie domain for shared auth, for example `.paintflow.app`
- `DATABASE_URL` - Neon connection string
- `KV` - KV namespace binding
- `TWILIO_*` - Twilio credentials
- `STRIPE_*` - Stripe keys
- `GOOGLE_*` - Google OAuth client credentials
- `QB_*` - QuickBooks OAuth client credentials
- `EMAIL_PROVIDER` - Email provider, usually `mailchannels`
- `EMAIL_FROM` - Verified sender email address
- `EMAIL_FROM_NAME` - Sender display name
- `MAILCHANNELS_API_KEY` - MailChannels Email API key
- `RESEND_API_KEY` - Optional fallback email API key when using `EMAIL_PROVIDER=resend`
- `CF_ACCOUNT_ID` - Cloudflare account ID
- `CF_API_TOKEN` - Cloudflare API token

See `docs/EMAIL.md` for MailChannels DNS and sender-domain setup.

## Cron Jobs

The API has a scheduled worker that runs daily at 9am UTC for drip automation and review requests.

Configure in wrangler.toml:
```toml
[triggers]
crons = ["0 9 * * *"]
```

## Custom Domain

### API
```bash
wrangler route add "api.paintflow.app/*" --zone-name=paintflow.app
```

### Connector Redirects

Configure connector redirect URLs exactly:

- Google Calendar: `https://api.paintflow.app/v1/calendar/callback`
- QuickBooks: `https://api.paintflow.app/v1/quickbooks/callback`
- Stripe webhook: `https://api.paintflow.app/v1/billing/webhook`

### Web
In Cloudflare Pages dashboard:
- Add custom domain: paintflow.app
- Set CNAME to pages.dev URL

## Monitoring

Check logs:
```bash
wrangler tail
```

View metrics in Cloudflare dashboard:
- Workers & Pages → paintflow-api → Metrics
- Pages → paintflow → Analytics

## Rollback

```bash
# List deployments
wrangler deployments list

# Rollback to version
wrangler rollback
```

## Local Development

```bash
# Start all services
pnpm dev

# Or individually
cd apps/api && wrangler dev
cd apps/web && pnpm dev
```

Local dev uses:
- API: http://localhost:8787
- Web: http://localhost:4321
