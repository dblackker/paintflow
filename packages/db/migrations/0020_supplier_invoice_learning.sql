CREATE TABLE IF NOT EXISTS supplier_invoice_import_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  import_id UUID NOT NULL REFERENCES supplier_invoice_imports(id),
  supplier_key VARCHAR(120) NOT NULL,
  supplier_name VARCHAR(255),
  source_type VARCHAR(50) NOT NULL DEFAULT 'upload',
  extraction_method VARCHAR(80) NOT NULL DEFAULT 'deterministic_text',
  outcome VARCHAR(50) NOT NULL,
  suggested_job_id UUID REFERENCES jobs(id),
  final_job_id UUID REFERENCES jobs(id),
  match_was_correct BOOLEAN NOT NULL DEFAULT false,
  had_job_suggestion BOOLEAN NOT NULL DEFAULT false,
  match_confidence DECIMAL(5,2) NOT NULL DEFAULT '0',
  extraction_confidence DECIMAL(5,2) NOT NULL DEFAULT '0',
  item_count INTEGER NOT NULL DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL DEFAULT '0',
  review_notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS supplier_invoice_learning_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id),
  supplier_key VARCHAR(120) NOT NULL,
  supplier_name VARCHAR(255),
  source_type VARCHAR(50) NOT NULL DEFAULT 'upload',
  extraction_method VARCHAR(80) NOT NULL DEFAULT 'deterministic_text',
  approved_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  corrected_job_count INTEGER NOT NULL DEFAULT 0,
  no_job_approval_count INTEGER NOT NULL DEFAULT 0,
  avg_match_confidence DECIMAL(5,2) NOT NULL DEFAULT '0',
  avg_extraction_confidence DECIMAL(5,2) NOT NULL DEFAULT '0',
  hints JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_approved_at TIMESTAMP,
  last_rejected_at TIMESTAMP,
  last_seen_at TIMESTAMP NOT NULL DEFAULT now(),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supplier_invoice_feedback_org_supplier_idx ON supplier_invoice_import_feedback (org_id, supplier_key, created_at DESC);
CREATE INDEX IF NOT EXISTS supplier_invoice_feedback_import_idx ON supplier_invoice_import_feedback (import_id);
CREATE UNIQUE INDEX IF NOT EXISTS supplier_invoice_learning_global_key_idx ON supplier_invoice_learning_stats (supplier_key, source_type, extraction_method) WHERE org_id IS NULL;
CREATE INDEX IF NOT EXISTS supplier_invoice_learning_org_key_idx ON supplier_invoice_learning_stats (org_id, supplier_key, source_type, extraction_method);

ALTER TABLE supplier_invoice_import_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoice_learning_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY supplier_invoice_feedback_isolation ON supplier_invoice_import_feedback
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY supplier_invoice_learning_global_or_org ON supplier_invoice_learning_stats
  USING (org_id IS NULL OR org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id IS NULL OR org_id = current_setting('app.current_org_id', true)::uuid);
