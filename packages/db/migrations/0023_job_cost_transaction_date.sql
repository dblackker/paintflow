ALTER TABLE job_costs
  ADD COLUMN IF NOT EXISTS cost_date TIMESTAMP;

UPDATE job_costs
SET cost_date = created_at
WHERE cost_date IS NULL;

CREATE INDEX IF NOT EXISTS job_costs_org_cost_date_idx
  ON job_costs (org_id, cost_date DESC);
