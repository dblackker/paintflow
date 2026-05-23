CREATE TABLE IF NOT EXISTS "email_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "key" varchar(120) NOT NULL,
  "channel" varchar(50) NOT NULL DEFAULT 'transactional',
  "category" varchar(80) NOT NULL,
  "name" varchar(255) NOT NULL,
  "description" text,
  "subject" varchar(255) NOT NULL,
  "preheader" varchar(255),
  "html" text NOT NULL,
  "text" text,
  "merge_fields" jsonb,
  "is_active" boolean NOT NULL DEFAULT true,
  "is_default" boolean NOT NULL DEFAULT false,
  "created_by" uuid REFERENCES "users"("id"),
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_templates_org_key_idx" ON "email_templates" ("org_id", "key");
CREATE INDEX IF NOT EXISTS "email_templates_org_category_idx" ON "email_templates" ("org_id", "category", "is_active");

CREATE TABLE IF NOT EXISTS "email_sends" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "lead_id" uuid REFERENCES "leads"("id"),
  "estimate_id" uuid REFERENCES "estimates"("id"),
  "job_id" uuid REFERENCES "jobs"("id"),
  "change_order_id" uuid REFERENCES "change_orders"("id"),
  "template_key" varchar(120) NOT NULL,
  "template_name" varchar(255) NOT NULL,
  "channel" varchar(50) NOT NULL DEFAULT 'transactional',
  "to_email" varchar(255) NOT NULL,
  "from_email" varchar(255),
  "reply_to" varchar(255),
  "subject" varchar(255) NOT NULL,
  "preview_text" varchar(255),
  "rendered_html" text NOT NULL,
  "rendered_text" text,
  "status" varchar(50) NOT NULL DEFAULT 'sent',
  "provider" varchar(50),
  "provider_message_id" varchar(255),
  "metadata" jsonb,
  "sent_by" uuid REFERENCES "users"("id"),
  "sent_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "email_sends_org_sent_idx" ON "email_sends" ("org_id", "sent_at");
CREATE INDEX IF NOT EXISTS "email_sends_lead_idx" ON "email_sends" ("lead_id", "sent_at");
CREATE INDEX IF NOT EXISTS "email_sends_estimate_idx" ON "email_sends" ("estimate_id", "sent_at");
CREATE INDEX IF NOT EXISTS "email_sends_change_order_idx" ON "email_sends" ("change_order_id", "sent_at");
