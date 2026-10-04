-- Existing rates, prices, material costs and signed snapshots retain their meaning.
ALTER TABLE production_rates
  ADD COLUMN rate_basis VARCHAR(30) NOT NULL DEFAULT 'legacy_per_coat'
    CHECK (rate_basis IN ('legacy_per_coat','complete_system','hours_per_item')),
  ADD COLUMN coat_rates JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(coat_rates) = 'object'),
  ADD COLUMN application_method VARCHAR(30)
    CHECK (application_method IN ('brush_roll','spray_backroll','spray_only')),
  ADD COLUMN selling_rate_source VARCHAR(20) NOT NULL DEFAULT 'override'
    CHECK (selling_rate_source IN ('inherit','override')),
  ADD COLUMN burdened_rate NUMERIC(10,2) CHECK (burdened_rate >= 0),
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN provenance VARCHAR(30) NOT NULL DEFAULT 'legacy' CHECK (provenance IN ('legacy','sample','manual')),
  ADD COLUMN reviewed_at TIMESTAMP;
--> statement-breakpoint
ALTER TABLE materials
  ADD COLUMN coverage_basis VARCHAR(20) NOT NULL DEFAULT 'per_pack' CHECK (coverage_basis IN ('per_pack','per_gallon')),
  ADD COLUMN coverage_source TEXT,
  ADD COLUMN cost_source TEXT,
  ADD COLUMN cost_updated_at TIMESTAMP;
--> statement-breakpoint
-- Serialize pricebook writes and persist their outcomes atomically using the same
-- operation ledger as estimate saves. Inactive categories are never seeded again.
CREATE FUNCTION mutate_production_pricebook(
  p_org UUID, p_actor UUID, p_key TEXT, p_action TEXT, p_request JSONB,
  p_id UUID, p_expected INTEGER, p_payload JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_operation operation_results%ROWTYPE;
  v_existing production_rates%ROWTYPE;
  v_rate production_rates%ROWTYPE;
  v_payload JSONB;
  v_rows JSONB := '[]'::jsonb;
  v_result JSONB;
BEGIN
  IF p_org IS NULL OR p_actor IS NULL OR p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200
    OR p_action IS NULL OR p_action NOT IN ('create','update','delete','initialize-samples') THEN
    RAISE EXCEPTION 'A valid actor, action and operation key are required.' USING ERRCODE = 'P0400';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('production-pricebook:' || p_org::text, 0));
  SELECT * INTO v_operation FROM operation_results WHERE org_id=p_org AND actor=p_actor::text
    AND action='production.pricebook.' || p_action AND operation_key=p_key;
  IF FOUND THEN
    IF v_operation.request <> p_request THEN
      RAISE EXCEPTION 'This operation key was already used for different details.' USING ERRCODE = 'P0409';
    END IF;
    RETURN v_operation.result || '{"replayed":true}'::jsonb;
  END IF;

  IF p_action IN ('update','delete') THEN
    SELECT * INTO v_existing FROM production_rates WHERE id=p_id AND org_id=p_org AND is_active FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Production rate not found.' USING ERRCODE = 'P0404'; END IF;
    IF p_expected IS NOT NULL AND p_expected <> v_existing.version THEN
      RAISE EXCEPTION 'This production rate changed. Reload it before saving.' USING ERRCODE = 'P0409';
    END IF;
  END IF;

  IF p_action='delete' THEN
    UPDATE production_rates SET is_active=false, version=version+1, updated_at=clock_timestamp()
      WHERE id=p_id AND org_id=p_org RETURNING * INTO v_rate;
  ELSIF p_action='update' THEN
    UPDATE production_rates SET
      category=p_payload->>'category', surface_type=p_payload->>'surfaceType', unit=p_payload->>'unit',
      rate_per_hour=(p_payload->>'ratePerHour')::numeric, hourly_rate=(p_payload->>'hourlyRate')::numeric,
      prep_multiplier=(p_payload->>'prepMultiplier')::numeric, coats=(p_payload->>'coats')::integer,
      description=p_payload->>'description', rate_basis=p_payload->>'rateBasis', coat_rates=p_payload->'coatRates',
      application_method=p_payload->>'applicationMethod', selling_rate_source=p_payload->>'sellingRateSource',
      burdened_rate=(p_payload->>'burdenedRate')::numeric, provenance=p_payload->>'provenance',
      reviewed_at=(p_payload->>'reviewedAt')::timestamp, version=version+1, updated_at=clock_timestamp()
      WHERE id=p_id AND org_id=p_org RETURNING * INTO v_rate;
  ELSE
    IF p_action='initialize-samples' AND jsonb_typeof(p_payload) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Invalid sample rates.' USING ERRCODE = 'P0400';
    END IF;
    FOR v_payload IN SELECT value FROM jsonb_array_elements(
      CASE WHEN p_action='create' THEN jsonb_build_array(p_payload) ELSE p_payload END
    ) LOOP
      IF p_action='initialize-samples' AND EXISTS (
        SELECT 1 FROM production_rates WHERE org_id=p_org AND category=v_payload->>'category'
      ) THEN CONTINUE; END IF;
      INSERT INTO production_rates (
        org_id,category,surface_type,unit,rate_per_hour,hourly_rate,prep_multiplier,coats,description,
        rate_basis,coat_rates,application_method,selling_rate_source,burdened_rate,provenance,reviewed_at
      ) VALUES (
        p_org,v_payload->>'category',v_payload->>'surfaceType',v_payload->>'unit',
        (v_payload->>'ratePerHour')::numeric,(v_payload->>'hourlyRate')::numeric,
        (v_payload->>'prepMultiplier')::numeric,(v_payload->>'coats')::integer,v_payload->>'description',
        v_payload->>'rateBasis',v_payload->'coatRates',v_payload->>'applicationMethod',
        v_payload->>'sellingRateSource',(v_payload->>'burdenedRate')::numeric,
        v_payload->>'provenance',(v_payload->>'reviewedAt')::timestamp
      ) RETURNING * INTO v_rate;
      v_rows := v_rows || jsonb_build_array(to_jsonb(v_rate));
    END LOOP;
  END IF;
  v_result := jsonb_build_object('data', CASE WHEN p_action='initialize-samples' THEN v_rows ELSE to_jsonb(v_rate) END,
    'replayed',false);
  INSERT INTO operation_results (org_id,action,actor,operation_key,request,result)
    VALUES (p_org,'production.pricebook.' || p_action,p_actor::text,p_key,p_request,v_result);
  INSERT INTO audit_logs (org_id,user_id,action,entity_type,entity_id,metadata)
    VALUES (p_org,p_actor,'production.pricebook.' || p_action,
      CASE WHEN p_action='initialize-samples' THEN 'production_pricebook' ELSE 'production_rate' END,
      CASE WHEN p_action='initialize-samples' THEN p_org ELSE v_rate.id END,
      jsonb_build_object('rateId',v_rate.id,'version',v_rate.version,'addedCount',jsonb_array_length(v_rows)));
  RETURN v_result;
END $$;
