-- Additive only: historical totals/refunds are not reclassified or backfilled.
CREATE TABLE payment_refund_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  payment_id UUID NOT NULL REFERENCES customer_payments(id),
  actor_id UUID NOT NULL REFERENCES users(id),
  operation_key VARCHAR(200) NOT NULL,
  request JSONB NOT NULL,
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  source VARCHAR(50) NOT NULL,
  disposition VARCHAR(20) NOT NULL DEFAULT 'credit' CHECK (disposition = 'credit'),
  reason TEXT NOT NULL,
  method VARCHAR(50) NOT NULL,
  reference VARCHAR(120),
  effective_at TIMESTAMPTZ NOT NULL,
  state VARCHAR(20) NOT NULL CHECK (state IN ('reserved','pending','unknown','succeeded','failed','canceled')),
  provider_key VARCHAR(120) NOT NULL UNIQUE,
  provider_refund_id VARCHAR(255),
  provider_account_id VARCHAR(100),
  provider_livemode BOOLEAN,
  provider_payment_intent_id VARCHAR(255),
  provider_charge_id VARCHAR(255),
  settlement_evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, actor_id, operation_key)
);
CREATE UNIQUE INDEX payment_refund_provider_id_idx ON payment_refund_operations (provider_refund_id)
  WHERE provider_refund_id IS NOT NULL;
CREATE UNIQUE INDEX payment_refund_active_idx ON payment_refund_operations (org_id, payment_id)
  WHERE state IN ('reserved','pending','unknown');
CREATE INDEX payment_refund_history_idx ON payment_refund_operations (org_id, payment_id, created_at);
ALTER TABLE payment_refund_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY payment_refund_operations_isolation ON payment_refund_operations
  USING (org_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.current_org_id', true)::uuid);
--> statement-breakpoint
CREATE FUNCTION payment_refund_history_needs_review(p_metadata JSONB)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
  SELECT coalesce(p_metadata->>'lastRefundStatus' IN ('reserved','pending','unknown','requires_action','processing'),false)
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_metadata->'refundHistory') = 'array'
        THEN p_metadata->'refundHistory' ELSE '[]'::jsonb END) AS history(entry)
      WHERE coalesce(entry->>'status','unknown') NOT IN ('failed','canceled')
        AND (entry->>'disposition' IS DISTINCT FROM 'credit' OR nullif(entry->>'operationId','') IS NULL))
$$;
--> statement-breakpoint
-- Credits offset refunded allocations, not signed face values. Legacy refunds with no
-- recorded disposition fail closed until reviewed; they are never silently credited.
CREATE FUNCTION payment_obligation_balance(p_org UUID, p_invoice UUID, p_estimate UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_total NUMERIC; v_status TEXT; v_gross NUMERIC; v_refunded NUMERIC; v_credits NUMERIC;
  v_pending INTEGER; v_review BOOLEAN; v_closed BOOLEAN; v_signed_total TEXT;
BEGIN
  IF (p_invoice IS NULL) = (p_estimate IS NULL) THEN
    RAISE EXCEPTION 'Select one payment obligation.' USING ERRCODE = 'P0400';
  END IF;
  IF p_invoice IS NOT NULL THEN
    SELECT total, status INTO v_total, v_status FROM customer_invoices WHERE id = p_invoice AND org_id = p_org;
  ELSE
    SELECT total, status::text INTO v_total, v_status FROM estimates WHERE id = p_estimate AND org_id = p_org;
    SELECT metadata->>'contractValue' INTO v_signed_total FROM audit_logs
      WHERE org_id = p_org AND entity_id = p_estimate AND entity_type = 'estimate'
        AND action = 'estimate.signed' ORDER BY created_at DESC, id DESC LIMIT 1;
    IF v_signed_total IS NOT NULL THEN
      IF v_signed_total !~ '^[0-9]+(\.[0-9]{1,2})?$' THEN
        RAISE EXCEPTION 'The signed balance needs review.' USING ERRCODE = 'P0409';
      END IF;
      v_total := v_signed_total::numeric;
    END IF;
  END IF;
  IF v_total IS NULL THEN RAISE EXCEPTION 'Payment obligation not found.' USING ERRCODE = 'P0404'; END IF;
  SELECT coalesce(sum(amount),0), coalesce(sum(refunded_amount),0) INTO v_gross, v_refunded
    FROM customer_payments WHERE org_id = p_org
      AND CASE WHEN p_invoice IS NOT NULL THEN invoice_id = p_invoice
        ELSE estimate_id = p_estimate AND change_order_id IS NULL END
      AND status IN ('succeeded','paid','partially_refunded','refunded');
  SELECT coalesce(sum(r.amount) FILTER (WHERE r.state = 'succeeded'),0),
      count(*) FILTER (WHERE r.state IN ('reserved','pending','unknown')) INTO v_credits, v_pending
    FROM payment_refund_operations r JOIN customer_payments p ON p.id = r.payment_id AND p.org_id = p_org
    WHERE r.org_id = p_org AND CASE WHEN p_invoice IS NOT NULL THEN p.invoice_id = p_invoice
      ELSE p.estimate_id = p_estimate AND p.change_order_id IS NULL END;
  v_review := v_refunded <> v_credits OR EXISTS (SELECT 1 FROM customer_payments WHERE org_id = p_org
    AND CASE WHEN p_invoice IS NOT NULL THEN invoice_id = p_invoice ELSE estimate_id = p_estimate AND change_order_id IS NULL END
    AND payment_refund_history_needs_review(metadata));
  v_closed := v_status IN ('canceled','voided','superseded','declined','refunded')
    OR (v_gross > 0 AND v_refunded >= v_gross);
  RETURN jsonb_build_object('total', v_total::text, 'allocated', v_gross::text,
    'netCollected', (v_gross-v_refunded)::text, 'credits', v_credits::text,
    'remaining', CASE WHEN v_closed OR v_review THEN '0.00' ELSE greatest(v_total-v_gross,0)::text END,
    'closed', v_closed, 'needsReview', v_review, 'pendingRefunds', v_pending);
END $$;
--> statement-breakpoint
CREATE FUNCTION record_manual_payment(p_org UUID, p_actor UUID, p_key TEXT, p_request JSONB, p_checkout JSONB DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_op operation_results%ROWTYPE; v_invoice customer_invoices%ROWTYPE; v_estimate estimates%ROWTYPE;
  v_payment customer_payments%ROWTYPE; v_invoice_id UUID; v_estimate_id UUID; v_job UUID; v_lead UUID; v_change UUID;
  v_amount NUMERIC; v_remaining NUMERIC; v_balance JSONB; v_root JSONB; v_date TIMESTAMPTZ; v_result JSONB;
BEGIN
  IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 OR p_actor IS NULL THEN
    RAISE EXCEPTION 'An actor and operation key are required.' USING ERRCODE = 'P0400';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payment:' || p_org::text,0));
  SELECT * INTO v_op FROM operation_results WHERE org_id = p_org AND action = 'payment.manual'
    AND actor = p_actor::text AND operation_key = p_key;
  IF FOUND THEN
    IF v_op.request <> p_request THEN RAISE EXCEPTION 'This operation key was used for different payment details.' USING ERRCODE = 'P0409'; END IF;
    RETURN v_op.result || '{"replayed":true}'::jsonb;
  END IF;
  v_invoice_id := nullif(p_request->>'invoiceId','')::uuid;
  v_estimate_id := nullif(p_request->>'estimateId','')::uuid;
  IF (v_invoice_id IS NULL) = (v_estimate_id IS NULL) THEN RAISE EXCEPTION 'Select one payment obligation.' USING ERRCODE = 'P0400'; END IF;
  IF coalesce(p_request->>'amount','') !~ '^[0-9]+(\.[0-9]{1,2})?$' THEN
    RAISE EXCEPTION 'Enter an amount in dollars and cents.' USING ERRCODE = 'P0400';
  END IF;
  v_amount := (p_request->>'amount')::numeric;
  IF v_amount <= 0 OR v_amount > 99999999.99 OR coalesce(p_request->>'source','') NOT IN ('cash','check','ach','other') THEN
    RAISE EXCEPTION 'Invalid manual payment amount or method.' USING ERRCODE = 'P0400';
  END IF;
  IF EXISTS (SELECT 1 FROM customer_payments WHERE org_id = p_org AND metadata->>'idempotencyKey' = p_key
    AND source <> 'stripe' AND (metadata->>'recordedByUserId' IS NULL OR metadata->>'recordedByUserId' = p_actor::text)) THEN
    RAISE EXCEPTION 'This historical payment key needs review before retrying.' USING ERRCODE = 'P0409';
  END IF;
  IF v_invoice_id IS NOT NULL THEN
    SELECT * INTO v_invoice FROM customer_invoices WHERE id = v_invoice_id AND org_id = p_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.' USING ERRCODE = 'P0404'; END IF;
    v_estimate_id := v_invoice.estimate_id;
    v_lead := v_invoice.lead_id; v_job := v_invoice.job_id; v_change := v_invoice.change_order_id;
    IF v_invoice.status = 'draft' THEN RAISE EXCEPTION 'Issue this invoice before recording payment.' USING ERRCODE = 'P0409'; END IF;
    -- A ledger row alone does not establish provider state. The API must confirm
    -- this EXACT stored session; a changed session is checked again under the lock.
    IF v_invoice.stripe_checkout_session_id IS NOT NULL THEN
      IF p_checkout IS NULL THEN
        RAISE EXCEPTION 'An online checkout needs reconciliation before recording this payment.' USING ERRCODE = 'P0412';
      END IF;
      IF p_checkout->>'id' IS DISTINCT FROM v_invoice.stripe_checkout_session_id
        OR p_checkout->>'orgId' IS DISTINCT FROM p_org::text OR p_checkout->>'invoiceId' IS DISTINCT FROM v_invoice.id::text
        OR p_checkout->>'currency' IS DISTINCT FROM 'usd'
        OR NOT EXISTS (SELECT 1 FROM stripe_connections WHERE org_id = p_org AND stripe_account_id = p_checkout->>'accountId') THEN
        RAISE EXCEPTION 'The online checkout identity changed or needs review.' USING ERRCODE = 'P0409';
      END IF;
      IF p_checkout->>'status' IS DISTINCT FROM 'expired' THEN
        IF p_checkout->>'status' IS DISTINCT FROM 'complete' OR p_checkout->>'paymentStatus' IS DISTINCT FROM 'paid'
          OR NOT EXISTS (SELECT 1 FROM customer_payments WHERE org_id = p_org AND invoice_id = v_invoice.id AND source = 'stripe'
            AND stripe_checkout_session_id = v_invoice.stripe_checkout_session_id
            AND stripe_payment_intent_id = p_checkout->>'paymentIntentId' AND currency = 'usd'
            AND amount * 100 = (p_checkout->>'amountMinor')::numeric
            AND status IN ('succeeded','paid','partially_refunded','refunded')) THEN
          RAISE EXCEPTION 'Online checkout is still active or its payment needs reconciliation. No manual payment was recorded.' USING ERRCODE = 'P0409';
        END IF;
      END IF;
    END IF;
  ELSE
    SELECT * INTO v_estimate FROM estimates WHERE id = v_estimate_id AND org_id = p_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Estimate not found.' USING ERRCODE = 'P0404'; END IF;
    IF v_estimate.status::text <> 'accepted' THEN RAISE EXCEPTION 'Accept this estimate before recording payment.' USING ERRCODE = 'P0409'; END IF;
    IF EXISTS (SELECT 1 FROM customer_invoices WHERE org_id = p_org AND estimate_id = v_estimate_id AND change_order_id IS NULL) THEN
      RAISE EXCEPTION 'Record this payment against the related invoice, not the estimate.' USING ERRCODE = 'P0409';
    END IF;
    v_lead := v_estimate.lead_id;
    SELECT id INTO v_job FROM jobs WHERE org_id = p_org AND estimate_id = v_estimate_id ORDER BY created_at LIMIT 1;
  END IF;
  IF v_estimate_id IS NOT NULL AND v_change IS NULL THEN
    PERFORM 1 FROM estimates WHERE id = v_estimate_id AND org_id = p_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Estimate not found.' USING ERRCODE = 'P0404'; END IF;
    v_root := payment_obligation_balance(p_org,NULL,v_estimate_id);
    IF (v_root->>'closed')::boolean OR (v_root->>'needsReview')::boolean OR (v_root->>'pendingRefunds')::integer > 0 THEN
      RAISE EXCEPTION 'The estimate is closed or its payment history needs review.' USING ERRCODE = 'P0409';
    END IF;
    IF v_amount > (v_root->>'remaining')::numeric THEN RAISE EXCEPTION 'Payment exceeds the remaining estimate balance.' USING ERRCODE = 'P0409'; END IF;
  END IF;
  v_balance := payment_obligation_balance(p_org,v_invoice_id,CASE WHEN v_invoice_id IS NULL THEN v_estimate_id ELSE NULL END);
  IF (v_balance->>'closed')::boolean OR (v_balance->>'needsReview')::boolean OR (v_balance->>'pendingRefunds')::integer > 0 THEN
    RAISE EXCEPTION 'This obligation is closed or its payment history needs review.' USING ERRCODE = 'P0409';
  END IF;
  v_remaining := (v_balance->>'remaining')::numeric;
  IF v_remaining <= 0 THEN RAISE EXCEPTION 'This obligation is already paid in full.' USING ERRCODE = 'P0409'; END IF;
  IF (v_balance->>'allocated')::numeric > 0 AND NOT coalesce((p_request->>'confirmAdditionalPayment')::boolean,false) THEN
    RAISE EXCEPTION 'A payment is already recorded. Confirm this is an additional payment.' USING ERRCODE = 'P0409';
  END IF;
  IF v_amount > v_remaining THEN RAISE EXCEPTION 'Payment exceeds the remaining balance.' USING ERRCODE = 'P0409'; END IF;
  v_date := coalesce(nullif(p_request->>'receivedAt','')::timestamptz,now());
  IF v_date > now() + interval '5 minutes' THEN RAISE EXCEPTION 'Payment date cannot be in the future.' USING ERRCODE = 'P0400'; END IF;
  INSERT INTO customer_payments (org_id,lead_id,estimate_id,invoice_id,job_id,change_order_id,source,status,amount,currency,description,received_at,metadata)
    VALUES (p_org,v_lead,v_estimate_id,v_invoice_id,v_job,v_change,p_request->>'source','succeeded',v_amount,'usd',
      coalesce(nullif(p_request->>'description',''),upper(p_request->>'source') || ' payment'), v_date AT TIME ZONE 'UTC',
      jsonb_build_object('idempotencyKey',p_key,'reference',p_request->>'reference','recordedByUserId',p_actor,
        'confirmedAdditionalPayment',(v_balance->>'allocated')::numeric > 0,'receiptRequested',coalesce((p_request->>'sendReceipt')::boolean,true),
        'checkoutVerification',p_checkout,'note','Manual payment recorded. No Stripe charge was created.')) RETURNING * INTO v_payment;
  IF v_invoice_id IS NOT NULL THEN
    UPDATE customer_invoices SET status = CASE WHEN v_amount = v_remaining THEN 'paid'
        WHEN (v_balance->>'credits')::numeric > 0 THEN 'partially_refunded' ELSE 'partially_paid' END,
      paid_at = CASE WHEN v_amount = v_remaining THEN v_date AT TIME ZONE 'UTC' ELSE paid_at END, updated_at = now()
      WHERE id = v_invoice_id AND org_id = p_org;
    IF v_change IS NOT NULL AND v_amount = v_remaining THEN
      UPDATE change_orders SET payment_status = 'paid',paid_at = v_date AT TIME ZONE 'UTC' WHERE id = v_change AND org_id = p_org;
    END IF;
    IF v_job IS NOT NULL AND v_estimate_id IS NOT NULL AND v_amount = v_remaining THEN
      UPDATE jobs SET status = 'scheduled',updated_at = now() WHERE id = v_job AND org_id = p_org AND status = 'deposit_pending';
    END IF;
  END IF;
  INSERT INTO audit_logs (org_id,user_id,action,entity_type,entity_id,metadata) VALUES
    (p_org,p_actor,'payment.manual_recorded','payment',v_payment.id,
      jsonb_build_object('leadId',v_lead,'invoiceId',v_invoice_id,'estimateId',v_estimate_id,'jobId',v_job,
        'amount',v_amount,'source',v_payment.source,'reference',p_request->>'reference','receivedAt',v_date,
        'remainingAfterPayment',v_remaining-v_amount,'checkoutVerification',p_checkout,'receiptRequested',coalesce((p_request->>'sendReceipt')::boolean,true)));
  v_result := jsonb_build_object('payment',to_jsonb(v_payment),'remaining',(v_remaining-v_amount)::text,'replayed',false);
  INSERT INTO operation_results (org_id,action,actor,operation_key,request,result)
    VALUES (p_org,'payment.manual',p_actor::text,p_key,p_request,v_result);
  RETURN v_result;
END $$;
--> statement-breakpoint
CREATE FUNCTION settle_payment_refund(p_org UUID,p_operation UUID,p_state TEXT,p_provider_id TEXT,p_evidence JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_op payment_refund_operations%ROWTYPE; v_payment customer_payments%ROWTYPE;
  v_invoice customer_invoices%ROWTYPE; v_refunded NUMERIC; v_gross NUMERIC; v_refunds NUMERIC;
  v_history JSONB; v_balance JSONB;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('payment:' || p_org::text,0));
  SELECT * INTO v_op FROM payment_refund_operations WHERE id = p_operation AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Refund operation not found.' USING ERRCODE = 'P0404'; END IF;
  SELECT * INTO v_payment FROM customer_payments WHERE id = v_op.payment_id AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.' USING ERRCODE = 'P0404'; END IF;
  IF p_state NOT IN ('pending','unknown','succeeded','failed','canceled') THEN RAISE EXCEPTION 'Invalid refund outcome.' USING ERRCODE = 'P0400'; END IF;
  IF v_op.source = 'stripe' AND p_state <> 'unknown' THEN
    IF p_provider_id IS NULL OR p_provider_id !~ '^re_'
      OR (p_evidence->>'status' IS DISTINCT FROM p_state AND NOT (p_state = 'pending' AND p_evidence->>'status' = 'requires_action'))
      OR p_evidence->>'currency' IS DISTINCT FROM 'usd'
      OR (p_evidence->>'amountMinor')::numeric IS DISTINCT FROM v_op.amount*100
      OR (p_evidence->>'livemode')::boolean IS DISTINCT FROM v_op.provider_livemode
      OR p_evidence->>'accountId' IS DISTINCT FROM v_op.provider_account_id
      OR (v_op.provider_payment_intent_id IS NOT NULL AND p_evidence->>'paymentIntentId' IS DISTINCT FROM v_op.provider_payment_intent_id)
      OR (v_op.provider_payment_intent_id IS NULL AND p_evidence->>'chargeId' IS DISTINCT FROM v_op.provider_charge_id)
      OR (v_op.provider_refund_id IS NOT NULL AND v_op.provider_refund_id <> p_provider_id) THEN
      RAISE EXCEPTION 'Provider refund identity does not match the reserved operation.' USING ERRCODE = 'P0409';
    END IF;
  ELSIF v_op.source <> 'stripe' AND (p_state <> 'succeeded' OR p_provider_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Manual refunds cannot use a provider operation.' USING ERRCODE = 'P0400';
  END IF;
  IF v_op.state IN ('succeeded','failed','canceled') THEN
    IF p_state IN ('pending','unknown') THEN
      RETURN jsonb_build_object('operation',to_jsonb(v_op),'payment',to_jsonb(v_payment),'replayed',true);
    END IF;
    IF v_op.state <> p_state THEN RAISE EXCEPTION 'This refund is already finalized. Review the provider history.' USING ERRCODE = 'P0409'; END IF;
    RETURN jsonb_build_object('operation',to_jsonb(v_op),'payment',to_jsonb(v_payment),'replayed',true);
  END IF;
  -- A network error must not overwrite a newer verified webhook outcome/status.
  IF p_state = 'unknown' AND v_op.state = 'pending' THEN
    RETURN jsonb_build_object('operation',to_jsonb(v_op),'payment',to_jsonb(v_payment),'replayed',true);
  END IF;
  UPDATE payment_refund_operations SET state = p_state,
      provider_refund_id = coalesce(p_provider_id,provider_refund_id), settlement_evidence = p_evidence,updated_at = now()
    WHERE id = v_op.id AND org_id = p_org RETURNING * INTO v_op;
  IF p_state = 'succeeded' THEN
    v_refunded := v_payment.refunded_amount + v_op.amount;
    IF v_refunded > v_payment.amount THEN RAISE EXCEPTION 'Refund exceeds the original payment.' USING ERRCODE = 'P0409'; END IF;
    v_history := CASE WHEN jsonb_typeof(v_payment.metadata->'refundHistory') = 'array'
      THEN v_payment.metadata->'refundHistory' ELSE '[]'::jsonb END;
    UPDATE customer_payments SET refunded_amount = v_refunded,
        status = CASE WHEN v_refunded = amount THEN 'refunded' ELSE 'partially_refunded' END,
        stripe_refund_id = coalesce(p_provider_id,stripe_refund_id),refunded_at = v_op.effective_at AT TIME ZONE 'UTC',updated_at = now(),
        metadata = (coalesce(metadata,'{}'::jsonb) - 'pendingRefundOperationId') || jsonb_build_object(
          'lastRefundReason',v_op.reason,'lastRefundStatus','succeeded','lastRefundMode',CASE WHEN v_op.source = 'stripe' THEN 'stripe' ELSE 'manual' END,
          'lastRefundMethod',v_op.method,'lastRefundReference',v_op.reference,'refundDisposition','credit',
          'lastRefundDateSource',CASE WHEN v_op.source = 'stripe' THEN 'provider_request' WHEN nullif(v_op.request->>'refundedAt','') IS NULL THEN 'recording_time' ELSE 'user_supplied' END,
          'refundHistory',v_history || jsonb_build_array(jsonb_build_object('operationId',v_op.id,'idempotencyKey',v_op.operation_key,
            'amount',v_op.amount,'reason',v_op.reason,'status','succeeded','mode',CASE WHEN v_op.source = 'stripe' THEN 'stripe' ELSE 'manual' END,
            'method',v_op.method,'reference',v_op.reference,'stripeRefundId',p_provider_id,'recordedByUserId',v_op.actor_id,
            'recordedAt',now(),'refundedAt',v_op.effective_at,
            'refundDateSource',CASE WHEN v_op.source = 'stripe' THEN 'provider_request' WHEN nullif(v_op.request->>'refundedAt','') IS NULL THEN 'recording_time' ELSE 'user_supplied' END,
            'disposition','credit')))
      WHERE id = v_payment.id AND org_id = p_org RETURNING * INTO v_payment;
    IF v_payment.invoice_id IS NOT NULL THEN
      SELECT * INTO v_invoice FROM customer_invoices WHERE id = v_payment.invoice_id AND org_id = p_org FOR UPDATE;
      SELECT coalesce(sum(amount),0),coalesce(sum(refunded_amount),0) INTO v_gross,v_refunds FROM customer_payments
        WHERE invoice_id = v_invoice.id AND org_id = p_org AND status IN ('paid','succeeded','partially_refunded','refunded');
      IF v_invoice.status NOT IN ('canceled','voided') THEN
        UPDATE customer_invoices SET status = CASE WHEN v_refunds >= v_gross AND v_gross > 0 THEN 'refunded' ELSE 'partially_refunded' END,
          updated_at = now() WHERE id = v_invoice.id AND org_id = p_org;
      END IF;
      IF v_invoice.change_order_id IS NOT NULL THEN
        UPDATE change_orders SET payment_status = CASE WHEN v_refunds >= v_gross THEN 'refunded' ELSE 'partially_refunded' END
          WHERE id = v_invoice.change_order_id AND org_id = p_org;
      END IF;
    END IF;
    INSERT INTO audit_logs (org_id,user_id,action,entity_type,entity_id,metadata) VALUES
      (p_org,v_op.actor_id,'payment.refunded','payment',v_payment.id,jsonb_build_object('operationId',v_op.id,
        'leadId',v_payment.lead_id,'invoiceId',v_payment.invoice_id,'estimateId',v_payment.estimate_id,'jobId',v_payment.job_id,
        'amount',v_op.amount,'refundedAmount',v_refunded,'status',v_payment.status,'reason',v_op.reason,'source',v_op.source,
        'refundMode',CASE WHEN v_op.source = 'stripe' THEN 'stripe' ELSE 'manual' END,'refundMethod',v_op.method,
        'refundReference',v_op.reference,'stripeRefundId',p_provider_id,'refundedAt',v_op.effective_at,
        'refundDateSource',CASE WHEN v_op.source = 'stripe' THEN 'provider_request' WHEN nullif(v_op.request->>'refundedAt','') IS NULL THEN 'recording_time' ELSE 'user_supplied' END,
        'disposition','credit'));
  ELSE
    UPDATE customer_payments SET metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('lastRefundStatus',p_state,
      'pendingRefundOperationId',CASE WHEN p_state IN ('unknown','pending') THEN v_op.id ELSE NULL END),updated_at = now()
      WHERE id = v_payment.id AND org_id = p_org RETURNING * INTO v_payment;
    INSERT INTO audit_logs (org_id,user_id,action,entity_type,entity_id,metadata) VALUES
      (p_org,v_op.actor_id,'payment.refund_' || p_state,'payment',v_payment.id,
        jsonb_build_object('operationId',v_op.id,'amount',v_op.amount,'stripeRefundId',p_provider_id,'status',p_state));
  END IF;
  RETURN jsonb_build_object('operation',to_jsonb(v_op),'payment',to_jsonb(v_payment),'replayed',false);
END $$;
--> statement-breakpoint
CREATE FUNCTION reserve_payment_refund(p_org UUID,p_actor UUID,p_key TEXT,p_payment UUID,p_request JSONB,p_account TEXT,p_livemode BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_op payment_refund_operations%ROWTYPE; v_payment customer_payments%ROWTYPE; v_amount NUMERIC;
  v_reserved NUMERIC; v_id UUID := gen_random_uuid(); v_effective TIMESTAMPTZ; v_stripe BOOLEAN;
BEGIN
  IF p_actor IS NULL OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'An actor and operation key are required.' USING ERRCODE = 'P0400';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payment:' || p_org::text,0));
  SELECT * INTO v_op FROM payment_refund_operations WHERE org_id = p_org AND actor_id = p_actor AND operation_key = p_key FOR UPDATE;
  IF FOUND THEN
    IF v_op.request <> p_request OR v_op.payment_id <> p_payment THEN
      RAISE EXCEPTION 'This operation key was used for different refund details.' USING ERRCODE = 'P0409';
    END IF;
    SELECT * INTO v_payment FROM customer_payments WHERE id = v_op.payment_id AND org_id = p_org;
    RETURN jsonb_build_object('operation',to_jsonb(v_op),'payment',to_jsonb(v_payment),'dispatch',false,'replayed',true);
  END IF;
  SELECT * INTO v_payment FROM customer_payments WHERE id = p_payment AND org_id = p_org FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.' USING ERRCODE = 'P0404'; END IF;
  IF v_payment.currency <> 'usd' OR v_payment.status NOT IN ('succeeded','paid','partially_refunded','refunded') THEN
    RAISE EXCEPTION 'Only confirmed USD payments can be refunded.' USING ERRCODE = 'P0409';
  END IF;
  IF v_payment.source NOT IN ('stripe','cash','check','ach','other') THEN
    RAISE EXCEPTION 'The original payment method needs review.' USING ERRCODE = 'P0409';
  END IF;
  IF coalesce(p_request->>'amount','') !~ '^[0-9]+(\.[0-9]{1,2})?$' OR length(btrim(coalesce(p_request->>'reason',''))) NOT BETWEEN 1 AND 500
    OR coalesce(p_request->>'disposition','credit') <> 'credit' THEN
    RAISE EXCEPTION 'Enter an exact refund amount, reason, and credit disposition.' USING ERRCODE = 'P0400';
  END IF;
  v_amount := (p_request->>'amount')::numeric;
  SELECT coalesce(sum(amount),0) INTO v_reserved FROM payment_refund_operations WHERE org_id = p_org AND payment_id = p_payment
    AND state IN ('reserved','pending','unknown');
  IF v_reserved > 0 THEN RAISE EXCEPTION 'An existing refund is awaiting confirmation. Review it before requesting another.' USING ERRCODE = 'P0409'; END IF;
  IF payment_refund_history_needs_review(v_payment.metadata) THEN
    RAISE EXCEPTION 'The historical refund outcome or disposition needs reconciliation before another refund.' USING ERRCODE = 'P0409';
  END IF;
  IF v_amount <= 0 OR v_amount > v_payment.amount-v_payment.refunded_amount-v_reserved THEN
    RAISE EXCEPTION 'Refund exceeds the remaining refundable amount.' USING ERRCODE = 'P0409';
  END IF;
  IF v_payment.refunded_amount <> coalesce((SELECT sum(amount) FROM payment_refund_operations
      WHERE org_id = p_org AND payment_id = p_payment AND state = 'succeeded'),0) THEN
    RAISE EXCEPTION 'The historical refund needs reconciliation before another refund.' USING ERRCODE = 'P0409';
  END IF;
  -- Source wins over any stale or accidentally attached provider reference.
  v_stripe := v_payment.source = 'stripe';
  IF v_stripe THEN
    IF p_account IS NULL OR p_livemode IS NULL OR (v_payment.stripe_payment_intent_id IS NULL AND v_payment.stripe_charge_id IS NULL) THEN
      RAISE EXCEPTION 'Stripe account or original payment reference needs review.' USING ERRCODE = 'P0409';
    END IF;
    IF v_payment.metadata->>'stripeAccountId' IS NOT NULL AND v_payment.metadata->>'stripeAccountId' <> p_account
      OR v_payment.metadata->>'livemode' IS NOT NULL AND (v_payment.metadata->>'livemode')::boolean <> p_livemode THEN
      RAISE EXCEPTION 'The original Stripe account or environment needs review.' USING ERRCODE = 'P0409';
    END IF;
    v_effective := now();
  ELSE
    IF NOT coalesce((p_request->>'confirmManualRefund')::boolean,false)
      OR coalesce(p_request->>'method','') NOT IN ('cash','check','ach','other') THEN
      RAISE EXCEPTION 'Confirm money was returned outside Stripe and provide its method.' USING ERRCODE = 'P0400';
    END IF;
    -- Legacy UI sends confirmManualRefund, not a date. Preserve that contract,
    -- but label the default as recording time rather than claiming an actual return date.
    v_effective := coalesce(nullif(p_request->>'refundedAt','')::timestamptz,now());
    IF v_effective > now() + interval '5 minutes' THEN RAISE EXCEPTION 'Refund date cannot be in the future.' USING ERRCODE = 'P0400'; END IF;
  END IF;
  INSERT INTO payment_refund_operations (id,org_id,payment_id,actor_id,operation_key,request,amount,source,reason,method,reference,effective_at,
      state,provider_key,provider_account_id,provider_livemode,provider_payment_intent_id,provider_charge_id)
    VALUES (v_id,p_org,p_payment,p_actor,p_key,p_request,v_amount,v_payment.source,btrim(p_request->>'reason'),
      CASE WHEN v_stripe THEN 'stripe' ELSE p_request->>'method' END,p_request->>'reference',v_effective,'reserved',
      'crewmodo:refund:' || v_id::text,CASE WHEN v_stripe THEN p_account END,CASE WHEN v_stripe THEN p_livemode END,
      CASE WHEN v_stripe THEN v_payment.stripe_payment_intent_id END,CASE WHEN v_stripe THEN v_payment.stripe_charge_id END) RETURNING * INTO v_op;
  IF NOT v_stripe THEN
    RETURN settle_payment_refund(p_org,v_id,'succeeded',NULL,jsonb_build_object('manualReturnAcknowledged',true,
      'refundDateSource',CASE WHEN nullif(p_request->>'refundedAt','') IS NULL THEN 'recording_time' ELSE 'user_supplied' END)) || '{"dispatch":false}'::jsonb;
  END IF;
  UPDATE customer_payments SET metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('lastRefundStatus','reserved',
    'pendingRefundOperationId',v_id),updated_at = now() WHERE id = p_payment AND org_id = p_org RETURNING * INTO v_payment;
  INSERT INTO audit_logs (org_id,user_id,action,entity_type,entity_id,metadata) VALUES
    (p_org,p_actor,'payment.refund_reserved','payment',p_payment,jsonb_build_object('operationId',v_id,'amount',v_amount,'reason',v_op.reason));
  RETURN jsonb_build_object('operation',to_jsonb(v_op),'payment',to_jsonb(v_payment),'dispatch',true,'replayed',false);
END $$;
