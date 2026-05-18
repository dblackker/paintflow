# PaintFlow Deployment Checklist

## Pre-Deployment

### 1. Environment Setup
- [ ] Create Neon Postgres database (production)
- [ ] Run `pnpm db:push` to create tables
- [ ] Set Cloudflare environment variables:
  ```
  DATABASE_URL=postgresql://...
  APP_URL=https://app.paintflow.app
  ENVIRONMENT=production
  STRIPE_SECRET_KEY=sk_live_...
  STRIPE_WEBHOOK_SECRET=whsec_...
  RESEND_API_KEY=re_...
  ```
- [ ] Configure Cloudflare Workers:
  - [ ] Create KV namespace `PAINTFLOW_SESSIONS`
  - [ ] Bind KV to api worker
  - [ ] Set compatibility_date = "2024-01-01"

### 2. DNS Configuration
- [ ] Add CNAME: `app.paintflow.app` → `paintflow.workers.dev`
- [ ] Add MailChannels DNS:
  ```
  _mailchannels.paintflow.app TXT "v=mc1 cfid=paintflow.workers.dev"
  ```
- [ ] Verify DNS propagation

### 3. Stripe Setup
- [ ] Switch to live mode
- [ ] Create products:
  - Starter: $49/month
  - Pro: $149/month
  - Enterprise: $399/month
- [ ] Configure webhook endpoint:
  - URL: `https://app.paintflow.app/api/webhooks/stripe`
  - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- [ ] Copy webhook secret to env

### 4. QuickBooks (Optional for launch)
- [ ] Register app at developer.intuit.com
- [ ] Set redirect URI: `https://app.paintflow.app/v1/quickbooks/callback`
- [ ] Get production Client ID/Secret
- [ ] Add to env vars

## Deployment

### 5. Deploy API
```bash
cd apps/api
wrangler deploy --env production
```

### 6. Deploy Web
```bash
cd apps/web
wrangler pages deploy dist --project-name=paintflow
```

### 7. Verify Deployment
- [ ] https://app.paintflow.app loads
- [ ] Landing page displays
- [ ] Sign up flow works (magic link email sent)
- [ ] Dashboard loads
- [ ] Create estimate flow works
- [ ] Calendar drag-drop works
- [ ] Settings page loads

## Post-Deployment

### 8. Test Critical Paths
- [ ] **Signup:** New user → onboarding → dashboard
- [ ] **Auth:** Magic link → session persists
- [ ] **Estimate:** Create → send → e-sign
- [ ] **Payment:** Stripe checkout completes
- [ ] **Calendar:** Drag job → Google sync
- [ ] **Mobile:** Bottom nav works, PWA installable

### 9. Monitoring
- [ ] Set up Cloudflare Analytics
- [ ] Configure error tracking (Sentry optional)
- [ ] Set up uptime monitoring
- [ ] Create status page

### 10. Documentation
- [ ] Update README with production URL
- [ ] Record demo video (use script)
- [ ] Publish help docs
- [ ] Create onboarding email sequence

### 11. Launch
- [ ] Announce to painting forums (Reddit r/painting, Contractor Talk)
- [ ] Email existing contacts
- [ ] Product Hunt launch
- [ ] LinkedIn post

## Rollback Plan

If critical issues arise:

1. **Database:** Restore from Neon backup
2. **Code:** Roll back Cloudflare deployment:
   ```bash
   wrangler rollback --env production
   ```
3. **DNS:** Point back to previous deployment

## Post-Launch Metrics

Track these in first week:
- [ ] Signups per day
- [ ] Activation rate (complete onboarding)
- [ ] Estimates created
- [ ] Payments processed
- [ ] Support tickets

## Support Readiness

- [ ] Set up support@paintflow.app email
- [ ] Create canned responses for common questions
- [ ] Monitor #support channel
- [ ] Prepare refund process

---

## Quick Deploy Commands

**Full deploy:**
```bash
cd ~/workspace/paintflow
pnpm build
pnpm --filter @paintflow/api deploy
pnpm --filter @paintflow/web deploy
```

**Database migration:**
```bash
pnpm db:push
```

**Seed data (optional):**
```bash
pnpm db:seed
```

---

## Emergency Contacts

- Cloudflare Status: https://www.cloudflarestatus.com
- Neon Status: https://status.neon.tech
- Stripe Status: https://status.stripe.com

---

## Go-Live Decision

**Ready to launch when:**
- ✅ All critical paths tested
- ✅ Monitoring configured
- ✅ Support email active
- ✅ Demo video recorded
- ✅ Landing page live
- ✅ Stripe webhooks working
- ✅ Error tracking enabled

**Launch threshold:** 3 successful end-to-end test signups with estimates sent
