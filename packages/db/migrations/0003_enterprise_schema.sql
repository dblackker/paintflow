-- Align production schema with the application tables used by API routes.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  user_id UUID REFERENCES users(id),
  email VARCHAR(255),
  role VARCHAR(100) NOT NULL,
  hourly_rate DECIMAL(10,2) NOT NULL,
  burden_rate DECIMAL(5,2) NOT NULL DEFAULT 30,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS team_member_id UUID REFERENCES team_members(id);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(10,2);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS total_cost DECIMAL(10,2);
ALTER TABLE time_entries ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE time_entries ALTER COLUMN rate DROP NOT NULL;
ALTER TABLE time_entries ALTER COLUMN cost DROP NOT NULL;
ALTER TABLE time_entries ALTER COLUMN hours TYPE DECIMAL(10,2);

CREATE TABLE IF NOT EXISTS quickbooks_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES organizations(id),
  realm_id VARCHAR(255) NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMP NOT NULL,
  company_name VARCHAR(255),
  connected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS production_rates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  category VARCHAR(100) NOT NULL,
  surface_type VARCHAR(100) NOT NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'sqft',
  rate_per_hour DECIMAL(10,2) NOT NULL,
  hourly_rate DECIMAL(10,2) NOT NULL DEFAULT 50,
  prep_multiplier DECIMAL(5,2) NOT NULL DEFAULT 1.0,
  coats INTEGER NOT NULL DEFAULT 2,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS org_branding (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES organizations(id),
  logo_url TEXT,
  primary_color VARCHAR(7),
  company_name VARCHAR(255),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS google_calendar_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES organizations(id),
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMP NOT NULL,
  calendar_id VARCHAR(255) NOT NULL DEFAULT 'primary',
  connected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  lead_id UUID NOT NULL REFERENCES leads(id),
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  rating VARCHAR(10),
  review_url TEXT,
  sent_at TIMESTAMP,
  responded_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS org_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL UNIQUE REFERENCES organizations(id),
  company_name VARCHAR(255),
  phone VARCHAR(50),
  email VARCHAR(255),
  address TEXT,
  website VARCHAR(255),
  default_labor_rate DECIMAL(10,2) DEFAULT 65.00,
  material_markup_percent DECIMAL(5,2) DEFAULT 30.00,
  sales_tax_rate DECIMAL(5,4) DEFAULT 0.0920,
  deposit_percent DECIMAL(5,2) DEFAULT 50.00,
  qb_tax_code VARCHAR(50),
  qb_item_id VARCHAR(50),
  business_hours JSONB,
  google_review_url TEXT,
  yelp_review_url TEXT,
  review_request_delay_hours INTEGER DEFAULT 24,
  estimate_valid_days INTEGER DEFAULT 30,
  payment_terms VARCHAR(50) DEFAULT 'Due on completion',
  accept_checks BOOLEAN DEFAULT true,
  accept_cash BOOLEAN DEFAULT true,
  onboarding_completed_at TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS service_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  zip_code VARCHAR(10) NOT NULL,
  city VARCHAR(100),
  state VARCHAR(2),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  type VARCHAR(50) NOT NULL,
  channel VARCHAR(20) NOT NULL,
  subject VARCHAR(255),
  body TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  delay_days INTEGER DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  url TEXT NOT NULL,
  key VARCHAR(500) NOT NULL,
  caption TEXT,
  type VARCHAR(50) NOT NULL DEFAULT 'progress',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS change_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  estimate_id UUID NOT NULL REFERENCES estimates(id),
  description TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending',
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMP,
  created_by VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lead_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL,
  cost DECIMAL(10,2) DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saas_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(50) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  interval VARCHAR(20) NOT NULL DEFAULT 'month',
  features JSONB NOT NULL,
  stripe_price_id VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  plan_id UUID NOT NULL REFERENCES saas_plans(id),
  stripe_customer_id VARCHAR(100),
  stripe_subscription_id VARCHAR(100),
  status VARCHAR(50) NOT NULL DEFAULT 'trial',
  current_period_start TIMESTAMP,
  current_period_end TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS estimate_rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id),
  name VARCHAR(255) NOT NULL,
  room_type VARCHAR(100),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS estimate_room_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id UUID NOT NULL REFERENCES estimate_rooms(id),
  production_rate_id UUID REFERENCES production_rates(id),
  category VARCHAR(100) NOT NULL,
  width DECIMAL(10,2),
  height DECIMAL(10,2),
  length DECIMAL(10,2),
  quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
  coats INTEGER NOT NULL DEFAULT 2,
  prep_level VARCHAR(50) NOT NULL DEFAULT 'standard',
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS estimate_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id),
  room_id UUID REFERENCES estimate_rooms(id),
  url TEXT NOT NULL,
  annotations JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,
  metadata JSONB,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS estimate_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  is_shared BOOLEAN NOT NULL DEFAULT false,
  is_smart BOOLEAN NOT NULL DEFAULT false,
  rooms JSONB NOT NULL,
  packages JSONB,
  usage_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) NOT NULL,
  brand VARCHAR(100),
  unit VARCHAR(20) NOT NULL,
  cost_per_unit DECIMAL(10,2) NOT NULL,
  markup_percent DECIMAL(5,2) NOT NULL DEFAULT 30.00,
  coverage_sq_ft DECIMAL(10,2),
  supplier VARCHAR(255),
  sku VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS estimate_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES estimates(id),
  material_id UUID REFERENCES materials(id),
  name VARCHAR(255) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  cost_per_unit DECIMAL(10,2) NOT NULL,
  markup_percent DECIMAL(5,2) NOT NULL,
  total_cost DECIMAL(10,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS material_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  job_id UUID REFERENCES jobs(id),
  supplier VARCHAR(255) NOT NULL,
  invoice_number VARCHAR(100),
  invoice_date TIMESTAMP,
  total_amount DECIMAL(10,2),
  file_url TEXT,
  parsed_data JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  org_id UUID NOT NULL REFERENCES organizations(id),
  category VARCHAR(50) NOT NULL,
  description VARCHAR(255) NOT NULL,
  quantity DECIMAL(10,2) NOT NULL,
  unit_cost DECIMAL(10,2) NOT NULL,
  total_cost DECIMAL(10,2) NOT NULL,
  material_purchase_id UUID REFERENCES material_purchases(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portal_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id),
  org_id UUID NOT NULL REFERENCES organizations(id),
  token VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  last_accessed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  name VARCHAR(50) NOT NULL,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_system BOOLEAN DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  org_id UUID NOT NULL REFERENCES organizations(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS job_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  user_id UUID NOT NULL REFERENCES users(id),
  role VARCHAR(50) NOT NULL,
  org_id UUID NOT NULL REFERENCES organizations(id),
  assigned_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_members_org_id ON team_members(org_id);
CREATE INDEX IF NOT EXISTS idx_review_requests_org_id ON review_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_token ON portal_tokens(token);
CREATE INDEX IF NOT EXISTS idx_job_costs_job_id ON job_costs(job_id);
CREATE INDEX IF NOT EXISTS idx_materials_org_id ON materials(org_id);

ALTER TABLE quickbooks_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_branding ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_room_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_assignments ENABLE ROW LEVEL SECURITY;
