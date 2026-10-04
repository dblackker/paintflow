CREATE TABLE operation_results (
  org_id UUID NOT NULL REFERENCES organizations(id),
  action VARCHAR(100) NOT NULL,
  actor VARCHAR(120) NOT NULL,
  operation_key VARCHAR(200) NOT NULL,
  request JSONB NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, action, actor, operation_key)
);
--> statement-breakpoint
CREATE TABLE supplier_document_claims (
  org_id UUID NOT NULL REFERENCES organizations(id),
  document_hash VARCHAR(64) NOT NULL,
  token UUID NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'processing',
  reserved_usd NUMERIC(10,6) NOT NULL DEFAULT 0 CHECK (reserved_usd >= 0),
  actual_usd NUMERIC(10,6),
  parsed JSONB,
  import_id UUID REFERENCES supplier_invoice_imports(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, document_hash),
  CHECK (status IN ('processing', 'extracted', 'staged', 'unknown'))
);
CREATE INDEX supplier_document_claims_usage_idx ON supplier_document_claims (org_id, created_at);
--> statement-breakpoint
CREATE TABLE material_price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  material_id UUID NOT NULL REFERENCES materials(id),
  import_id UUID NOT NULL REFERENCES supplier_invoice_imports(id),
  line_index INTEGER NOT NULL,
  unit VARCHAR(20) NOT NULL,
  cost_per_unit NUMERIC(10,2) NOT NULL,
  transaction_date TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (org_id, import_id, line_index)
);
CREATE INDEX material_price_history_material_idx ON material_price_history (org_id, material_id, transaction_date DESC);
--> statement-breakpoint
ALTER TABLE operation_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY operation_results_isolation ON operation_results
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);
ALTER TABLE supplier_document_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY supplier_document_claims_isolation ON supplier_document_claims
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);
ALTER TABLE material_price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY material_price_history_isolation ON material_price_history
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);
--> statement-breakpoint
-- A single database call is atomic with Neon HTTP; sequential HTTP calls are not.
CREATE FUNCTION approve_supplier_import(
  p_org UUID, p_import UUID, p_job UUID, p_apply BOOLEAN,
  p_notes TEXT, p_actor TEXT, p_key TEXT, p_request JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_import supplier_invoice_imports%ROWTYPE;
  v_purchase material_purchases%ROWTYPE;
  v_operation operation_results%ROWTYPE;
  v_material materials%ROWTYPE;
  v_item JSONB;
  v_index INTEGER := 0;
  v_name TEXT;
  v_description TEXT;
  v_supplier TEXT;
  v_sku TEXT;
  v_unit TEXT;
  v_quantity NUMERIC;
  v_cost NUMERIC;
  v_stock_cost NUMERIC;
  v_total NUMERIC;
  v_pack_gallons NUMERIC;
  v_cost_date TIMESTAMP;
  v_result JSONB;
BEGIN
  IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'An operation key is required.' USING ERRCODE = 'P0400';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('supplier:' || p_org::text, 0));
  SELECT * INTO v_operation FROM operation_results
    WHERE org_id = p_org AND action = 'supplier.approve' AND actor = p_actor AND operation_key = p_key;
  IF FOUND THEN
    IF v_operation.request <> p_request THEN
      RAISE EXCEPTION 'This operation key was already used for different details.' USING ERRCODE = 'P0409';
    END IF;
    RETURN v_operation.result || '{"replayed":true}'::jsonb;
  END IF;
  SELECT * INTO v_import FROM supplier_invoice_imports WHERE id = p_import AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier invoice not found.' USING ERRCODE = 'P0404'; END IF;
  IF NOT EXISTS (SELECT 1 FROM jobs WHERE id = p_job AND org_id = p_org) THEN
    RAISE EXCEPTION 'Select a job in this workspace.' USING ERRCODE = 'P0404';
  END IF;
  IF v_import.status = 'approved' THEN
    IF v_import.job_id <> p_job THEN
      RAISE EXCEPTION 'This invoice was approved for another job. Open its purchase to review.' USING ERRCODE = 'P0409';
    END IF;
    SELECT * INTO v_purchase FROM material_purchases WHERE id = v_import.material_purchase_id AND org_id = p_org;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'This historical approval needs reconciliation before retrying.' USING ERRCODE = 'P0409';
    END IF;
    RETURN jsonb_build_object('import', to_jsonb(v_import), 'purchase', to_jsonb(v_purchase), 'replayed', true);
  END IF;
  IF v_import.status <> 'needs_review' THEN
    RAISE EXCEPTION 'This invoice is no longer waiting for review. Refresh the list.' USING ERRCODE = 'P0409';
  END IF;
  IF (nullif(v_import.extracted_data->>'possibleDuplicatePurchaseId', '') IS NOT NULL OR EXISTS (
    SELECT 1 FROM material_purchases purchase WHERE purchase.org_id = p_org
      AND lower(trim(purchase.supplier)) = lower(trim(v_import.supplier))
      AND ((nullif(trim(v_import.invoice_number), '') IS NOT NULL
        AND lower(trim(purchase.invoice_number)) = lower(trim(v_import.invoice_number))) OR EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_import.extracted_items) incoming
          WHERE nullif(trim(incoming->>'sourceInvoiceNumber'), '') IS NOT NULL AND
            (lower(trim(purchase.invoice_number)) = lower(trim(incoming->>'sourceInvoiceNumber')) OR EXISTS (
              SELECT 1 FROM jsonb_array_elements(coalesce(purchase.parsed_data, '[]'::jsonb)) previous
              WHERE lower(trim(previous->>'sourceInvoiceNumber')) = lower(trim(incoming->>'sourceInvoiceNumber'))
            ))
        ))
  ))
    AND coalesce((p_request->>'confirmSimilarPurchase')::boolean, false) = false THEN
    RAISE EXCEPTION 'A purchase has the same invoice number. Confirm these are separate purchases before approving.' USING ERRCODE = 'P0409';
  END IF;
  IF v_import.document_hash IS NOT NULL AND EXISTS (
    SELECT 1 FROM material_purchases WHERE org_id = p_org AND document_hash = v_import.document_hash
  ) THEN
    RAISE EXCEPTION 'This document already has a supplier purchase. Open Supplier purchases.' USING ERRCODE = 'P0409';
  END IF;
  IF jsonb_typeof(v_import.extracted_items) <> 'array' OR jsonb_array_length(v_import.extracted_items) = 0 THEN
    RAISE EXCEPTION 'This invoice has no extracted items to approve.' USING ERRCODE = 'P0400';
  END IF;
  IF v_import.extracted_data->'documentReconciliation'->>'status' = 'mismatch' OR
    (v_import.extracted_data->'documentReconciliation'->>'required' = 'true' AND
      v_import.extracted_data->'documentReconciliation'->>'status' IS DISTINCT FROM 'matched') THEN
    RAISE EXCEPTION 'Invoice charge totals could not be reconciled. Compare the original file and upload a complete invoice before approving.' USING ERRCODE = 'P0409';
  END IF;
  IF v_import.total_amount IS DISTINCT FROM (
    SELECT sum(round(coalesce(nullif(line->>'total', '')::numeric,
      coalesce(nullif(line->>'quantity', '')::numeric, 1) * coalesce(nullif(line->>'unitCost', '')::numeric, 0)), 2))
    FROM jsonb_array_elements(v_import.extracted_items) AS line
  ) THEN
    RAISE EXCEPTION 'Invoice lines do not reconcile to the staged purchase total. Review this document before approval.' USING ERRCODE = 'P0409';
  END IF;
  v_supplier := coalesce(v_import.supplier, 'Unknown supplier');
  INSERT INTO material_purchases (org_id, job_id, supplier, invoice_number, invoice_date, document_hash, total_amount, file_url, parsed_data)
    VALUES (p_org, p_job, v_supplier, v_import.invoice_number, v_import.invoice_date, v_import.document_hash,
      v_import.total_amount,
      CASE WHEN v_import.extracted_data->>'storedInR2' = 'true' AND v_import.extracted_data->>'fileKey' IS NOT NULL
        THEN '/v1/invoices/imports/' || v_import.id || '/file' ELSE NULL END, v_import.extracted_items)
    RETURNING * INTO v_purchase;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_import.extracted_items) LOOP
    v_description := left(coalesce(nullif(v_item->>'description', ''), v_item->>'productName', 'Supplier invoice item'), 255);
    v_name := left(coalesce(nullif(v_item->>'productName', ''), v_description), 255);
    v_sku := nullif(trim(v_item->>'sku'), '');
    v_quantity := coalesce(nullif(v_item->>'quantity', '')::numeric, 1);
    v_cost := coalesce(nullif(v_item->>'unitCost', '')::numeric, 0);
    v_total := coalesce(nullif(v_item->>'total', '')::numeric, v_quantity * v_cost);
    v_cost_date := coalesce(nullif(v_item->>'purchaseDate', '')::timestamp, v_import.invoice_date, v_import.created_at);
    v_unit := CASE WHEN lower(v_item->>'size') ~ '^5[ -]*(gal|gallon)' THEN '5 gallon'
      WHEN lower(v_item->>'size') ~ '(quart|qt)' THEN 'quart'
      WHEN coalesce(nullif(v_item->>'gallons', '')::numeric, 0) > 0 THEN 'gallon' ELSE 'each' END;
    v_stock_cost := CASE WHEN v_unit = 'gallon' THEN
      v_total / (v_item->>'gallons')::numeric ELSE CASE WHEN v_quantity <> 0 THEN v_total / v_quantity ELSE v_cost END END;
    -- Credits/returns remain costs, but cannot rewrite the pricebook with a negative price.
    IF p_apply AND coalesce((v_item->>'isFee')::boolean, false) = false AND v_quantity > 0 AND v_total > 0 AND v_stock_cost >= 0 THEN
      SELECT * INTO v_material FROM materials WHERE org_id = p_org
        AND lower(trim(supplier)) = lower(trim(v_supplier))
        AND ((v_sku IS NOT NULL AND sku = v_sku) OR (v_sku IS NULL AND lower(trim(name)) = lower(trim(v_name))))
        ORDER BY updated_at DESC, id LIMIT 1;
      IF NOT FOUND THEN
        INSERT INTO materials (org_id, name, category, unit, cost_per_unit, supplier, sku)
          VALUES (p_org, v_name, CASE WHEN v_unit = 'gallon' THEN 'paint' ELSE 'supplies' END, v_unit, round(v_stock_cost, 2), v_supplier, v_sku)
          RETURNING * INTO v_material;
      ELSIF NOT EXISTS (SELECT 1 FROM material_price_history WHERE org_id = p_org AND material_id = v_material.id AND transaction_date > v_cost_date) THEN
        -- Existing coverage is per pack. Never silently change a five-gallon SKU to a one-gallon unit.
        v_pack_gallons := CASE lower(trim(v_material.unit)) WHEN '5 gallon' THEN 5 WHEN '5-gallon' THEN 5
          WHEN '5 gal' THEN 5 WHEN 'quart' THEN 0.25 WHEN 'qt' THEN 0.25
          WHEN 'gallon' THEN 1 WHEN 'gal' THEN 1 ELSE NULL END;
        IF v_pack_gallons IS NOT NULL AND coalesce(nullif(v_item->>'gallons', '')::numeric, 0) > 0 THEN
          v_unit := v_material.unit;
          v_stock_cost := v_total / (v_item->>'gallons')::numeric * v_pack_gallons;
        END IF;
        UPDATE materials SET cost_per_unit = round(v_stock_cost, 2), unit = v_unit, updated_at = now()
          WHERE id = v_material.id AND org_id = p_org;
      END IF;
      INSERT INTO material_price_history (org_id, material_id, import_id, line_index, unit, cost_per_unit, transaction_date)
        VALUES (p_org, v_material.id, p_import, v_index, v_unit, round(v_stock_cost, 2), v_cost_date);
    END IF;
    INSERT INTO job_costs (org_id, job_id, category, description, quantity, unit_cost, total_cost, material_purchase_id, cost_date)
      VALUES (p_org, p_job, coalesce(nullif(v_item->>'category', ''), 'materials'), v_description,
        v_quantity, round(v_cost, 2), round(v_total, 2), v_purchase.id, v_cost_date);
    v_index := v_index + 1;
  END LOOP;
  UPDATE supplier_invoice_imports SET status = 'approved', job_id = p_job, material_purchase_id = v_purchase.id,
    review_notes = coalesce(p_notes, review_notes), approved_at = now(), updated_at = now()
    WHERE id = p_import AND org_id = p_org RETURNING * INTO v_import;
  v_result := jsonb_build_object('import', to_jsonb(v_import), 'purchase', to_jsonb(v_purchase), 'replayed', false);
  INSERT INTO operation_results (org_id, action, actor, operation_key, request, result)
    VALUES (p_org, 'supplier.approve', p_actor, p_key, p_request, v_result);
  RETURN v_result;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION reserve_supplier_ocr(
  p_org UUID, p_hash TEXT, p_token UUID, p_reserve NUMERIC,
  p_burst INTEGER, p_daily INTEGER, p_monthly INTEGER, p_budget NUMERIC
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_claim supplier_document_claims%ROWTYPE;
  v_existing UUID;
  v_daily INTEGER;
  v_monthly INTEGER;
  v_burst INTEGER;
  v_spend NUMERIC;
BEGIN
  IF p_reserve <= 0 OR p_burst <= 0 OR p_daily <= 0 OR p_monthly <= 0 OR p_budget <= 0 THEN
    RAISE EXCEPTION 'OCR allowance is unavailable.' USING ERRCODE = 'P0429';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('supplier:' || p_org::text, 0));
  SELECT id INTO v_existing FROM supplier_invoice_imports WHERE org_id = p_org AND document_hash = p_hash ORDER BY created_at, id LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('state', 'duplicate', 'importId', v_existing); END IF;
  SELECT * INTO v_claim FROM supplier_document_claims WHERE org_id = p_org AND document_hash = p_hash;
  IF FOUND THEN
    IF v_claim.status = 'extracted' THEN RETURN jsonb_build_object('state', 'extracted', 'parsed', v_claim.parsed, 'token', v_claim.token); END IF;
    RETURN jsonb_build_object('state', CASE WHEN v_claim.status = 'processing' AND v_claim.updated_at > now() - interval '3 minutes'
      THEN 'processing' ELSE 'unknown' END);
  END IF;
  SELECT count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),
    count(*) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'),
    count(*) FILTER (WHERE created_at >= now() - interval '1 minute'),
    coalesce(sum(coalesce(actual_usd, reserved_usd)) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0)
    INTO v_daily, v_monthly, v_burst, v_spend FROM supplier_document_claims WHERE org_id = p_org;
  -- Older completed usage is included during the transition to reservations.
  SELECT v_daily + count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')),
    v_monthly + count(*), v_spend + coalesce(sum(estimated_cost_usd), 0)
    INTO v_daily, v_monthly, v_spend FROM ai_usage_events
    WHERE org_id = p_org AND feature = 'supplier_invoice_ocr'
      AND created_at >= date_trunc('month', now() AT TIME ZONE 'UTC')
      AND NOT (metadata ? 'reservationToken');
  IF v_burst >= p_burst OR v_daily >= p_daily OR v_monthly >= p_monthly OR v_spend + p_reserve > p_budget THEN
    RAISE EXCEPTION 'OCR allowance reached. Try later or review your plan limits.' USING ERRCODE = 'P0429';
  END IF;
  INSERT INTO supplier_document_claims (org_id, document_hash, token, reserved_usd) VALUES (p_org, p_hash, p_token, p_reserve);
  RETURN jsonb_build_object('state', 'reserved', 'token', p_token);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION stage_supplier_import(p_org UUID, p_payload JSONB, p_user UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_import supplier_invoice_imports%ROWTYPE;
  v_claim supplier_document_claims%ROWTYPE;
  v_hash TEXT := p_payload->>'documentHash';
  v_usage JSONB := p_payload->'extractedData'->'aiUsage';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('supplier:' || p_org::text, 0));
  SELECT * INTO v_import FROM supplier_invoice_imports WHERE org_id = p_org AND document_hash = v_hash ORDER BY created_at, id LIMIT 1;
  IF FOUND THEN RETURN jsonb_build_object('import', to_jsonb(v_import), 'replayed', true); END IF;
  IF EXISTS (SELECT 1 FROM material_purchases WHERE org_id = p_org AND document_hash = v_hash) THEN
    RAISE EXCEPTION 'This document already has a supplier purchase.' USING ERRCODE = 'P0409';
  END IF;
  IF nullif(p_payload->>'jobId', '') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jobs WHERE org_id = p_org AND id = (p_payload->>'jobId')::uuid
  ) THEN RAISE EXCEPTION 'Selected job was not found.' USING ERRCODE = 'P0404'; END IF;
  SELECT * INTO v_claim FROM supplier_document_claims WHERE org_id = p_org AND document_hash = v_hash;
  IF FOUND AND (v_claim.status <> 'extracted' OR v_claim.token::text <> p_payload->'extractedData'->>'reservationToken') THEN
    RAISE EXCEPTION 'This document is still being processed. Retry after processing completes.' USING ERRCODE = 'P0409';
  END IF;
  INSERT INTO supplier_invoice_imports (org_id, job_id, source_type, supplier, invoice_number, invoice_date,
    sender_email, original_filename, document_hash, raw_text, extracted_data, extracted_items, total_amount,
    match_candidates, match_confidence, extraction_confidence)
  VALUES (p_org, nullif(p_payload->>'jobId', '')::uuid, p_payload->>'sourceType',
    p_payload->>'supplier', p_payload->>'invoiceNumber', nullif(p_payload->>'invoiceDate', '')::timestamp,
    p_payload->>'senderEmail', p_payload->>'originalFilename', v_hash, p_payload->>'rawText',
    p_payload->'extractedData', p_payload->'extractedItems', (p_payload->>'totalAmount')::numeric,
    p_payload->'matchCandidates', (p_payload->>'matchConfidence')::numeric, (p_payload->>'extractionConfidence')::numeric)
  RETURNING * INTO v_import;
  IF v_usage IS NOT NULL AND v_usage <> 'null'::jsonb THEN
    INSERT INTO ai_usage_events (org_id, user_id, feature, provider, model, entity_type, entity_id,
      input_tokens, output_tokens, total_tokens, estimated_cost_usd, metadata)
    VALUES (p_org, p_user, 'supplier_invoice_ocr', 'openai', v_usage->>'model', 'supplier_invoice_import', v_import.id,
      (v_usage->>'inputTokens')::integer, (v_usage->>'outputTokens')::integer, (v_usage->>'totalTokens')::integer,
      (v_usage->>'estimatedCostUsd')::numeric,
      jsonb_build_object('sourceType', p_payload->>'sourceType', 'reservationToken', v_claim.token));
  END IF;
  UPDATE supplier_document_claims SET status = 'staged', import_id = v_import.id, updated_at = now()
    WHERE org_id = p_org AND document_hash = v_hash AND token = v_claim.token;
  RETURN jsonb_build_object('import', to_jsonb(v_import), 'replayed', false);
END;
$$;
