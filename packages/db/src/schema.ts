import { pgTable, uuid, text, timestamp, jsonb, pgEnum } from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  plan: text('plan').notNull().default('solo'),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const memberships = pgTable('memberships', {
  userId: uuid('user_id').references(() => users.id).notNull(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  role: text('role').notNull().default('owner'),
});

export const leadStatusEnum = pgEnum('lead_status', ['new','contacted','estimate_sent','won','lost']);

export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  status: leadStatusEnum('status').notNull().default('new'),
  source: text('source'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const estimateStatusEnum = pgEnum('estimate_status', ['draft','sent','viewed','accepted','declined']);

export const estimates = pgTable('estimates', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id).notNull(),
  leadId: uuid('lead_id').references(() => leads.id).notNull(),
  packages: jsonb('packages').notNull(),
  total: text('total'),
  status: estimateStatusEnum('status').notNull().default('draft'),
  sentAt: timestamp('sent_at'),
  acceptedAt: timestamp('accepted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
