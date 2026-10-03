CREATE FUNCTION save_unsigned_estimate(
  p_org UUID, p_actor UUID, p_key TEXT, p_request JSONB,
  p_id UUID, p_expected TIMESTAMP, p_payload JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_operation operation_results%ROWTYPE;
  v_existing estimates%ROWTYPE;
  v_estimate estimates%ROWTYPE;
  v_lead leads%ROWTYPE;
  v_status TEXT;
  v_action TEXT;
  v_result JSONB;
BEGIN
  IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 OR p_actor IS NULL THEN
    RAISE EXCEPTION 'An actor and operation key are required.' USING ERRCODE = 'P0400';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('estimate-save:' || p_org::text, 0));
  SELECT * INTO v_operation FROM operation_results WHERE org_id=p_org AND actor=p_actor::text
    AND action='estimate.save' AND operation_key=p_key;
  IF FOUND THEN
    IF v_operation.request <> p_request THEN
      RAISE EXCEPTION 'This save key was already used for different details.' USING ERRCODE = 'P0409';
    END IF;
    RETURN v_operation.result || '{"replayed":true}'::jsonb;
  END IF;
  SELECT * INTO v_lead FROM leads WHERE id=(p_payload->>'leadId')::uuid AND org_id=p_org;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer not found.' USING ERRCODE = 'P0404'; END IF;
  v_status := coalesce(p_payload->>'status', 'draft');
  IF v_status NOT IN ('draft','sent') OR jsonb_typeof(p_payload->'packages') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Check the proposal details.' USING ERRCODE = 'P0400';
  END IF;
  IF v_status='sent' AND ((p_payload->>'total')::numeric <= 0 OR jsonb_array_length(p_payload->'packages')=0) THEN
    RAISE EXCEPTION 'Add priced scope before sending this proposal.' USING ERRCODE = 'P0400';
  END IF;
  IF p_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM estimates WHERE id=p_id AND org_id=p_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Estimate not found.' USING ERRCODE = 'P0404'; END IF;
    IF v_existing.status NOT IN ('draft','sent') OR v_existing.signed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Signed or closed proposals cannot be edited. Use a revision or change order.' USING ERRCODE='P0409';
    END IF;
    IF p_expected IS NULL OR date_trunc('milliseconds',v_existing.updated_at) <> p_expected THEN
      RAISE EXCEPTION 'This estimate changed while you were editing. Reload it before saving.' USING ERRCODE='P0409';
    END IF;
    IF v_existing.status='sent' THEN v_status := 'sent'; END IF;
    IF v_status='sent' AND ((p_payload->>'total')::numeric <= 0 OR jsonb_array_length(p_payload->'packages')=0) THEN
      RAISE EXCEPTION 'Add priced scope before updating this proposal.' USING ERRCODE = 'P0400';
    END IF;
    UPDATE estimates SET lead_id=v_lead.id, packages=p_payload->'packages', total=(p_payload->>'total')::numeric,
      street_address=nullif(p_payload->>'streetAddress',''), city=nullif(p_payload->>'city',''),
      state=nullif(p_payload->>'state',''), postal_code=nullif(p_payload->>'postalCode',''),
      status=v_status::estimate_status, sent_at=CASE WHEN v_status='sent' THEN coalesce(sent_at,now()) ELSE sent_at END,
      updated_at=greatest(date_trunc('milliseconds',clock_timestamp()),v_existing.updated_at + interval '1 millisecond')
      WHERE id=p_id AND org_id=p_org RETURNING * INTO v_estimate;
    v_action := CASE WHEN v_status='draft' THEN 'estimate.draft.updated'
      WHEN v_existing.status='sent' THEN 'estimate.updated' ELSE 'estimate.sent' END;
  ELSE
    INSERT INTO estimates (org_id,lead_id,packages,total,street_address,city,state,postal_code,status,sent_at)
      VALUES (p_org,v_lead.id,p_payload->'packages',(p_payload->>'total')::numeric,
        nullif(p_payload->>'streetAddress',''),nullif(p_payload->>'city',''),nullif(p_payload->>'state',''),nullif(p_payload->>'postalCode',''),
        v_status::estimate_status,CASE WHEN v_status='sent' THEN now() ELSE NULL END) RETURNING * INTO v_estimate;
    v_action := 'estimate.created';
  END IF;
  IF v_status='sent' THEN
    UPDATE leads SET status='estimate_sent',updated_at=now() WHERE id=v_lead.id AND org_id=p_org AND status IN ('new','contacted','estimate_sent');
  END IF;
  INSERT INTO audit_logs (org_id,user_id,action,entity_type,entity_id,metadata)
    VALUES (p_org,p_actor,v_action,'estimate',v_estimate.id,
      jsonb_build_object('leadId',v_lead.id,'total',v_estimate.total,'previousTotal',v_existing.total,
        'previousStatus',v_existing.status,'packageCount',jsonb_array_length(v_estimate.packages)));
  IF p_id IS NULL THEN
    INSERT INTO audit_logs (org_id,user_id,action,entity_type,entity_id,metadata)
      VALUES (p_org,p_actor,CASE WHEN v_status='draft' THEN 'estimate.draft.saved' ELSE 'estimate.sent' END,
        'estimate',v_estimate.id,jsonb_build_object('leadId',v_lead.id,'total',v_estimate.total,'channel','in_app'));
  END IF;
  v_result := jsonb_build_object('estimate',to_jsonb(v_estimate),'replayed',false);
  INSERT INTO operation_results (org_id,action,actor,operation_key,request,result)
    VALUES (p_org,'estimate.save',p_actor::text,p_key,p_request,v_result);
  RETURN v_result;
END $$;
