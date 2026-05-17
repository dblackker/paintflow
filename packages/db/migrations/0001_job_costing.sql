-- Migration: Add job costing tables

CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  lead_id UUID NOT NULL REFERENCES leads(id),
  estimate_id UUID REFERENCES estimates(id),
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'scheduled',
  budget DECIMAL(10,2),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  user_id UUID NOT NULL REFERENCES users(id),
  hours DECIMAL(5,2) NOT NULL,
  rate DECIMAL(10,2) NOT NULL,
  cost DECIMAL(10,2) NOT NULL,
  description TEXT,
  date TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  amount DECIMAL(10,2) NOT NULL,
  category VARCHAR(100),
  description TEXT,
  receipt_url TEXT,
  date TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_jobs_org_id ON jobs(org_id);
CREATE INDEX idx_time_entries_job_id ON time_entries(job_id);
CREATE INDEX idx_expenses_job_id ON expenses(job_id);

-- RLS Policies
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY jobs_isolation ON jobs
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY time_entries_isolation ON time_entries
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY expenses_isolation ON expenses
  USING (org_id = current_setting('app.current_org_id', true)::uuid);
