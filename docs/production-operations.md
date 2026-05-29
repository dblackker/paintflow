# Production Operations

This is the operating model for releasing Crewmodo with fast iteration, clear rollback paths, and separate environments.

## Environments

| Environment | Purpose | Web | API | Deploy trigger |
| --- | --- | --- | --- | --- |
| Local dev | Daily development | `http://localhost:5173` | `http://localhost:8787` | `pnpm dev` |
| Demo | Shareable sandbox | `https://crewmodo-demo.pages.dev` | `https://crewmodo-api-demo.danielablack.workers.dev` | Manual GitHub Action |
| Staging | Main-branch verification | `https://staging.crewmodo.com` | `https://api-staging.crewmodo.com` | Push to `main` |
| Production | Customer-facing release | `https://crewmodo.com` and `https://app.crewmodo.com` | `https://api.crewmodo.com` | GitHub Release or manual dispatch |

Staging and production use separate Worker environments, KV namespaces, and R2 buckets. Staging currently uses the same app secrets supplied from local `.env`; before real customers are onboarded, use a separate Neon branch and separate Stripe test keys for staging.

## Release Flow

1. Merge code to `main`.
2. GitHub Actions deploys staging automatically.
3. Smoke test staging:
   - `https://staging.crewmodo.com`
   - `https://api-staging.crewmodo.com/health`
4. Create a GitHub Release with a concise changelog.
5. The production workflow deploys API and web assets.
6. Smoke test production:
   - `https://crewmodo.com`
   - `https://app.crewmodo.com`
   - `https://api.crewmodo.com/health`

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

Keep database migrations backwards compatible where possible. If a migration is not backwards compatible, document the rollback plan in the release notes before shipping.

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
