# Demo Deploy

Crewmodo has a Cloudflare demo environment for shareable previews:

- Web: `https://crewmodo-demo.pages.dev`
- API: `https://crewmodo-api-demo.danielablack.workers.dev`
- Worker environment: `demo`
- Pages project: `crewmodo-demo`
- Demo KV namespace: `crewmodo-demo-kv`
- Demo R2 bucket: `crewmodo-uploads-preview`

## Manual Deploy

From the repo root:

```sh
corepack pnpm -r build
corepack pnpm exec wrangler deploy --config apps/api/wrangler.toml --env demo
PUBLIC_API_URL="https://crewmodo-api-demo.danielablack.workers.dev" corepack pnpm --filter @crewmodo/web build
corepack pnpm exec wrangler pages deploy apps/web/dist --project-name crewmodo-demo --branch main
```

PowerShell:

```powershell
corepack pnpm -r build
corepack pnpm exec wrangler deploy --config apps/api/wrangler.toml --env demo
$env:PUBLIC_API_URL = "https://crewmodo-api-demo.danielablack.workers.dev"
corepack pnpm --filter @crewmodo/web build
corepack pnpm exec wrangler pages deploy apps/web/dist --project-name crewmodo-demo --branch main
```

## GitHub Auto Deploy

The `.github/workflows/deploy-cloudflare.yml` workflow deploys the API Worker and Pages app on every push to `main`.

Required GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The token needs account-scoped permissions for Pages, Workers Scripts, Workers KV Storage, and R2 Storage.
