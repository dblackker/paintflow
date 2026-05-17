-- Enable RLS
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY org_isolation ON organizations
  USING (id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY org_isolation ON leads
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY org_isolation ON estimates
  USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- Indexes
CREATE INDEX idx_leads_org_id ON leads(org_id);
CREATE INDEX idx_leads_status ON leads(status);
CREATE INDEX idx_estimates_org_id ON estimates(org_id);
