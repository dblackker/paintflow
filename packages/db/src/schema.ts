import { pgTable, uuid, varchar, text, timestamp, decimal, jsonb, pgEnum, boolean, integer } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const roleEnum = pgEnum('role', ['owner', 'member']);
export const leadStatusEnum = pgEnum('lead_status', ['new', 'contacted', 'estimate_sent', 'won', 'lost']);
export const estimateStatusEnum = pgEnum('estimate_status', ['draft', 'sent', 'accepted', 'declined', 'canceled', 'superseded', 'voided']);
export const messageDirectionEnum = pgEnum('message_direction', ['inbound', 'outbound']);

export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const memberships = pgTable('memberships', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  role: roleEnum('role').notNull().default('member'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const leads = pgTable('leads', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  streetAddress: varchar('street_address', { length: 255 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 50 }),
  postalCode: varchar('postal_code', { length: 20 }),
  source: varchar('source', { length: 100 }),
  status: leadStatusEnum('status').notNull().default('new'),
  qboCustomerId: varchar('qbo_customer_id', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const estimates = pgTable('estimates', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  leadId: uuid('lead_id').references(() => leads.id).notNull(),
  streetAddress: varchar('street_address', { length: 255 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 50 }),
  postalCode: varchar('postal_code', { length: 20 }),
  packages: jsonb('packages').notNull(),
  total: decimal('total', { precision: 10, scale: 2 }).notNull(),
  status: estimateStatusEnum('status').notNull().default('draft'),
  sentAt: timestamp('sent_at'),
  qboInvoiceId: varchar('qbo_invoice_id', { length: 50 }),
  qboPaymentId: varchar('qbo_payment_id', { length: 50 }),
  signedName: varchar('signed_name', { length: 255 }),
  signatureData: text('signature_data'),
  signedAt: timestamp('signed_at'),
  signedIp: varchar('signed_ip', { length: 45 }),
  signedUserAgent: text('signed_user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

 
export const jobs = pgTable('jobs', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  leadId: uuid('lead_id').references(() => leads.id).notNull(),
  estimateId: uuid('estimate_id').references(() => estimates.id),
  jobNumber: varchar('job_number', { length: 50 }),
  name: varchar('name', { length: 255 }).notNull(),
  streetAddress: varchar('street_address', { length: 255 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 50 }),
  postalCode: varchar('postal_code', { length: 20 }),
  status: varchar('status', { length: 50 }).notNull().default('scheduled'),
  budget: decimal('budget', { precision: 10, scale: 2 }),
  scheduledStartAt: timestamp('scheduled_start_at'),
  scheduledEndAt: timestamp('scheduled_end_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const activities = pgTable('activities', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  leadId: uuid('lead_id').references(() => leads.id),
  estimateId: uuid('estimate_id').references(() => estimates.id),
  jobId: uuid('job_id').references(() => jobs.id),
  userId: uuid('user_id').references(() => users.id),
  type: varchar('type', { length: 50 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  notes: text('notes'),
  status: varchar('status', { length: 50 }).notNull().default('open'),
  dueAt: timestamp('due_at'),
  completedAt: timestamp('completed_at'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const expenses = pgTable('expenses', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  jobId: uuid('job_id').references(() => jobs.id).notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  category: varchar('category', { length: 100 }),
  description: text('description'),
  receiptUrl: text('receipt_url'),
  date: timestamp('date').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const messages = pgTable('messages', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  leadId: uuid('lead_id').references(() => leads.id),
  direction: messageDirectionEnum('direction').notNull(),
  fromNumber: varchar('from_number', { length: 50 }).notNull(),
  toNumber: varchar('to_number', { length: 50 }).notNull(),
  body: text('body').notNull(),
  twilioSid: varchar('twilio_sid', { length: 100 }),
  read: boolean('read').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const emailTemplates = pgTable('email_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  key: varchar('key', { length: 120 }).notNull(),
  channel: varchar('channel', { length: 50 }).notNull().default('transactional'),
  category: varchar('category', { length: 80 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  subject: varchar('subject', { length: 255 }).notNull(),
  preheader: varchar('preheader', { length: 255 }),
  html: text('html').notNull(),
  text: text('text'),
  mergeFields: jsonb('merge_fields'),
  isActive: boolean('is_active').notNull().default(true),
  isDefault: boolean('is_default').notNull().default(false),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const quickbooksConnections = pgTable('quickbooks_connections', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull().unique(),
  realmId: varchar('realm_id', { length: 255 }).notNull(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  tokenExpiresAt: timestamp('token_expires_at').notNull(),
  companyName: varchar('company_name', { length: 255 }),
  connectedAt: timestamp('connected_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const orgBranding = pgTable('org_branding', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull().unique(),
  logoUrl: text('logo_url'),
  primaryColor: varchar('primary_color', { length: 7 }),
  companyName: varchar('company_name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const googleCalendarConnections = pgTable('google_calendar_connections', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull().unique(),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token').notNull(),
  tokenExpiresAt: timestamp('token_expires_at').notNull(),
  calendarId: varchar('calendar_id', { length: 255 }).notNull().default('primary'),
  connectedAt: timestamp('connected_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const stripeConnections = pgTable('stripe_connections', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull().unique(),
  stripeAccountId: varchar('stripe_account_id', { length: 100 }).notNull().unique(),
  chargesEnabled: boolean('charges_enabled').notNull().default(false),
  payoutsEnabled: boolean('payouts_enabled').notNull().default(false),
  detailsSubmitted: boolean('details_submitted').notNull().default(false),
  onboardingComplete: boolean('onboarding_complete').notNull().default(false),
  connectedAt: timestamp('connected_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const reviewRequests = pgTable('review_requests', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  jobId: uuid('job_id').references(() => jobs.id).notNull(),
  leadId: uuid('lead_id').references(() => leads.id).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('pending'),
  rating: varchar('rating', { length: 10 }),
  reviewUrl: text('review_url'),
  sentAt: timestamp('sent_at'),
  respondedAt: timestamp('responded_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Organization settings
export const orgSettings = pgTable('org_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull().unique(),
  
  // Business info
  companyName: varchar('company_name', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  email: varchar('email', { length: 255 }),
  address: text('address'),
  website: varchar('website', { length: 255 }),
  
  // Pricing
  defaultLaborRate: decimal('default_labor_rate', { precision: 10, scale: 2 }).default('65.00'),
  materialMarkupPercent: decimal('material_markup_percent', { precision: 5, scale: 2 }).default('30.00'),
  salesTaxRate: decimal('sales_tax_rate', { precision: 5, scale: 4 }).default('0.0920'),
  depositPercent: decimal('deposit_percent', { precision: 5, scale: 2 }).default('50.00'),
  qbTaxCode: varchar('qb_tax_code', { length: 50 }),
  qbItemId: varchar('qb_item_id', { length: 50 }),
  
  // Business hours (JSON: { mon: { open: '07:00', close: '17:00', closed: false }, ... })
  businessHours: jsonb('business_hours'),
  
  // Reviews
  googleReviewUrl: text('google_review_url'),
  yelpReviewUrl: text('yelp_review_url'),
  reviewRequestDelayHours: integer('review_request_delay_hours').default(24),
  
  // Estimates
  estimateValidDays: integer('estimate_valid_days').default(30),
  
  // Payment
  paymentTerms: varchar('payment_terms', { length: 255 }).default('Due on completion'),
  acceptChecks: boolean('accept_checks').default(true),
  acceptCash: boolean('accept_cash').default(true),
  
  // Onboarding
  onboardingCompletedAt: timestamp('onboarding_completed_at'),
  
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Service areas
export const serviceAreas = pgTable('service_areas', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  zipCode: varchar('zip_code', { length: 10 }).notNull(),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Team members
// Message templates
export const messageTemplates = pgTable('message_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  type: varchar('type', { length: 50 }).notNull(), // estimate_followup_1, estimate_followup_2, review_request, etc.
  channel: varchar('channel', { length: 20 }).notNull(), // sms, email
  subject: varchar('subject', { length: 255 }),
  body: text('body').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  delayDays: integer('delay_days').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Add onboardingCompletedAt to orgSettings

// Job photos
export const jobPhotos = pgTable('job_photos', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  jobId: uuid('job_id').references(() => jobs.id).notNull(),
  url: text('url').notNull(),
  key: varchar('key', { length: 500 }).notNull(),
  caption: text('caption'),
  type: varchar('type', { length: 50 }).notNull().default('progress'), // before, after, progress
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Change orders
export const changeOrders = pgTable('change_orders', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  jobId: uuid('job_id').references(() => jobs.id).notNull(),
  estimateId: uuid('estimate_id').references(() => estimates.id).notNull(),
  description: text('description').notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('pending'), // pending, approved, rejected, completed
  sentAt: timestamp('sent_at'),
  paymentRequired: boolean('payment_required').notNull().default(false),
  depositPercent: decimal('deposit_percent', { precision: 5, scale: 2 }).notNull().default('100'),
  paymentStatus: varchar('payment_status', { length: 50 }).notNull().default('not_requested'), // not_requested, pending, paid, waived
  paymentDueAmount: decimal('payment_due_amount', { precision: 10, scale: 2 }),
  stripeCheckoutSessionId: varchar('stripe_checkout_session_id', { length: 255 }),
  paidAt: timestamp('paid_at'),
  approvedBy: varchar('approved_by', { length: 255 }),
  signedIp: varchar('signed_ip', { length: 45 }),
  signedUserAgent: text('signed_user_agent'),
  contractorSignature: jsonb('contractor_signature'),
  customerSignatureName: varchar('customer_signature_name', { length: 255 }),
  customerSignatureData: text('customer_signature_data'),
  customerSignedAt: timestamp('customer_signed_at'),
  canceledAt: timestamp('canceled_at'),
  canceledReason: text('canceled_reason'),
  requestedAt: timestamp('requested_at').defaultNow().notNull(),
  approvedAt: timestamp('approved_at'),
  createdBy: varchar('created_by', { length: 100 }).notNull(), // contractor or customer
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const emailSends = pgTable('email_sends', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  leadId: uuid('lead_id').references(() => leads.id),
  estimateId: uuid('estimate_id').references(() => estimates.id),
  jobId: uuid('job_id').references(() => jobs.id),
  changeOrderId: uuid('change_order_id').references(() => changeOrders.id),
  templateKey: varchar('template_key', { length: 120 }).notNull(),
  templateName: varchar('template_name', { length: 255 }).notNull(),
  channel: varchar('channel', { length: 50 }).notNull().default('transactional'),
  toEmail: varchar('to_email', { length: 255 }).notNull(),
  fromEmail: varchar('from_email', { length: 255 }),
  replyTo: varchar('reply_to', { length: 255 }),
  subject: varchar('subject', { length: 255 }).notNull(),
  previewText: varchar('preview_text', { length: 255 }),
  renderedHtml: text('rendered_html').notNull(),
  renderedText: text('rendered_text'),
  status: varchar('status', { length: 50 }).notNull().default('sent'),
  provider: varchar('provider', { length: 50 }),
  providerMessageId: varchar('provider_message_id', { length: 255 }),
  metadata: jsonb('metadata'),
  sentBy: uuid('sent_by').references(() => users.id),
  sentAt: timestamp('sent_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const customerPayments = pgTable('customer_payments', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  leadId: uuid('lead_id').references(() => leads.id).notNull(),
  estimateId: uuid('estimate_id').references(() => estimates.id),
  jobId: uuid('job_id').references(() => jobs.id),
  changeOrderId: uuid('change_order_id').references(() => changeOrders.id),
  source: varchar('source', { length: 50 }).notNull().default('stripe'),
  status: varchar('status', { length: 50 }).notNull().default('succeeded'),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  refundedAmount: decimal('refunded_amount', { precision: 10, scale: 2 }).notNull().default('0'),
  currency: varchar('currency', { length: 10 }).notNull().default('usd'),
  description: text('description'),
  stripeCheckoutSessionId: varchar('stripe_checkout_session_id', { length: 255 }),
  stripePaymentIntentId: varchar('stripe_payment_intent_id', { length: 255 }),
  stripeChargeId: varchar('stripe_charge_id', { length: 255 }),
  stripeRefundId: varchar('stripe_refund_id', { length: 255 }),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
  refundedAt: timestamp('refunded_at'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Lead sources
export const leadSources = pgTable('lead_sources', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  type: varchar('type', { length: 50 }).notNull(), // google_ads, facebook, referral, website, etc.
  cost: decimal('cost', { precision: 10, scale: 2 }).default('0'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Add sourceId to leads
export const leadsEnhanced = pgTable('leads_enhanced', {
  // This would alter leads table
});

// SaaS plans
export const saasPlans = pgTable('saas_plans', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 50 }).notNull(),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  interval: varchar('interval', { length: 20 }).notNull().default('month'),
  features: jsonb('features').notNull(),
  stripePriceId: varchar('stripe_price_id', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Subscriptions
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  planId: uuid('plan_id').references(() => saasPlans.id).notNull(),
  stripeCustomerId: varchar('stripe_customer_id', { length: 100 }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 100 }),
  status: varchar('status', { length: 50 }).notNull().default('trial'), // trial, active, past_due, canceled
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const productionRates = pgTable('production_rates', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  category: varchar('category', { length: 100 }).notNull(), // 'walls', 'ceilings', 'trim', 'cabinets', 'doors'
  surfaceType: varchar('surface_type', { length: 100 }).notNull(), // 'drywall', 'wood', 'metal'
  unit: varchar('unit', { length: 20 }).notNull().default('sqft'), // 'sqft', 'linear_ft', 'each'
  ratePerHour: decimal('rate_per_hour', { precision: 10, scale: 2 }).notNull(), // sq ft per hour
  hourlyRate: decimal('hourly_rate', { precision: 10, scale: 2 }).notNull().default('50.00'),
  prepMultiplier: decimal('prep_multiplier', { precision: 5, scale: 2 }).notNull().default('1.0'), // 1.5 = 50% more time
  coats: integer('coats').notNull().default(2),
  description: text('description'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const estimateRooms = pgTable('estimate_rooms', {
  id: uuid('id').defaultRandom().primaryKey(),
  estimateId: uuid('estimate_id').references(() => estimates.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(), // 'Master Bedroom', 'Kitchen'
  roomType: varchar('room_type', { length: 100 }), // 'bedroom', 'kitchen', 'bathroom'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const estimateRoomItems = pgTable('estimate_room_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  roomId: uuid('room_id').references(() => estimateRooms.id).notNull(),
  productionRateId: uuid('production_rate_id').references(() => productionRates.id),
  category: varchar('category', { length: 100 }).notNull(), // 'walls', 'ceiling', 'trim'
  width: decimal('width', { precision: 10, scale: 2 }), // feet
  height: decimal('height', { precision: 10, scale: 2 }), // feet
  length: decimal('length', { precision: 10, scale: 2 }), // linear feet for trim
  quantity: decimal('quantity', { precision: 10, scale: 2 }).notNull().default('1'), // sq ft or count
  coats: integer('coats').notNull().default(2),
  prepLevel: varchar('prep_level', { length: 50 }).notNull().default('standard'), // 'none', 'light', 'standard', 'heavy'
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const estimatePhotos = pgTable('estimate_photos', {
  id: uuid('id').defaultRandom().primaryKey(),
  estimateId: uuid('estimate_id').references(() => estimates.id).notNull(),
  roomId: uuid('room_id').references(() => estimateRooms.id),
  url: text('url').notNull(),
  annotations: jsonb('annotations'), // [{x, y, text, color}, ...]
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  userId: uuid('user_id').references(() => users.id),
  action: varchar('action', { length: 100 }).notNull(), // 'estimate.signed', 'estimate.sent', etc.
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: uuid('entity_id').notNull(),
  metadata: jsonb('metadata'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const estimateTemplates = pgTable('estimate_templates', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 100 }), // 'room', 'full_estimate', 'package'
  isShared: boolean('is_shared').notNull().default(false), // shared with team
  isSmart: boolean('is_smart').notNull().default(false), // auto-updates rates
  rooms: jsonb('rooms').notNull(), // [{name, roomType, items: [...]}]
  packages: jsonb('packages'), // for full estimate templates
  usageCount: integer('usage_count').notNull().default(0),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const materials = pgTable('materials', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  category: varchar('category', { length: 100 }).notNull(), // 'paint', 'primer', 'supplies'
  brand: varchar('brand', { length: 100 }),
  unit: varchar('unit', { length: 20 }).notNull(), // 'gallon', 'quart', 'each'
  costPerUnit: decimal('cost_per_unit', { precision: 10, scale: 2 }).notNull(),
  markupPercent: decimal('markup_percent', { precision: 5, scale: 2 }).notNull().default('30.00'),
  coverageSqFt: decimal('coverage_sq_ft', { precision: 10, scale: 2 }), // per unit
  supplier: varchar('supplier', { length: 255 }),
  sku: varchar('sku', { length: 100 }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const supplierCatalogSyncRuns = pgTable('supplier_catalog_sync_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id),
  source: text('source').notNull().default('paint_supplier_scraper'),
  status: varchar('status', { length: 40 }).notNull().default('running'),
  suppliers: jsonb('suppliers').notNull().default([]),
  productsUpserted: integer('products_upserted').notNull().default(0),
  colorsUpserted: integer('colors_upserted').notNull().default(0),
  productColorsUpserted: integer('product_colors_upserted').notNull().default(0),
  issues: jsonb('issues').notNull().default([]),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  finishedAt: timestamp('finished_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const supplierCatalogProducts = pgTable('supplier_catalog_products', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id),
  supplierId: varchar('supplier_id', { length: 80 }).notNull(),
  supplierName: varchar('supplier_name', { length: 255 }).notNull(),
  externalId: varchar('external_id', { length: 255 }).notNull(),
  sku: varchar('sku', { length: 120 }),
  name: varchar('name', { length: 255 }).notNull(),
  productLine: varchar('product_line', { length: 255 }),
  type: varchar('type', { length: 60 }).notNull(),
  category: varchar('category', { length: 100 }),
  sheens: jsonb('sheens').notNull().default([]),
  bases: jsonb('bases').notNull().default([]),
  description: text('description'),
  features: jsonb('features').notNull().default([]),
  url: text('url'),
  imageUrl: text('image_url'),
  size: varchar('size', { length: 80 }),
  priceCents: integer('price_cents'),
  currency: varchar('currency', { length: 10 }).notNull().default('USD'),
  pricingTier: varchar('pricing_tier', { length: 80 }).notNull().default('retail'),
  coverageSqFtMin: integer('coverage_sq_ft_min'),
  coverageSqFtMax: integer('coverage_sq_ft_max'),
  isActive: boolean('is_active').notNull().default(true),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const supplierCatalogColors = pgTable('supplier_catalog_colors', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id),
  supplierId: varchar('supplier_id', { length: 80 }).notNull(),
  supplierName: varchar('supplier_name', { length: 255 }).notNull(),
  externalId: varchar('external_id', { length: 255 }).notNull(),
  colorCode: varchar('color_code', { length: 100 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  hexCode: varchar('hex_code', { length: 7 }),
  rgbR: integer('rgb_r'),
  rgbG: integer('rgb_g'),
  rgbB: integer('rgb_b'),
  collection: varchar('collection', { length: 255 }),
  family: varchar('family', { length: 100 }),
  lrv: integer('lrv'),
  isPopular: boolean('is_popular').notNull().default(false),
  isActive: boolean('is_active').notNull().default(true),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const supplierCatalogProductColors = pgTable('supplier_catalog_product_colors', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id),
  productId: uuid('product_id').references(() => supplierCatalogProducts.id).notNull(),
  colorId: uuid('color_id').references(() => supplierCatalogColors.id).notNull(),
  supplierId: varchar('supplier_id', { length: 80 }).notNull(),
  isAvailable: boolean('is_available').notNull().default(true),
  baseRequired: varchar('base_required', { length: 120 }),
  recommendedUse: jsonb('recommended_use').notNull().default([]),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const estimateMaterials = pgTable('estimate_materials', {
  id: uuid('id').defaultRandom().primaryKey(),
  estimateId: uuid('estimate_id').references(() => estimates.id).notNull(),
  materialId: uuid('material_id').references(() => materials.id),
  name: varchar('name', { length: 255 }).notNull(),
  quantity: decimal('quantity', { precision: 10, scale: 2 }).notNull(),
  unit: varchar('unit', { length: 20 }).notNull(),
  costPerUnit: decimal('cost_per_unit', { precision: 10, scale: 2 }).notNull(),
  markupPercent: decimal('markup_percent', { precision: 5, scale: 2 }).notNull(),
  totalCost: decimal('total_cost', { precision: 10, scale: 2 }).notNull(),
  totalPrice: decimal('total_price', { precision: 10, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const materialPurchases = pgTable('material_purchases', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  jobId: uuid('job_id').references(() => jobs.id),
  supplier: varchar('supplier', { length: 255 }).notNull(),
  invoiceNumber: varchar('invoice_number', { length: 100 }),
  invoiceDate: timestamp('invoice_date'),
  documentHash: varchar('document_hash', { length: 64 }),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }),
  fileUrl: text('file_url'), // PDF/CSV
  parsedData: jsonb('parsed_data'), // Line items
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const supplierInvoiceImports = pgTable('supplier_invoice_imports', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  jobId: uuid('job_id').references(() => jobs.id),
  materialPurchaseId: uuid('material_purchase_id').references(() => materialPurchases.id),
  sourceType: varchar('source_type', { length: 50 }).notNull().default('upload'),
  status: varchar('status', { length: 50 }).notNull().default('needs_review'),
  supplier: varchar('supplier', { length: 255 }),
  invoiceNumber: varchar('invoice_number', { length: 100 }),
  invoiceDate: timestamp('invoice_date'),
  senderEmail: varchar('sender_email', { length: 255 }),
  originalFilename: varchar('original_filename', { length: 255 }),
  documentHash: varchar('document_hash', { length: 64 }),
  duplicateOfImportId: uuid('duplicate_of_import_id'),
  rawText: text('raw_text'),
  extractedData: jsonb('extracted_data').notNull().default({}),
  extractedItems: jsonb('extracted_items').notNull().default([]),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull().default('0'),
  matchCandidates: jsonb('match_candidates').notNull().default([]),
  matchConfidence: decimal('match_confidence', { precision: 5, scale: 2 }).notNull().default('0'),
  extractionConfidence: decimal('extraction_confidence', { precision: 5, scale: 2 }).notNull().default('0'),
  reviewNotes: text('review_notes'),
  approvedAt: timestamp('approved_at'),
  rejectedAt: timestamp('rejected_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const supplierInvoiceImportFeedback = pgTable('supplier_invoice_import_feedback', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  importId: uuid('import_id').references(() => supplierInvoiceImports.id).notNull(),
  supplierKey: varchar('supplier_key', { length: 120 }).notNull(),
  supplierName: varchar('supplier_name', { length: 255 }),
  sourceType: varchar('source_type', { length: 50 }).notNull().default('upload'),
  extractionMethod: varchar('extraction_method', { length: 80 }).notNull().default('deterministic_text'),
  outcome: varchar('outcome', { length: 50 }).notNull(),
  suggestedJobId: uuid('suggested_job_id').references(() => jobs.id),
  finalJobId: uuid('final_job_id').references(() => jobs.id),
  matchWasCorrect: boolean('match_was_correct').notNull().default(false),
  hadJobSuggestion: boolean('had_job_suggestion').notNull().default(false),
  matchConfidence: decimal('match_confidence', { precision: 5, scale: 2 }).notNull().default('0'),
  extractionConfidence: decimal('extraction_confidence', { precision: 5, scale: 2 }).notNull().default('0'),
  itemCount: integer('item_count').notNull().default(0),
  totalAmount: decimal('total_amount', { precision: 10, scale: 2 }).notNull().default('0'),
  reviewNotes: text('review_notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const supplierInvoiceLearningStats = pgTable('supplier_invoice_learning_stats', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id),
  supplierKey: varchar('supplier_key', { length: 120 }).notNull(),
  supplierName: varchar('supplier_name', { length: 255 }),
  sourceType: varchar('source_type', { length: 50 }).notNull().default('upload'),
  extractionMethod: varchar('extraction_method', { length: 80 }).notNull().default('deterministic_text'),
  approvedCount: integer('approved_count').notNull().default(0),
  rejectedCount: integer('rejected_count').notNull().default(0),
  correctedJobCount: integer('corrected_job_count').notNull().default(0),
  noJobApprovalCount: integer('no_job_approval_count').notNull().default(0),
  avgMatchConfidence: decimal('avg_match_confidence', { precision: 5, scale: 2 }).notNull().default('0'),
  avgExtractionConfidence: decimal('avg_extraction_confidence', { precision: 5, scale: 2 }).notNull().default('0'),
  hints: jsonb('hints').notNull().default({}),
  lastApprovedAt: timestamp('last_approved_at'),
  lastRejectedAt: timestamp('last_rejected_at'),
  lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const supplierInvoiceSenderRules = pgTable('supplier_invoice_sender_rules', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  supplierKey: varchar('supplier_key', { length: 120 }).notNull(),
  supplierName: varchar('supplier_name', { length: 255 }),
  senderEmail: varchar('sender_email', { length: 255 }).notNull(),
  autoStage: boolean('auto_stage').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const aiUsageEvents = pgTable('ai_usage_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  userId: uuid('user_id').references(() => users.id),
  feature: varchar('feature', { length: 100 }).notNull(),
  provider: varchar('provider', { length: 50 }).notNull().default('openai'),
  model: varchar('model', { length: 120 }),
  entityType: varchar('entity_type', { length: 80 }),
  entityId: uuid('entity_id'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  totalTokens: integer('total_tokens').notNull().default(0),
  estimatedCostUsd: decimal('estimated_cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  metadata: jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const jobCosts = pgTable('job_costs', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobId: uuid('job_id').references(() => jobs.id).notNull(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  category: varchar('category', { length: 50 }).notNull(), // 'labor', 'materials', 'supplies'
  description: varchar('description', { length: 255 }).notNull(),
  quantity: decimal('quantity', { precision: 10, scale: 2 }).notNull(),
  unitCost: decimal('unit_cost', { precision: 10, scale: 2 }).notNull(),
  totalCost: decimal('total_cost', { precision: 10, scale: 2 }).notNull(),
  materialPurchaseId: uuid('material_purchase_id').references(() => materialPurchases.id),
  costDate: timestamp('cost_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const teamMembers = pgTable('team_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  userId: uuid('user_id').references(() => users.id),
  email: varchar('email', { length: 255 }),
  role: varchar('role', { length: 100 }).notNull(), // 'painter', 'foreman', 'helper'
  hourlyRate: decimal('hourly_rate', { precision: 10, scale: 2 }).notNull(),
  burdenRate: decimal('burden_rate', { precision: 5, scale: 2 }).notNull().default('30'), // percent
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const timeEntries = pgTable('time_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobId: uuid('job_id').references(() => jobs.id),
  teamMemberId: uuid('team_member_id').references(() => teamMembers.id).notNull(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  hours: decimal('hours', { precision: 10, scale: 2 }).notNull(),
  date: timestamp('date').notNull(),
  description: text('description'),
  hourlyRate: decimal('hourly_rate', { precision: 10, scale: 2 }).notNull(),
  totalCost: decimal('total_cost', { precision: 10, scale: 2 }).notNull(),
  source: varchar('source', { length: 50 }).notNull().default('manual'),
  reviewStatus: varchar('review_status', { length: 50 }).notNull().default('approved'),
  reviewReason: text('review_reason'),
  actualStartAt: timestamp('actual_start_at'),
  actualEndAt: timestamp('actual_end_at'),
  roundedStartAt: timestamp('rounded_start_at'),
  roundedEndAt: timestamp('rounded_end_at'),
  startLatitude: decimal('start_latitude', { precision: 10, scale: 7 }),
  startLongitude: decimal('start_longitude', { precision: 10, scale: 7 }),
  startAccuracyMeters: decimal('start_accuracy_meters', { precision: 10, scale: 2 }),
  endLatitude: decimal('end_latitude', { precision: 10, scale: 7 }),
  endLongitude: decimal('end_longitude', { precision: 10, scale: 7 }),
  endAccuracyMeters: decimal('end_accuracy_meters', { precision: 10, scale: 2 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const timePunchSessions = pgTable('time_punch_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  jobId: uuid('job_id').references(() => jobs.id),
  teamMemberId: uuid('team_member_id').references(() => teamMembers.id).notNull(),
  timeEntryId: uuid('time_entry_id').references(() => timeEntries.id),
  status: varchar('status', { length: 50 }).notNull().default('active'),
  startedAtActual: timestamp('started_at_actual').notNull(),
  endedAtActual: timestamp('ended_at_actual'),
  startedAtRounded: timestamp('started_at_rounded').notNull(),
  endedAtRounded: timestamp('ended_at_rounded'),
  roundingIncrementMinutes: integer('rounding_increment_minutes').notNull().default(15),
  startLatitude: decimal('start_latitude', { precision: 10, scale: 7 }).notNull(),
  startLongitude: decimal('start_longitude', { precision: 10, scale: 7 }).notNull(),
  startAccuracyMeters: decimal('start_accuracy_meters', { precision: 10, scale: 2 }),
  endLatitude: decimal('end_latitude', { precision: 10, scale: 7 }),
  endLongitude: decimal('end_longitude', { precision: 10, scale: 7 }),
  endAccuracyMeters: decimal('end_accuracy_meters', { precision: 10, scale: 2 }),
  reviewRequired: boolean('review_required').notNull().default(false),
  reviewReason: text('review_reason'),
  crewNote: text('crew_note'),
  reminderSentAt: timestamp('reminder_sent_at'),
  createdByUserId: uuid('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const timePunchEvents = pgTable('time_punch_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  punchSessionId: uuid('punch_session_id').references(() => timePunchSessions.id).notNull(),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  latitude: decimal('latitude', { precision: 10, scale: 7 }),
  longitude: decimal('longitude', { precision: 10, scale: 7 }),
  accuracyMeters: decimal('accuracy_meters', { precision: 10, scale: 2 }),
  occurredAt: timestamp('occurred_at').defaultNow().notNull(),
  metadata: jsonb('metadata'),
});

export const portalTokens = pgTable('portal_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  leadId: uuid('lead_id').references(() => leads.id).notNull(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at').notNull(),
  lastAccessedAt: timestamp('last_accessed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const roles = pgTable('roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  name: varchar('name', { length: 50 }).notNull(), // 'owner', 'admin', 'foreman', 'crew'
  permissions: jsonb('permissions').notNull().default([]), // ['view_reports', 'manage_team', 'log_time_for_others', ...]
  isSystem: boolean('is_system').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const userRoles = pgTable('user_roles', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  roleId: uuid('role_id').references(() => roles.id).notNull(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const notificationEvents = pgTable('notification_events', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  type: varchar('type', { length: 100 }).notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  body: text('body'),
  href: text('href'),
  priority: varchar('priority', { length: 20 }).notNull().default('normal'),
  sourceType: varchar('source_type', { length: 50 }),
  sourceId: uuid('source_id'),
  leadId: uuid('lead_id').references(() => leads.id),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const notificationReads = pgTable('notification_reads', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  userId: uuid('user_id').references(() => users.id),
  notificationId: uuid('notification_id').references(() => notificationEvents.id).notNull(),
  readAt: timestamp('read_at').defaultNow().notNull(),
});

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  userId: uuid('user_id').references(() => users.id),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  disabledAt: timestamp('disabled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  role: one(roles, {
    fields: [userRoles.roleId],
    references: [roles.id],
  }),
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
  organization: one(organizations, {
    fields: [userRoles.orgId],
    references: [organizations.id],
  }),
}));

export const jobAssignments = pgTable('job_assignments', {
  id: uuid('id').defaultRandom().primaryKey(),
  jobId: uuid('job_id').references(() => jobs.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  role: varchar('role', { length: 50 }).notNull(), // 'foreman', 'crew'
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  assignedAt: timestamp('assigned_at').defaultNow().notNull(),
});
