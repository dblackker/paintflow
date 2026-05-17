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
  createdAt: timestamp('created_at').defaultNow().notNull(),
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

export const orgSettings = pgTable('org_settings', {
  id: uuid('id').defaultRandom().primaryKey(),
  orgId: uuid('org_id').references(() => organizations.id).notNull().unique(),
  qbTaxCode: varchar('qb_tax_code', { length: 50 }),
  qbItemId: varchar('qb_item_id', { length: 50 }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
