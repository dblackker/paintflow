CREATE TABLE IF NOT EXISTS stripe_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) UNIQUE,
  stripe_account_id VARCHAR(100) NOT NULL UNIQUE,
  charges_enabled BOOLEAN NOT NULL DEFAULT false,
  payouts_enabled BOOLEAN NOT NULL DEFAULT false,
  details_submitted BOOLEAN NOT NULL DEFAULT false,
  onboarding_complete BOOLEAN NOT NULL DEFAULT false,
  connected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE stripe_connections ENABLE ROW LEVEL SECURITY;
