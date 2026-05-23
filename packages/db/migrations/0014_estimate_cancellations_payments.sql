ALTER TYPE estimate_status ADD VALUE IF NOT EXISTS 'canceled';

CREATE TABLE IF NOT EXISTS "customer_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "lead_id" uuid NOT NULL REFERENCES "leads"("id"),
  "estimate_id" uuid REFERENCES "estimates"("id"),
  "job_id" uuid REFERENCES "jobs"("id"),
  "change_order_id" uuid REFERENCES "change_orders"("id"),
  "source" varchar(50) NOT NULL DEFAULT 'stripe',
  "status" varchar(50) NOT NULL DEFAULT 'succeeded',
  "amount" numeric(10, 2) NOT NULL,
  "refunded_amount" numeric(10, 2) NOT NULL DEFAULT 0,
  "currency" varchar(10) NOT NULL DEFAULT 'usd',
  "description" text,
  "stripe_checkout_session_id" varchar(255),
  "stripe_payment_intent_id" varchar(255),
  "stripe_charge_id" varchar(255),
  "stripe_refund_id" varchar(255),
  "received_at" timestamp NOT NULL DEFAULT now(),
  "refunded_at" timestamp,
  "metadata" jsonb,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "customer_payments_org_received_idx" ON "customer_payments" ("org_id", "received_at");
CREATE INDEX IF NOT EXISTS "customer_payments_lead_idx" ON "customer_payments" ("lead_id", "received_at");
CREATE INDEX IF NOT EXISTS "customer_payments_estimate_idx" ON "customer_payments" ("estimate_id", "received_at");
CREATE INDEX IF NOT EXISTS "customer_payments_change_order_idx" ON "customer_payments" ("change_order_id", "received_at");
CREATE UNIQUE INDEX IF NOT EXISTS "customer_payments_stripe_session_idx" ON "customer_payments" ("stripe_checkout_session_id") WHERE "stripe_checkout_session_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "customer_payments_stripe_intent_idx" ON "customer_payments" ("stripe_payment_intent_id") WHERE "stripe_payment_intent_id" IS NOT NULL;

ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;
