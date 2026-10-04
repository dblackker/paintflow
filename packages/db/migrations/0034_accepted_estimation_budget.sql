ALTER TABLE jobs ADD COLUMN estimation_budget JSONB;
ALTER TABLE estimates ADD COLUMN acceptance_snapshot JSONB;
ALTER TABLE estimates ADD COLUMN proposal_terms_snapshot JSONB;

CREATE FUNCTION reset_unsigned_proposal_terms() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.signed_at IS NULL AND (NEW.packages IS DISTINCT FROM OLD.packages OR NEW.total IS DISTINCT FROM OLD.total
    OR NEW.lead_id IS DISTINCT FROM OLD.lead_id OR NEW.street_address IS DISTINCT FROM OLD.street_address
    OR NEW.city IS DISTINCT FROM OLD.city OR NEW.state IS DISTINCT FROM OLD.state OR NEW.postal_code IS DISTINCT FROM OLD.postal_code) THEN
    NEW.proposal_terms_snapshot := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER estimates_reset_unsigned_terms BEFORE UPDATE ON estimates FOR EACH ROW EXECUTE FUNCTION reset_unsigned_proposal_terms();
--> statement-breakpoint
CREATE TABLE accepted_estimate_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  estimate_id UUID NOT NULL REFERENCES estimates(id),
  invoice_id UUID NOT NULL REFERENCES customer_invoices(id),
  portal_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','needs_attention')),
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ,
  last_error TEXT,
  prepared_email JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  UNIQUE (org_id, estimate_id)
);
CREATE UNIQUE INDEX accepted_estimates_org_identity ON estimates(org_id,id);
CREATE UNIQUE INDEX accepted_invoices_org_identity ON customer_invoices(org_id,id);
ALTER TABLE accepted_estimate_deliveries ADD CONSTRAINT accepted_delivery_estimate_tenant FOREIGN KEY (org_id,estimate_id) REFERENCES estimates(org_id,id);
ALTER TABLE accepted_estimate_deliveries ADD CONSTRAINT accepted_delivery_invoice_tenant FOREIGN KEY (org_id,invoice_id) REFERENCES customer_invoices(org_id,id);
CREATE INDEX accepted_estimate_deliveries_pending ON accepted_estimate_deliveries(status,created_at);
CREATE UNIQUE INDEX accepted_delivery_email_log_once ON email_sends(org_id,(metadata->>'deliveryKey'))
  WHERE metadata->>'deliveryKey' LIKE 'accepted-estimate/%';
ALTER TABLE accepted_estimate_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY accepted_estimate_delivery_tenant ON accepted_estimate_deliveries USING (org_id = current_setting('app.current_org_id',true)::uuid);
--> statement-breakpoint
CREATE FUNCTION preserve_accepted_estimation_budget() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.estimation_budget IS NOT NULL AND NEW.estimation_budget IS DISTINCT FROM OLD.estimation_budget THEN
    RAISE EXCEPTION 'Accepted budgets are immutable. Record an approved change order budget delta.' USING ERRCODE='P0409';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_preserve_estimation_budget BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION preserve_accepted_estimation_budget();
--> statement-breakpoint
CREATE FUNCTION accept_estimate_budget(
  p_org UUID, p_id UUID, p_key TEXT, p_expected TIMESTAMP, p_request JSONB, p_payload JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  v_estimate estimates%ROWTYPE;
  v_job jobs%ROWTYPE;
  v_invoice customer_invoices%ROWTYPE;
  v_operation operation_results%ROWTYPE;
  v_result JSONB;
  v_delivery UUID;
  v_portal UUID;
BEGIN
  IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'An approval key is required.' USING ERRCODE='P0400'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('estimate-accept:' || p_org::text || ':' || p_id::text,0));
  SELECT * INTO v_operation FROM operation_results WHERE org_id=p_org AND actor=p_id::text AND action='estimate.accept' AND operation_key=p_key;
  IF FOUND THEN
    IF v_operation.request <> p_request THEN RAISE EXCEPTION 'This approval key was used for different details.' USING ERRCODE='P0409'; END IF;
    RETURN v_operation.result || '{"replayed":true}'::jsonb;
  END IF;
  SELECT * INTO v_estimate FROM estimates WHERE id=p_id AND org_id=p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Estimate not found.' USING ERRCODE='P0404'; END IF;
  IF v_estimate.status <> 'sent' OR v_estimate.signed_at IS NOT NULL OR p_expected IS NULL OR date_trunc('milliseconds',v_estimate.updated_at) <> p_expected THEN
    RAISE EXCEPTION 'This proposal changed or was already signed. Reload it before signing.' USING ERRCODE='P0409';
  END IF;
  IF v_estimate.proposal_terms_snapshot IS NOT NULL AND v_estimate.proposal_terms_snapshot IS DISTINCT FROM p_payload->'reviewedTerms' THEN
    RAISE EXCEPTION 'The reviewed proposal terms changed. Reload it before signing.' USING ERRCODE='P0409';
  END IF;
  IF p_payload ? 'reviewedPackages' AND v_estimate.packages IS DISTINCT FROM p_payload->'reviewedPackages' THEN
    RAISE EXCEPTION 'The reviewed proposal scope changed. Reload it before signing.' USING ERRCODE='P0409';
  END IF;
  IF p_payload ? 'reviewedJobsite' AND jsonb_build_object('leadId',v_estimate.lead_id,'streetAddress',v_estimate.street_address,
    'city',v_estimate.city,'state',v_estimate.state,'postalCode',v_estimate.postal_code) IS DISTINCT FROM p_payload->'reviewedJobsite' THEN
    RAISE EXCEPTION 'The reviewed jobsite changed. Reload it before signing.' USING ERRCODE='P0409';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM leads WHERE id=v_estimate.lead_id AND org_id=p_org) THEN RAISE EXCEPTION 'Customer not found.' USING ERRCODE='P0404'; END IF;
  UPDATE estimates SET status='accepted', signed_name=p_payload->>'signedName', signature_data=p_payload->>'signatureData',
    signed_at=now(),signed_ip=p_payload->>'ip',signed_user_agent=p_payload->>'userAgent',acceptance_snapshot=p_payload->'acceptance',updated_at=now()
    WHERE id=p_id AND org_id=p_org RETURNING * INTO v_estimate;
  SELECT * INTO v_job FROM jobs WHERE estimate_id=p_id AND org_id=p_org ORDER BY created_at LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO jobs (org_id,lead_id,estimate_id,job_number,name,street_address,city,state,postal_code,status,budget,estimation_budget)
      VALUES (p_org,v_estimate.lead_id,p_id,p_payload->>'jobNumber',p_payload->>'jobName',v_estimate.street_address,
        v_estimate.city,v_estimate.state,v_estimate.postal_code,CASE WHEN p_payload->'deposit' IS NOT NULL AND p_payload->'deposit' <> 'null'::jsonb THEN 'deposit_pending' ELSE 'needs_scheduling' END,
        (p_payload->>'contractValue')::numeric,p_payload->'budget') RETURNING * INTO v_job;
  ELSIF v_job.estimation_budget IS NULL THEN
    UPDATE jobs SET estimation_budget=p_payload->'budget' WHERE id=v_job.id AND org_id=p_org RETURNING * INTO v_job;
  END IF;
  IF p_payload->'deposit' IS NOT NULL AND p_payload->'deposit' <> 'null'::jsonb THEN
    SELECT * INTO v_invoice FROM customer_invoices WHERE org_id=p_org AND estimate_id=p_id AND invoice_number=p_payload->'deposit'->>'invoiceNumber';
    IF NOT FOUND THEN
      INSERT INTO customer_invoices (org_id,lead_id,estimate_id,job_id,invoice_number,description,line_items,subtotal,tax,total,status,due_label,reminder_cadence,note)
        VALUES (p_org,v_estimate.lead_id,p_id,v_job.id,p_payload->'deposit'->>'invoiceNumber',p_payload->'deposit'->>'description',
          p_payload->'deposit'->'lineItems',(p_payload->'deposit'->>'amount')::numeric,0,(p_payload->'deposit'->>'amount')::numeric,
          'sent',p_payload->'deposit'->>'dueLabel','due_date','Generated from the signed payment schedule.') RETURNING * INTO v_invoice;
      INSERT INTO audit_logs (org_id,action,entity_type,entity_id,metadata) VALUES (p_org,'invoice.deposit_created','invoice',v_invoice.id,
        jsonb_build_object('estimateId',p_id,'jobId',v_job.id,'amountDue',v_invoice.total));
    END IF;
  END IF;
  INSERT INTO portal_tokens (org_id,lead_id,token,expires_at) VALUES (p_org,v_estimate.lead_id,p_payload->>'portalToken',now()+interval '30 days') RETURNING id INTO v_portal;
  IF v_invoice.id IS NOT NULL THEN
    INSERT INTO accepted_estimate_deliveries (org_id,estimate_id,invoice_id,portal_url) VALUES (p_org,p_id,v_invoice.id,p_payload->>'portalUrl') RETURNING id INTO v_delivery;
  END IF;
  UPDATE leads SET status='won',updated_at=now() WHERE id=v_estimate.lead_id AND org_id=p_org;
  INSERT INTO audit_logs (org_id,action,entity_type,entity_id,metadata,ip_address,user_agent)
    VALUES (p_org,'estimate.signed','estimate',p_id,(p_payload->'audit') || jsonb_build_object('jobId',v_job.id,'depositInvoiceId',v_invoice.id,'portalUrl',p_payload->>'portalUrl'),p_payload->>'ip',p_payload->>'userAgent');
  v_result := jsonb_build_object('id',p_id,'status','accepted','signedAt',v_estimate.signed_at,'jobId',v_job.id,'depositInvoiceId',v_invoice.id,
    'portalUrl',p_payload->>'portalUrl','awaitingPayment',v_invoice.id IS NOT NULL,'deliveryId',v_delivery,'replayed',false);
  INSERT INTO operation_results (org_id,action,actor,operation_key,request,result) VALUES (p_org,'estimate.accept',p_id::text,p_key,p_request,v_result);
  RETURN v_result;
END $$;
--> statement-breakpoint
-- Preserve historical values while storing the resolver's exact fractional rates.
ALTER TABLE customer_invoices ALTER COLUMN tax_rate TYPE NUMERIC(11,8);
