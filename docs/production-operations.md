# Production Operations

This is the operating model for releasing Crewmodo with fast iteration, clear rollback paths, and separate environments.

## Environments

| Environment | Purpose | Web | API | Deploy trigger |
| --- | --- | --- | --- | --- |
| Local dev | Daily development | `http://localhost:5173` | `http://localhost:8787` | `pnpm dev` |
| Dev | Main-branch verification | `https://crewmodo-demo.pages.dev` | `https://crewmodo-api-demo.danielablack.workers.dev` | Push to `main` or manual dispatch |
| Staging | Pre-release verification | `https://staging.crewmodo.com` | `https://api-staging.crewmodo.com` | Push to `staging` or manual dispatch |
| Production | Customer-facing release | `https://crewmodo.com` and `https://app.crewmodo.com` | `https://api.crewmodo.com` | Push to `production`, GitHub Release, or manual dispatch |

Dev, staging, and production use separate Neon connection strings:

- `NEON_MAIN` for `main` / dev.
- `NEON_STAGING` for `staging`.
- `NEON_PROD` for `production`.

Staging and production use separate Worker environments, KV namespaces, R2 buckets, and database branches. Keep Stripe test keys on dev/staging and live keys only on production.

## Release Flow

1. Merge code to `main`.
2. GitHub Actions deploys dev automatically against `NEON_MAIN`.
3. Promote by merging `main` to `staging`.
4. GitHub Actions runs migrations against `NEON_STAGING`, then deploys staging.
5. Smoke test staging:
   - `https://staging.crewmodo.com`
   - `https://api-staging.crewmodo.com/health`
6. Promote by merging `staging` to `production` or publishing a GitHub Release.
7. GitHub Actions runs migrations against `NEON_PROD`, then deploys API and web assets.
8. Smoke test production:
   - `https://crewmodo.com`
   - `https://app.crewmodo.com`
   - `https://api.crewmodo.com/health`

Required GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `NEON_MAIN`
- `NEON_STAGING`
- `NEON_PROD`

The deploy workflows also accept the existing aliases `CF_ACCOUNT_ID` and `CF_API_TOKEN`. `CLOUDFLARE_API_TOKEN` or `CF_API_TOKEN` must be present for Wrangler deploys.

## Rollback

Cloudflare keeps previous deployments and Worker versions.

For the web app:

1. Open Cloudflare Dashboard.
2. Go to Workers & Pages > `crewmodo-web` > Deployments.
3. Select the prior healthy deployment.
4. Use Rollback.

For the API:

1. Open Cloudflare Dashboard.
2. Go to Workers & Pages > `crewmodo-api-production` > Deployments / Versions.
3. Roll back to the prior healthy version.

Keep database migrations backwards compatible where possible. Database rollback is a separate operation from code rollback. If a migration is not backwards compatible, document the data recovery or forward-fix plan in the release notes before shipping.

## Monitoring

Minimum production checks:

- API health: `https://api.crewmodo.com/health`
- Cloudflare Worker logs and errors for `crewmodo-api-production`
- Pages deployment status for `crewmodo-web`
- Worker cron results for missed punch, drip, review request, and supplier catalog jobs
- Neon database metrics and connection errors
- Stripe webhook delivery failures
- Mail provider delivery failures

Cloudflare setup already provides edge analytics, Worker request logs, deployment history, and route-level error visibility. Add a dedicated uptime monitor next; the best first target is `https://api.crewmodo.com/health` every 1-5 minutes.

## Changelog Standard

Every production release should include:

- User-facing changes
- Operational changes
- Migrations or data changes
- Known risks
- Rollback notes

Example:

```md
## Crewmodo v0.3.0

### User-facing
- Added supplier invoice OCR review.

### Operational
- Added R2 retention for uploaded invoice files.

### Migrations
- Added supplier invoice dedupe table.

### Risks
- OCR depends on `OPENAI_API_KEY` and rate limits.

### Rollback
- Web/API rollback is safe. Do not roll back database migration without preserving imported invoices.
```

## Email Strategy

MailChannels is still configured as the active outbound provider because it is already integrated and has an API key. Cloudflare now has Email Service with outbound sending from Workers through a binding, but the domain must be onboarded and sender DNS verified before switching.

Recommended path:

1. Keep `EMAIL_PROVIDER=mailchannels` until production email from `no-reply@crewmodo.com` is verified end-to-end.
2. In Cloudflare, onboard `crewmodo.com` under Email Service / Email Sending.
3. Add the SPF/DKIM records Cloudflare provides.
4. Add a Worker `send_email` binding and switch `EMAIL_PROVIDER=cloudflare`.
5. Send test magic links, proposal emails, change order emails, and invoice reminders from staging before production.

Cloudflare Email Service reduces external dependencies, but do not remove MailChannels until delivery, bounce handling, and sender reputation are proven.

## Configured Cloudflare Resources

- Zone: `crewmodo.com`
- Pages:
  - `crewmodo-web`
  - `crewmodo-staging`
  - `crewmodo-demo`
- Workers:
  - `crewmodo-api-production`
  - `crewmodo-api-staging`
  - `crewmodo-api-demo`
- R2:
  - `crewmodo-uploads`
  - `crewmodo-uploads-preview`
- KV:
  - `worker-crewmodo-production-kv`
  - `worker-crewmodo-staging-kv`
  - existing demo KV namespaces

## DNS

Configured records:

- `crewmodo.com` -> `crewmodo-web.pages.dev`
- `www.crewmodo.com` -> `crewmodo-web.pages.dev`
- `app.crewmodo.com` -> `crewmodo-web.pages.dev`
- `staging.crewmodo.com` -> `crewmodo-staging.pages.dev`
- `api.crewmodo.com` -> production Worker route
- `api-staging.crewmodo.com` -> staging Worker route
- root SPF record for MailChannels
- `_dmarc.crewmodo.com` with monitoring policy

When Cloudflare Email Service is enabled, update SPF/DKIM/DMARC according to the records Cloudflare provides.
