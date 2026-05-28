ALTER TABLE material_purchases
  ADD COLUMN IF NOT EXISTS document_hash VARCHAR(64);

ALTER TABLE supplier_invoice_imports
  ADD COLUMN IF NOT EXISTS document_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS duplicate_of_import_id UUID REFERENCES supplier_invoice_imports(id);

CREATE INDEX IF NOT EXISTS material_purchases_org_document_hash_idx
  ON material_purchases (org_id, document_hash)
  WHERE document_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS material_purchases_org_supplier_invoice_idx
  ON material_purchases (org_id, supplier, invoice_number)
  WHERE invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS supplier_invoice_imports_org_document_hash_idx
  ON supplier_invoice_imports (org_id, document_hash)
  WHERE document_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS supplier_invoice_imports_org_supplier_invoice_idx
  ON supplier_invoice_imports (org_id, supplier, invoice_number)
  WHERE invoice_number IS NOT NULL;
