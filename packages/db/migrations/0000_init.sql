CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE role AS ENUM ('owner', 'member');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM ('new', 'contacted', 'estimate_sent', 'won', 'lost');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE estimate_status AS ENUM ('draft', 'sent', 'accepted', 'declined');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  org_id UUID NOT NULL REFERENCES organizations(id),
  role role NOT NULL DEFAULT 'member',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  email VARCHAR(255),
  source VARCHAR(100),
  status lead_status NOT NULL DEFAULT 'new',
  qbo_customer_id VARCHAR(50),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  lead_id UUID NOT NULL REFERENCES leads(id),
  packages JSONB NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  status estimate_status NOT NULL DEFAULT 'draft',
  sent_at TIMESTAMP,
  qbo_invoice_id VARCHAR(50),
  qbo_payment_id VARCHAR(50),
  signed_name VARCHAR(255),
  signature_data TEXT,
  signed_at TIMESTAMP,
  signed_ip VARCHAR(45),
  signed_user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

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
