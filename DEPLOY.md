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

# Resend
wrangler secret put RESEND_API_KEY

# Cloudflare API (for Browser Rendering)
wrangler secret put CF_ACCOUNT_ID
wrangler secret put CF_API_TOKEN
```

### 3. Deploy Database

```bash
pnpm db:push
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
cd apps/web
astro build
wrangler pages deploy dist --project-name=paintflow
```

## Environment Variables

Set in Cloudflare dashboard or wrangler.toml:

- `APP_URL` - Your app URL
- `PUBLIC_URL` - Public web app URL
- `PUBLIC_API_URL` - Public API URL used by the web app
- `DATABASE_URL` - Neon connection string
- `KV` - KV namespace binding
- `TWILIO_*` - Twilio credentials
- `STRIPE_*` - Stripe keys
- `RESEND_API_KEY` - Email API key
- `CF_ACCOUNT_ID` - Cloudflare account ID
- `CF_API_TOKEN` - Cloudflare API token

## Cron Jobs

The API has a scheduled worker that runs daily at 9am for drip automation.

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
cd apps/web && astro dev
```

Local dev uses:
- API: http://localhost:8787
- Web: http://localhost:4321
