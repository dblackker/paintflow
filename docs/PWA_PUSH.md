# PWA Push Notifications

PaintFlow uses standards-based Web Push with VAPID keys:

- `VAPID_PUBLIC_KEY` is safe to store in `wrangler.toml` and expose to the web app.
- `VAPID_PRIVATE_KEY` must be stored as a Cloudflare Worker secret.
- `VAPID_SUBJECT` should be a `mailto:` address or URL identifying the sender.

## Generate Keys

```bash
pnpm vapid:generate
```

Copy the public key into `apps/api/wrangler.toml`.

To print only the public key for smoke tests:

```bash
pnpm vapid:generate -- --public-only
```

Set the private key as a Worker secret. Do not commit it:

```bash
pnpm exec wrangler secret put VAPID_PRIVATE_KEY --env demo --config apps/api/wrangler.toml
pnpm exec wrangler secret put VAPID_PRIVATE_KEY --env production --config apps/api/wrangler.toml
```

## Local Development

For local Worker development, add these to `apps/api/.dev.vars`:

```bash
VAPID_PUBLIC_KEY="..."
VAPID_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
VAPID_SUBJECT="mailto:admin@paintflow.app"
```

The React app registers `/sw.js` automatically. Users subscribe from `/notifications` by clicking **Enable alerts**.

## Runtime Flow

1. The browser requests `/v1/push/vapid-public-key`.
2. The browser subscribes through `PushManager` using the public key.
3. The subscription is saved to `/v1/push/subscriptions`.
4. Server-side events call `createNotificationAndPush`.
5. Expired subscriptions returning `404` or `410` are disabled automatically.
