# Crewmodo Deployment Checklist

## Pre-Deployment

### 1. Environment Setup
- [ ] Create Neon Postgres database (production)
- [ ] Run `pnpm db:migrate` to apply migrations
- [ ] Set Cloudflare environment variables:
  ```
  DATABASE_URL=postgresql://...
  APP_URL=https://api.crewmodo.com
  PUBLIC_URL=https://app.crewmodo.com
  PUBLIC_API_URL=https://api.crewmodo.com
  CORS_ORIGINS=https://app.crewmodo.com,https://crewmodo.com
  COOKIE_DOMAIN=.crewmodo.com
  ENVIRONMENT=production
  SESSION_SECRET=...
  CRON_SECRET=...
  STRIPE_SECRET_KEY=sk_live_...
  STRIPE_WEBHOOK_SECRET=whsec_...
  STRIPE_STARTER_PRICE_ID=price_...
  STRIPE_PRO_PRICE_ID=price_...
  STRIPE_ENTERPRISE_PRICE_ID=price_...
  RESEND_API_KEY=re_...
  GOOGLE_CLIENT_ID=...
  GOOGLE_CLIENT_SECRET=...
  QB_CLIENT_ID=...
  QB_CLIENT_SECRET=...
  ```
- [ ] Configure Cloudflare Workers:
  - [ ] Create KV namespace `CREWMODO_SESSIONS`
  - [ ] Bind KV to api worker
  - [ ] Set compatibility_date = "2024-01-01"
  - [ ] Confirm scheduled trigger is active for daily drip and review automations

### 2. DNS Configuration
- [ ] Add CNAME: `app.crewmodo.com` → `crewmodo.workers.dev`
- [ ] Add MailChannels DNS:
  ```
  _mailchannels.crewmodo.com TXT "v=mc1 cfid=crewmodo.workers.dev"
  ```
- [ ] Verify DNS propagation

### 3. Stripe Setup
- [ ] Switch to live mode
- [ ] Create products:
  - Starter: $49/month
  - Pro: $149/month
  - Enterprise: $399/month
- [ ] Configure webhook endpoint:
  - URL: `https://api.crewmodo.com/v1/billing/webhook`
  - Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- [ ] Copy webhook secret to env

### 4. QuickBooks (Optional for launch)
- [ ] Register app at developer.intuit.com
- [ ] Set redirect URI: `https://api.crewmodo.com/v1/quickbooks/callback`
- [ ] Get production Client ID/Secret
- [ ] Add to env vars

### 5. Google Calendar Setup
- [ ] Create OAuth client in Google Cloud Console
- [ ] Set redirect URI: `https://api.crewmodo.com/v1/calendar/callback`
- [ ] Add production Client ID/Secret to env vars

## Deployment

### 6. Deploy API
```bash
cd apps/api
wrangler deploy --env production
```

### 7. Deploy Web
```bash
cd apps/web
pnpm build
wrangler pages deploy dist --project-name=crewmodo
```

### 8. Verify Deployment
- [ ] https://app.crewmodo.com loads
- [ ] https://api.crewmodo.com/health returns `status: ok`
- [ ] Landing page displays
- [ ] Sign up flow works (magic link email sent)
- [ ] Dashboard loads
- [ ] Create estimate flow works
- [ ] Calendar drag-drop works
- [ ] Settings page loads

## Post-Deployment

### 9. Test Critical Paths
- [ ] **Signup:** New user → onboarding → dashboard
- [ ] **Auth:** Magic link → session persists
- [ ] **Estimate:** Create → send → e-sign
- [ ] **Payment:** Stripe checkout completes
- [ ] **Calendar:** Drag job → Google sync
- [ ] **Mobile:** Bottom nav works, PWA installable

### 10. Monitoring
- [ ] Set up Cloudflare Analytics
- [ ] Configure error tracking (Sentry optional)
- [ ] Set up uptime monitoring
- [ ] Create status page

### 11. Documentation
- [ ] Update README with production URL
- [ ] Record demo video (use script)
- [ ] Publish help docs
- [ ] Create onboarding email sequence

### 12. Launch
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

- [ ] Set up support@crewmodo.com email
- [ ] Create canned responses for common questions
- [ ] Monitor #support channel
- [ ] Prepare refund process

---

## Quick Deploy Commands

**Full deploy:**
```bash
cd ~/workspace/crewmodo
pnpm build
pnpm --filter @crewmodo/api deploy
pnpm --filter @crewmodo/web deploy
```

**Database migration:**
```bash
pnpm db:migrate
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
