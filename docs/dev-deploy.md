# Dev Deploy

Crewmodo has a Cloudflare dev environment for main-branch previews:

- Web: `https://crewmodo-dev.pages.dev`
- API: `https://crewmodo-api-dev.danielablack.workers.dev`
- Worker environment: `dev`
- Pages project: `crewmodo-dev`
- Dev KV namespace: existing preview KV namespace
- Dev R2 bucket: `crewmodo-uploads-preview`

## Manual Deploy

From the repo root:

```sh
corepack pnpm -r build
corepack pnpm exec wrangler deploy --config apps/api/wrangler.toml --env dev
PUBLIC_API_URL="https://crewmodo-api-dev.danielablack.workers.dev" corepack pnpm --filter @crewmodo/web build
corepack pnpm exec wrangler pages deploy apps/web/dist --project-name crewmodo-dev --branch main
```

PowerShell:

```powershell
corepack pnpm -r build
corepack pnpm exec wrangler deploy --config apps/api/wrangler.toml --env dev
$env:PUBLIC_API_URL = "https://crewmodo-api-dev.danielablack.workers.dev"
corepack pnpm --filter @crewmodo/web build
corepack pnpm exec wrangler pages deploy apps/web/dist --project-name crewmodo-dev --branch main
```

## GitHub Auto Deploy

The `.github/workflows/deploy-cloudflare.yml` workflow deploys the API Worker and Pages app on every push to `main`.

Required GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

The token needs account-scoped permissions for Pages, Workers Scripts, Workers KV Storage, and R2 Storage.
