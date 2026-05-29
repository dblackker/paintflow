# Rebrand Playbook

This document records the PaintFlow to Crewmodo rename so the next product or domain change can be done with less risk.

## Current Rename

| Area | Old value | New value |
| --- | --- | --- |
| Product name | PaintFlow | Crewmodo |
| Lowercase slug | paintflow | crewmodo |
| Package scope | `@paintflow/*` | `@crewmodo/*` |
| Primary domain | `paintflow.app` | `crewmodo.com` |
| App domain | `app.paintflow.app` | `app.crewmodo.com` |
| API domain | `api.paintflow.app` | `api.crewmodo.com` |
| Demo Pages project | `paintflow-demo` | `crewmodo-demo` |
| Demo Worker | `paintflow-api-demo` | `crewmodo-api-demo` |
| Worker | `paintflow-api` | `crewmodo-api` |
| Web package | `paintflow-web` | `crewmodo-web` |
| R2 buckets | `paintflow-uploads`, `paintflow-uploads-preview` | `crewmodo-uploads`, `crewmodo-uploads-preview` |
| Local cookie/session prefix | `paintflow_*` | `crewmodo_*` |
| Local dev host | `paintflow.local` | `crewmodo.local` |

## What Changed

- Source, docs, package names, Cloudflare config, public manifest, service worker cache names, demo URLs, worker names, R2 bucket names, cookies, and local storage keys were renamed.
- The workspace package scope changed from `@paintflow/*` to `@crewmodo/*`, so `pnpm install` must be run after the rename to recreate local workspace links.
- Existing browser sessions using old cookie/local storage names will not carry forward. Users may need to sign in again.
- Painting-specific feature copy was left where it describes existing vertical workflows. The brand/domain was changed, but the product still contains painting contractor modules.

## Repeatable Process

1. Inventory all references before editing:

   ```bash
   rg -n "PaintFlow|paintflow|PAINTFLOW|@paintflow|paintflow\.app" .
   ```

2. Apply replacements in a deliberate order. Replace full domains and resource names before generic lowercase words, and treat package scope separately so email addresses such as `estimates@brand.com` are not accidentally rewritten as package scopes.

3. Run a full workspace install after package scope changes:

   ```bash
   pnpm install
   ```

4. Validate package resolution and builds:

   ```bash
   pnpm --filter @crewmodo/api build
   pnpm --filter @crewmodo/web build
   ```

5. Verify no old brand or accidental intermediate domain remains:

   ```bash
   rg -n "PaintFlow|paintflow|PAINTFLOW|@paintflow|crewmodo\.app" . --glob '!node_modules/**' --glob '!apps/web/dist/**' --glob '!*.map'
   ```

6. Check for generated files that should not be part of the rename. Drizzle migrations should not change for a brand-only rename unless the schema actually changed.

7. Commit with a clear brand-change title, for example:

   ```bash
   git commit -m "chore: rebrand paintflow to crewmodo"
   ```

## External Setup Checklist

Code changes do not rename external services automatically. After this kind of rename, update or create:

- Cloudflare Pages project and custom domain for `app.crewmodo.com`.
- Cloudflare Worker route for `api.crewmodo.com/*`.
- Cloudflare DNS records for `crewmodo.com`, `app.crewmodo.com`, `api.crewmodo.com`, `cdn.crewmodo.com`, and `receipts.crewmodo.com`.
- R2 buckets or bindings for `crewmodo-uploads` and `crewmodo-uploads-preview`.
- Cloudflare Email Routing for `receipts.crewmodo.com` if inbound supplier invoice processing is enabled.
- GitHub Actions secrets and workflow variables if project names changed.
- Stripe Connect, billing portal, webhook endpoints, and redirect URLs.
- Google, QuickBooks, and any other OAuth redirect URLs.
- Mail sender domains, SPF/DKIM/DMARC, and email template sender addresses.
- Marketing links, demo links, docs, and support inboxes outside this repository.

## Gotchas

- Package scope renames can pass text search but fail TypeScript until workspace symlinks are relinked with `pnpm install`.
- Changing cookie or local storage keys intentionally invalidates old sessions. That is acceptable for a rebrand, but it should be communicated before production rollout.
- Cloudflare resource names in `wrangler.toml` and GitHub workflows must match resources that actually exist in the Cloudflare account.
- Demo URLs using `*.pages.dev` and `*.workers.dev` are Cloudflare project names. They only work after the matching projects are created or renamed in Cloudflare.
