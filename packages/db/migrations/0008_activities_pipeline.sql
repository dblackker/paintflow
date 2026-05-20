CREATE TABLE IF NOT EXISTS "activities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "lead_id" uuid REFERENCES "leads"("id"),
  "estimate_id" uuid REFERENCES "estimates"("id"),
  "job_id" uuid REFERENCES "jobs"("id"),
  "user_id" uuid REFERENCES "users"("id"),
  "type" varchar(50) NOT NULL,
  "title" varchar(255) NOT NULL,
  "notes" text,
  "status" varchar(50) DEFAULT 'open' NOT NULL,
  "due_at" timestamp,
  "completed_at" timestamp,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "activities_org_due_idx" ON "activities" ("org_id", "due_at");
CREATE INDEX IF NOT EXISTS "activities_org_status_idx" ON "activities" ("org_id", "status");
CREATE INDEX IF NOT EXISTS "activities_lead_idx" ON "activities" ("lead_id");
CREATE INDEX IF NOT EXISTS "activities_estimate_idx" ON "activities" ("estimate_id");
CREATE INDEX IF NOT EXISTS "activities_job_idx" ON "activities" ("job_id");
