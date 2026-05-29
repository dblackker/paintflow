# Crewmodo Feature Set

## Current Implementation Status

**Last updated:** May 2026  
**Version:** 1.0 (React migration complete)

---

## Core Features

### ✅ Estimates

**Status:** Fully implemented

**Capabilities:**
- Create estimates with line items
- Add photos (before/after)
- Customer information management
- Pricing calculations (labor + materials + markup)
- Professional PDF generation
- Email/text delivery to customers
- Status tracking (Draft → Sent → Approved → Converted)
- Estimate templates for common jobs
- Duplicate estimates
- Version history

**What's shown publicly:** Full workflow in videos
**What's kept private:** Specific pricing algorithms, advanced template logic

---

### ✅ Jobs / Projects

**Status:** Fully implemented

**Capabilities:**
- Convert estimates to jobs
- Job details and scope
- Status tracking (Scheduled → In Progress → Completed)
- Photo documentation
- Time tracking
- Material usage tracking
- Crew assignment
- Customer communication log

**What's shown publicly:** Basic job creation and tracking
**What's kept private:** Advanced reporting, custom workflows

---

### ✅ Leads / CRM

**Status:** Fully implemented

**Capabilities:**
- Lead capture (manual entry, website form)
- Lead sources tracking
- Pipeline stages (New → Contacted → Estimate Sent → Won/Lost)
- Contact management
- Communication history
- Follow-up reminders
- Lead scoring

**What's shown publicly:** Lead pipeline overview
**What's kept private:** Advanced automation rules, lead scoring algorithm

---

### ✅ Invoicing & Payments

**Status:** Fully implemented

**Capabilities:**
- Create invoices from jobs
- Online payment processing (Stripe)
- Payment plans
- Automated payment reminders
- Partial payments
- Deposits
- Payment history
- Receipt generation

**What's shown publicly:** Basic invoicing workflow
**What's kept private:** Dunning management logic, retry algorithms

---

### ✅ Calendar & Scheduling

**Status:** Fully implemented

**Capabilities:**
- Job scheduling
- Crew assignment
- Calendar views (day/week/month)
- Google Calendar sync (2-way)
- Drag-and-drop rescheduling
- Color coding by status/crew
- Mobile access

**What's shown publicly:** Basic scheduling
**What's kept private:** Optimization algorithms, conflict detection

---

### ✅ Team Management

**Status:** Fully implemented

**Capabilities:**
- Invite team members
- Role-based permissions (Owner, Admin, Foreman, Crew)
- User profiles
- Activity tracking
- Performance metrics

**What's shown publicly:** Basic team features
**What's kept private:** Advanced permission system details

---

### ✅ Mobile App

**Status:** Fully implemented

**Capabilities:**
- iOS and Android (PWA)
- Photo upload from job site
- Create estimates on-site
- View schedule
- Clock in/out
- Offline mode (syncs when online)
- Push notifications

**What's shown publicly:** Mobile workflows in videos
**What's kept private:** Offline sync implementation details

---

### ✅ Customer Portal

**Status:** Fully implemented

**Capabilities:**
- Branded portal for customers
- View estimates and invoices
- Approve estimates online
- Make payments
- View job progress/photos
- Message contractor
- No login required (magic links)

**What's shown publicly:** Customer experience
**What's kept private:** Security implementation

---

### ✅ Reporting & Analytics

**Status:** Fully implemented

**Capabilities:**
- Dashboard with key metrics
- Revenue reports
- Job profitability
- Lead source ROI
- Crew performance
- Production rates
- Custom date ranges
- Export to CSV

**What's shown publicly:** Basic dashboard
**What's kept private:** Advanced analytics, predictive features

---

## Painting-Specific Features

### ✅ Production Rates

**Status:** Fully implemented

**Capabilities:**
- Set production rates by surface type
  - Walls (sq ft/hour)
  - Ceilings
  - Trim/doors
  - Cabinets
- Track actual vs estimated
- Improve estimates over time
- Crew-specific rates

**What's shown publicly:** Concept and basic usage
**What's kept private:** Rate optimization algorithms

---

### ✅ Paint Inventory Tracking

**Status:** Fully implemented

**Capabilities:**
- Track paint usage per job
- Low stock alerts
- Supplier integration (Sherwin-Williams, Benjamin Moore, PPG)
- Real-time pricing from suppliers
- Color library management
- Product-color compatibility

**What's shown publicly:** Basic inventory tracking
**What's kept private:** Supplier API integrations, scraper details

---

### ✅ Photo Management

**Status:** Fully implemented

**Capabilities:**
- Before/after photos
- Progress photos
- Organized by job
- Annotations/markup
- Share with customers
- Cloud storage

**What's shown publicly:** Photo workflows
**What's kept private:** Storage optimization, compression algorithms

---

## Advanced Features

### ✅ Automation

**Status:** Fully implemented

**Capabilities:**
- Automated follow-up sequences
- Estimate reminders
- Review requests
- Birthday/anniversary messages
- Drip campaigns
- Trigger-based actions

**What's shown publicly:** Basic automation examples
**What's kept private:** Advanced workflow builder details

---

### ✅ Recurring Jobs

**Status:** Fully implemented

**Capabilities:**
- Set up maintenance contracts
- Auto-generate invoices
- Customer self-scheduling
- Recurring revenue tracking

**What's shown publicly:** Concept
**What's kept private:** Implementation details

---

### ✅ Review Management

**Status:** Fully implemented

**Capabilities:**
- Automated review requests
- Google Business integration
- Response templates
- Review monitoring
- Reputation tracking

**What's shown publicly:** Basic feature
**What's kept private:** Timing optimization algorithms

---

## Integrations

### ✅ Implemented

**Accounting:**
- QuickBooks Online (two-way sync)
- Export to CSV for others

**Payments:**
- Stripe (credit cards, ACH)
- Payment links

**Calendar:**
- Google Calendar (2-way sync)
- iCal export

**Communication:**
- SMS via Twilio
- Email via MailChannels
- Push notifications

**Storage:**
- Cloudflare R2 (photos, documents)

**What's shown publicly:** Integration list
**What's kept private:** API implementation details

---

## Technical Features

### ✅ Security

**Status:** Fully implemented

**Capabilities:**
- Magic link authentication (no passwords)
- Role-based access control
- Data encryption at rest and in transit
- SOC 2 compliant infrastructure
- Regular backups
- Audit logs

**What's shown publicly:** Security overview
**What's kept private:** Specific implementation details

---

### ✅ Multi-tenant Architecture

**Status:** Fully implemented

**Capabilities:**
- Complete data isolation per company
- Custom branding
- White-label options (Enterprise)
- Scalable infrastructure

**What's shown publicly:** High-level architecture
**What's kept private:** Database schema, infrastructure details

---

### ✅ API

**Status:** Fully implemented

**Capabilities:**
- RESTful API
- Webhook support
- API keys for integrations
- Rate limiting
- Comprehensive documentation

**What's shown publicly:** API exists
**What's kept private:** Documentation is gated (customers only)

---

## What We DON'T Show Publicly

### Competitive Moat Features (Keep Private):

1. **Paint Supplier Scraper**
   - Real-time pricing from SW/BM/PPG
   - Product-color compatibility
   - Proprietary implementation

2. **Advanced Pricing Algorithms**
   - Dynamic pricing suggestions
   - Market rate analysis
   - Profit optimization

3. **AI Features** (Future)
   - Estimate generation from photos
   - Lead scoring
   - Churn prediction

4. **Internal Tools**
   - Admin dashboard
   - Customer health scores
   - Usage analytics

5. **Roadmap**
   - Upcoming features
   - Release dates
   - Strategic plans

---

## Public Feature Communication Strategy

### Landing Page / Marketing:
- ✅ Show: Core workflows, benefits, social proof
- ✅ Show: Screenshots of key screens (estimates, dashboard)
- ❌ Don't show: Advanced settings, API docs, pricing algorithms

### Help Videos:
- ✅ Show: How to use features
- ✅ Show: Best practices
- ❌ Don't show: Workarounds for edge cases, internal processes

### Sales Process:
- ✅ Show: Interactive demo environment
- ✅ Show: Feature comparison charts
- ✅ Show: ROI calculator
- ❌ Don't show: Live customer data, internal metrics

### Customer Onboarding:
- ✅ Show: Everything - they're paying customers
- ✅ Provide: Full documentation, API access, advanced training

---

## Feature Request Backlog (Public-Facing)

**We publicly track top requests:**
- QuickBooks sync (47 votes)
- Spanish language (14 votes)
- Crew scheduling calendar (9 votes)

**We don't publicly show:**
- Exact implementation details
- Release dates (until confirmed)
- Internal priority scores

---

## Competitive Positioning

### vs Jobber:
**We highlight:**
- Painting-specific features they lack
- Better mobile experience
- More affordable for small teams

**We don't mention:**
- Their larger user base
- Their longer track record

### vs ServiceTitan:
**We highlight:**
- 80% cheaper
- No contracts
- Easier to use
- Built for painters, not all trades

**We don't mention:**
- They have more features overall
- They have bigger customers

### vs QuoteIQ:
**We highlight:**
- Better UX (React vs their stack)
- Open API
- Modern tech

**We don't mention:**
- They have more painting-specific features currently

---

## Feature Release Communication

### When releasing new features:

**Public announcement:**
- Blog post
- Email to all users
- Social media
- Help center article
- In-app notification

**What to include:**
- What the feature does
- Why it matters (benefit)
- How to use it (link to video)
- Who it's for (plan tier)

**What NOT to include:**
- Technical implementation details
- Why it took so long
- What we had to deprioritize
- Internal debates

---

## Customer Feedback Loop

### How we decide what to build:

1. **Parker AI analyzes:**
   - Support tickets
   - Feature requests
   - Usage data
   - Churn reasons

2. **Scores using RICE:**
   - Reach, Impact, Confidence, Effort

3. **Prioritizes:**
   - Top 3 per quarter
   - Mix of big bets and quick wins

4. **Builds:**
   - With customer feedback loop
   - Beta test with design partners

5. **Launches:**
   - With documentation
   - With video tutorial
   - With email announcement

6. **Measures:**
   - Adoption rate
   - Impact on retention
   - Customer feedback

---

## Summary

**Publicly visible:** ~70% of features (core workflows)
**Gated for customers:** ~25% (advanced features)
**Completely private:** ~5% (competitive moat)

**Philosophy:** Be transparent about what we do, but don't hand competitors a roadmap. Show enough to build trust and enable self-service, but keep strategic advantages private.

**The balance:** If a prospect needs to see it to buy, show it. If it's a "nice to know" for competitors, keep it private.

---

**Last updated:** May 2026  
**Next review:** August 2026