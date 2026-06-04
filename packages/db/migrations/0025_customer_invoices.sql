CREATE TABLE IF NOT EXISTS "customer_invoices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "lead_id" uuid NOT NULL REFERENCES "leads"("id"),
  "job_id" uuid REFERENCES "jobs"("id"),
  "invoice_number" varchar(80) NOT NULL,
  "description" text NOT NULL,
  "line_items" jsonb NOT NULL,
  "subtotal" numeric(10, 2) NOT NULL,
  "tax" numeric(10, 2) NOT NULL DEFAULT 0,
  "total" numeric(10, 2) NOT NULL,
  "status" varchar(50) NOT NULL DEFAULT 'sent',
  "due_date" timestamp,
  "due_label" varchar(120),
  "reminder_cadence" varchar(50),
  "tax_rate" numeric(7, 4),
  "tax_override" boolean NOT NULL DEFAULT false,
  "note" text,
  "sent_at" timestamp NOT NULL DEFAULT now(),
  "paid_at" timestamp,
  "voided_at" timestamp,
  "void_reason" text,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_invoices_org_number_idx" ON "customer_invoices" ("org_id", "invoice_number");
CREATE INDEX IF NOT EXISTS "customer_invoices_org_status_idx" ON "customer_invoices" ("org_id", "status", "created_at");
CREATE INDEX IF NOT EXISTS "customer_invoices_lead_idx" ON "customer_invoices" ("lead_id", "created_at");
CREATE INDEX IF NOT EXISTS "customer_invoices_job_idx" ON "customer_invoices" ("job_id", "created_at");

ALTER TABLE "customer_payments" ADD COLUMN IF NOT EXISTS "invoice_id" uuid REFERENCES "customer_invoices"("id");
CREATE INDEX IF NOT EXISTS "customer_payments_invoice_idx" ON "customer_payments" ("invoice_id", "received_at");

ALTER TABLE customer_invoices ENABLE ROW LEVEL SECURITY;
