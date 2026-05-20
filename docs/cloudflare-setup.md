# Cloudflare and Database Setup

PaintFlow deploys as:

- `apps/api`: Cloudflare Worker API
- `apps/web`: Cloudflare Pages app
- Database: Neon Postgres
- Supporting Cloudflare bindings: Workers KV and R2

## 1. Install and Authenticate Wrangler

From the repo root:

```sh
corepack pnpm install
corepack pnpm wrangler login
```

For CI, use Cloudflare API tokens instead of browser login:

```sh
CLOUDFLARE_ACCOUNT_ID=...
CLOUDFLARE_API_TOKEN=...
```

## 2. Create Neon Database

In Neon:

1. Create a project for PaintFlow.
2. Create production and staging branches if desired.
3. Copy the pooled or serverless-compatible connection string for the app role.

Run migrations against the production database:

PowerShell:

```powershell
$env:DATABASE_URL="postgresql://USER:PASSWORD@HOST/db?sslmode=require"
corepack pnpm --filter @paintflow/db db:migrate
```

Shell:

```sh
DATABASE_URL="postgresql://USER:PASSWORD@HOST/db?sslmode=require" corepack pnpm --filter @paintflow/db db:migrate
```

The current API uses `@neondatabase/serverless`. Cloudflare also recommends Hyperdrive for database pooling when using native Postgres drivers. If we later move from the Neon serverless HTTP driver to `pg`/Postgres.js, add a Hyperdrive binding and pass `env.HYPERDRIVE.connectionString` to the database client.

## 3. Create Cloudflare Bindings

Create KV namespaces:

```sh
corepack pnpm wrangler kv namespace create KV
corepack pnpm wrangler kv namespace create KV --env production
```

Create R2 buckets:

```sh
corepack pnpm wrangler r2 bucket create paintflow-uploads-preview
corepack pnpm wrangler r2 bucket create paintflow-uploads
```

Copy the generated KV namespace IDs into `apps/api/wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KV"
id = "..."
preview_id = "..."

[[env.production.kv_namespaces]]
binding = "KV"
id = "..."
```

## 4. Configure API Variables and Secrets

Non-secret production variables live in `apps/api/wrangler.toml` under `[env.production].vars`.

Required Worker secrets:

```sh
cd apps/api

corepack pnpm wrangler secret put DATABASE_URL --env production
corepack pnpm wrangler secret put STRIPE_SECRET_KEY --env production
corepack pnpm wrangler secret put STRIPE_WEBHOOK_SECRET --env production
corepack pnpm wrangler secret put CRON_SECRET --env production
corepack pnpm wrangler secret put TWILIO_ACCOUNT_SID --env production
corepack pnpm wrangler secret put TWILIO_AUTH_TOKEN --env production
corepack pnpm wrangler secret put TWILIO_PHONE_NUMBER --env production
corepack pnpm wrangler secret put VAPID_PRIVATE_KEY --env production
```

For Web Push, generate an ES256 VAPID key pair and set:

- `VAPID_PUBLIC_KEY` as a Worker variable in `apps/api/wrangler.toml`.
- `VAPID_PRIVATE_KEY` as a Worker secret. Use PKCS#8 PEM format, including the `-----BEGIN PRIVATE KEY-----` wrapper.
- `VAPID_SUBJECT` as a contact URI such as `mailto:ops@yourdomain.com`.

Example key generation with OpenSSL:

```sh
openssl ecparam -name prime256v1 -genkey -noout -out vapid-private-ec.pem
openssl pkcs8 -topk8 -nocrypt -in vapid-private-ec.pem -out vapid-private-pkcs8.pem
openssl ec -in vapid-private-ec.pem -pubout -out vapid-public.pem
```

The browser-facing `VAPID_PUBLIC_KEY` must be the URL-safe uncompressed P-256 public key value used by `PushManager.subscribe`. Keep the private key only in Cloudflare secrets.

Optional integration secrets when implemented/configured:

```sh
corepack pnpm wrangler secret put QUICKBOOKS_CLIENT_ID --env production
corepack pnpm wrangler secret put QUICKBOOKS_CLIENT_SECRET --env production
corepack pnpm wrangler secret put GOOGLE_CLIENT_ID --env production
corepack pnpm wrangler secret put GOOGLE_CLIENT_SECRET --env production
```

## 5. Deploy API Worker

```sh
corepack pnpm deploy:api
```

The current production route in `apps/api/wrangler.toml` is:

```toml
routes = [
  { pattern = "api.paintflow.app/*", zone_name = "paintflow.app" }
]
```

Before deploying, make sure `paintflow.app` is a zone in the same Cloudflare account, or adjust the route.

## 6. Configure and Deploy Web App

For direct upload:

PowerShell:

```powershell
$env:PUBLIC_API_URL="https://api.paintflow.app"
corepack pnpm --filter @paintflow/web build
corepack pnpm wrangler pages deploy apps/web/dist --project-name paintflow-web
```

Shell:

```sh
PUBLIC_API_URL="https://api.paintflow.app" corepack pnpm --filter @paintflow/web build
corepack pnpm wrangler pages deploy apps/web/dist --project-name paintflow-web
```

If using Cloudflare Pages Git integration, set:

- Build command: `corepack pnpm --filter @paintflow/web build`
- Build output directory: `apps/web/dist`
- Production env var: `PUBLIC_API_URL=https://api.paintflow.app`

## 7. Custom Domains

Use Cloudflare dashboard:

- Pages custom domain: `app.paintflow.app`
- Worker custom domain or route: `api.paintflow.app`

Keep the API `PUBLIC_URL` and CORS origins in sync with the final app domain.

## 8. Smoke Test Production

After deploy:

```sh
curl https://api.paintflow.app/health
```

Then test in the browser:

- `https://app.paintflow.app/signup`
- `https://app.paintflow.app/onboarding`
- `https://app.paintflow.app/leads`
- `https://app.paintflow.app/estimates/production`

If a page says it cannot reach the API, verify:

- `PUBLIC_API_URL` was set when the Pages app was built.
- `CORS_ORIGINS` includes the app domain.
- Worker secrets are configured in the same environment you deployed.
- Neon `DATABASE_URL` is valid and migrations have run.

## Source References

- Cloudflare Workers secrets: https://developers.cloudflare.com/workers/configuration/secrets/
- Cloudflare Workers environment variables and environments: https://developers.cloudflare.com/workers/wrangler/environments/
- Cloudflare Worker custom domains and routes: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/
- Cloudflare Pages direct upload: https://developers.cloudflare.com/pages/get-started/direct-upload/
- Cloudflare Pages custom domains: https://developers.cloudflare.com/pages/configuration/custom-domains/
- Cloudflare Workers with Neon: https://developers.cloudflare.com/workers/databases/third-party-integrations/neon/
- Neon connection strings: https://neon.com/docs/get-started-with-neon/connect-neon
