ALTER TABLE jobs ADD COLUMN IF NOT EXISTS job_number VARCHAR(50);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS street_address VARCHAR(255);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS state VARCHAR(50);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS street_address VARCHAR(255);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS state VARCHAR(50);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20);

UPDATE jobs
SET
  job_number = COALESCE(job_number, 'JOB-' || UPPER(SUBSTRING(jobs.id::text, 1, 8))),
  street_address = COALESCE(jobs.street_address, leads.street_address),
  city = COALESCE(jobs.city, leads.city),
  state = COALESCE(jobs.state, leads.state),
  postal_code = COALESCE(jobs.postal_code, leads.postal_code)
FROM leads
WHERE jobs.lead_id = leads.id;

UPDATE estimates
SET
  street_address = COALESCE(estimates.street_address, leads.street_address),
  city = COALESCE(estimates.city, leads.city),
  state = COALESCE(estimates.state, leads.state),
  postal_code = COALESCE(estimates.postal_code, leads.postal_code)
FROM leads
WHERE estimates.lead_id = leads.id;

CREATE INDEX IF NOT EXISTS jobs_org_job_number_idx ON jobs (org_id, job_number);
