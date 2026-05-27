CREATE TABLE IF NOT EXISTS supplier_invoice_sender_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  supplier_key VARCHAR(120) NOT NULL,
  supplier_name VARCHAR(255),
  sender_email VARCHAR(255) NOT NULL,
  auto_stage BOOLEAN NOT NULL DEFAULT true,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_sender_rules_unique_idx
  ON supplier_invoice_sender_rules (org_id, lower(sender_email), supplier_key);
CREATE INDEX IF NOT EXISTS supplier_invoice_sender_rules_org_active_idx
  ON supplier_invoice_sender_rules (org_id, is_active, updated_at DESC);

ALTER TABLE supplier_invoice_sender_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY supplier_invoice_sender_rules_isolation ON supplier_invoice_sender_rules
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);
