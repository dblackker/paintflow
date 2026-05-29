# Deployment And Branching Strategy

Crewmodo uses a simple promotion model:

- `main` is dev. Most product work lands here and auto-deploys to the dev Cloudflare environment.
- `staging` is release candidate validation. Promote from `main` into `staging` when a batch of changes is ready for manual QA.
- `production` is the customer-facing release branch. Promote from `staging` into `production` only after staging has been validated.

Avoid committing directly to `staging` or `production` except for emergency fixes. The normal path should be:

1. Work on `main`.
2. Let CI and the dev deploy run.
3. Open a PR from `main` to `staging` when ready to test a release candidate.
4. Validate `https://staging.crewmodo.com` and `https://api-staging.crewmodo.com`.
5. Open a PR from `staging` to `production`.
6. Merge the production PR and tag the release after deployment succeeds.

This keeps fast iteration on `main` while still creating a clear staging gate and a repeatable release record.

## Environments

| Branch | Purpose | Web | API | Database secret |
| --- | --- | --- | --- | --- |
| `main` | Dev / active iteration | `https://crewmodo-dev.pages.dev` | `https://crewmodo-api-dev.danielablack.workers.dev` | `NEON_MAIN` |
| `staging` | Release candidate QA | `https://staging.crewmodo.com` | `https://api-staging.crewmodo.com` | `NEON_STAGING` |
| `production` | Customer-facing release | `https://crewmodo.com` | `https://api.crewmodo.com` | `NEON_PROD` |

Each environment should have its own database. Staging should never share the production database. Schema migrations run during each environment deploy against that environment's `DATABASE_URL`.

## Release Commands

Create the long-lived branches once if they do not exist:

```sh
git checkout main
git pull origin main
git checkout -b staging
git push origin staging
git checkout main
git checkout -b production
git push origin production
git checkout main
```

Promote dev to staging:

```sh
git checkout staging
git pull origin staging
git merge --no-ff origin/main
git push origin staging
```

Promote staging to production:

```sh
git checkout production
git pull origin production
git merge --no-ff origin/staging
git push origin production
```

PRs are preferred for both promotions because they create a reviewable changelog and make rollback decisions easier.

## Rollback

For frontend-only issues, roll back the Cloudflare Pages deployment to the previous successful deployment from the Cloudflare dashboard.

For API or migration-related issues, prefer a forward fix on `production`. Database migrations should be written so they are safe to re-run and backward-compatible during rollout. Destructive migrations need a staged plan: add new structure, backfill, switch code, then remove old structure later.

## GitHub Auto Deploy

Current workflows:

- `.github/workflows/deploy-cloudflare.yml`: deploys dev on every push to `main`.
- `.github/workflows/deploy-staging.yml`: deploys staging on every push to `staging`.
- `.github/workflows/deploy-production.yml`: deploys production on every push to `production`, release publish, or manual dispatch.
- `.github/workflows/ci.yml`: runs typography lint, button hierarchy lint, and builds on pull requests and pushes to `main`.

Required GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `NEON_MAIN`
- `NEON_STAGING`
- `NEON_PROD`

The Cloudflare token needs account-scoped permissions for Pages, Workers Scripts, Workers KV Storage, R2 Storage, DNS, and Worker secrets.

## Dev Environment

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

