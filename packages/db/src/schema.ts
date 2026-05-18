import { pgTable, uuid, varchar, text, timestamp, decimal, jsonb, pgEnum, boolean } from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['owner', 'member']);
export const leadStatusEnum = pgEnum('lead_status', ['new', 'contacted', 'estimate_sent', 'won', 'lost']);
export const estimateStatusEnum = pgEnum('estimate_status', ['draft', 'sent', 'accepted', 'declined']);
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
  name: varchar('name', { length: 255 }).notNull(),
  status: varchar('status', { length: 50 }).notNull().default('scheduled'),
  budget: decimal('budget', { precision: 10, scale: 2 }),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const timeEntries = pgTable('time_entries', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  jobId: uuid('job_id').references(() => jobs.id).notNull(),
  userId: uuid('user_id').references(() => users.id).notNull(),
  hours: decimal('hours', { precision: 5, scale: 2 }).notNull(),
  rate: decimal('rate', { precision: 10, scale: 2 }).notNull(),
  cost: decimal('cost', { precision: 10, scale: 2 }).notNull(),
  description: text('description'),
  date: timestamp('date').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
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

export const productionRates = pgTable('production_rates', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  task: varchar('task', { length: 255 }).notNull(),
  unit: varchar('unit', { length: 50 }).notNull(),
  hoursPerUnit: decimal('hours_per_unit', { precision: 10, scale: 3 }).notNull(),
  category: varchar('category', { length: 100 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
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
  paymentTerms: varchar('payment_terms', { length: 50 }).default('Due on completion'),
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
export const teamMembers = pgTable('team_members', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  userId: uuid('user_id').references(() => users.id),
  email: varchar('email', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }),
  role: varchar('role', { length: 50 }).notNull().default('crew'), // owner, admin, estimator, crew
  phone: varchar('phone', { length: 50 }),
  hourlyRate: decimal('hourly_rate', { precision: 10, scale: 2 }),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

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
  requestedAt: timestamp('requested_at').defaultNow().notNull(),
  approvedAt: timestamp('approved_at'),
  createdBy: varchar('created_by', { length: 100 }).notNull(), // contractor or customer
  createdAt: timestamp('created_at').defaultNow().notNull(),
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
