CREATE TABLE IF NOT EXISTS supplier_invoice_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  job_id UUID REFERENCES jobs(id),
  material_purchase_id UUID REFERENCES material_purchases(id),
  source_type VARCHAR(50) NOT NULL DEFAULT 'upload',
  status VARCHAR(50) NOT NULL DEFAULT 'needs_review',
  supplier VARCHAR(255),
  invoice_number VARCHAR(100),
  invoice_date TIMESTAMP,
  sender_email VARCHAR(255),
  original_filename VARCHAR(255),
  raw_text TEXT,
  extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  extracted_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT '0',
  match_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  match_confidence DECIMAL(5,2) NOT NULL DEFAULT '0',
  extraction_confidence DECIMAL(5,2) NOT NULL DEFAULT '0',
  review_notes TEXT,
  approved_at TIMESTAMP,
  rejected_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_invoice_imports_org_status_idx ON supplier_invoice_imports (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS supplier_invoice_imports_job_idx ON supplier_invoice_imports (job_id);

ALTER TABLE supplier_invoice_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY supplier_invoice_imports_isolation ON supplier_invoice_imports
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);
