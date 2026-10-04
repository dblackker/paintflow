-- Additive closeout evidence. No signed scope, accepted budget or selling price is rewritten.
CREATE UNIQUE INDEX estimation_jobs_org_identity_idx ON jobs(org_id,id);
CREATE UNIQUE INDEX estimation_time_org_identity_idx ON time_entries(org_id,id);
CREATE UNIQUE INDEX estimation_rates_org_identity_idx ON production_rates(org_id,id);
CREATE UNIQUE INDEX estimation_changes_org_identity_idx ON change_orders(org_id,id);
CREATE TABLE estimation_change_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  change_order_id UUID NOT NULL REFERENCES change_orders(id),
  budget JSONB NOT NULL CHECK (budget->>'version'='reviewed-change-budget-v1'),
  reviewed_by UUID NOT NULL REFERENCES users(id),
  reviewed_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(org_id,change_order_id),
  FOREIGN KEY(org_id,job_id) REFERENCES jobs(org_id,id),
  FOREIGN KEY(org_id,change_order_id) REFERENCES change_orders(org_id,id)
);
ALTER TABLE estimation_change_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY estimation_change_budgets_isolation ON estimation_change_budgets
  USING (org_id=current_setting('app.current_org_id',true)::uuid)
  WITH CHECK (org_id=current_setting('app.current_org_id',true)::uuid);
CREATE FUNCTION preserve_reviewed_change_budget() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Reviewed change-order budgets are immutable.' USING ERRCODE='P0409';
END $$;
CREATE TRIGGER estimation_change_budgets_immutable BEFORE UPDATE OR DELETE ON estimation_change_budgets
  FOR EACH ROW EXECUTE FUNCTION preserve_reviewed_change_budget();
CREATE TABLE estimation_time_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  time_entry_id UUID NOT NULL REFERENCES time_entries(id),
  operation_id TEXT NOT NULL CHECK (length(operation_id) BETWEEN 1 AND 500),
  reviewed_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (org_id,time_entry_id),
  FOREIGN KEY (org_id,job_id) REFERENCES jobs(org_id,id),
  FOREIGN KEY (org_id,time_entry_id) REFERENCES time_entries(org_id,id)
);
CREATE TABLE estimation_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  operation_id TEXT NOT NULL,
  evidence_revision TEXT NOT NULL,
  observation JSONB NOT NULL CHECK (jsonb_typeof(observation)='object'),
  reviewed_by UUID NOT NULL REFERENCES users(id),
  reviewed_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (org_id,job_id,operation_id,evidence_revision),
  FOREIGN KEY (org_id,job_id) REFERENCES jobs(org_id,id)
);
CREATE TABLE estimation_rate_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  source_rate_id UUID NOT NULL REFERENCES production_rates(id),
  source_version INTEGER NOT NULL CHECK (source_version > 0),
  source_snapshot JSONB NOT NULL,
  suggestion JSONB NOT NULL CHECK (jsonb_typeof(suggestion)='object'),
  status TEXT NOT NULL DEFAULT 'preview' CHECK (status IN ('preview','applied')),
  proposed_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMP,
  applied_rate_id UUID REFERENCES production_rates(id),
  CHECK ((status='preview' AND approved_by IS NULL AND approved_at IS NULL AND applied_rate_id IS NULL)
    OR (status='applied' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND applied_rate_id IS NOT NULL)),
  FOREIGN KEY (org_id,source_rate_id) REFERENCES production_rates(org_id,id),
  FOREIGN KEY (org_id,applied_rate_id) REFERENCES production_rates(org_id,id)
);
CREATE INDEX estimation_observations_job_idx ON estimation_observations(org_id,job_id,reviewed_at DESC);
ALTER TABLE estimation_time_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimation_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimation_rate_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY estimation_time_attributions_isolation ON estimation_time_attributions
  USING (org_id=current_setting('app.current_org_id',true)::uuid)
  WITH CHECK (org_id=current_setting('app.current_org_id',true)::uuid);
CREATE POLICY estimation_observations_isolation ON estimation_observations
  USING (org_id=current_setting('app.current_org_id',true)::uuid)
  WITH CHECK (org_id=current_setting('app.current_org_id',true)::uuid);
CREATE POLICY estimation_rate_versions_isolation ON estimation_rate_versions
  USING (org_id=current_setting('app.current_org_id',true)::uuid)
  WITH CHECK (org_id=current_setting('app.current_org_id',true)::uuid);
--> statement-breakpoint
-- One statement snapshot and deterministic source revision protect reviewed evidence
-- against subsequent time reviews, attribution, supplier/cost and change-order edits.
CREATE FUNCTION estimation_job_evidence(p_org UUID,p_job UUID) RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
  WITH evidence AS (
    SELECT jsonb_build_object(
      'jobId',j.id,'status',j.status,'budget',to_jsonb(j)->'estimation_budget',
      'changes',coalesce((SELECT jsonb_agg(jsonb_build_object('id',co.id,'status',co.status,'description',co.description,'signedAmount',co.amount::text,
        'budget',coalesce((SELECT b.budget FROM estimation_change_budgets b WHERE b.org_id=p_org AND b.job_id=j.id AND b.change_order_id=co.id),
          to_jsonb(co)->'estimation_budget',co.scope_details->'estimationBudget')) ORDER BY co.id)
        FROM change_orders co WHERE co.org_id=p_org AND co.job_id=j.id),'[]'::jsonb),
      'time',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'hours',t.hours::text,'totalCost',t.total_cost::text,
        'date',t.date,'reviewStatus',t.review_status,'operationId',a.operation_id) ORDER BY t.id)
        FROM time_entries t JOIN team_members m ON m.id=t.team_member_id AND m.org_id=p_org
        LEFT JOIN estimation_time_attributions a ON a.org_id=p_org AND a.job_id=j.id AND a.time_entry_id=t.id
        WHERE t.org_id=p_org AND t.job_id=j.id),'[]'::jsonb),
      'costs',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'category',c.category,'totalCost',c.total_cost::text,
        'costDate',c.cost_date,'materialPurchaseId',c.material_purchase_id) ORDER BY c.id)
        FROM job_costs c WHERE c.org_id=p_org AND c.job_id=j.id),'[]'::jsonb),
      'purchases',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'invoiceDate',p.invoice_date,
        'totalAmount',p.total_amount::text,'lines',p.parsed_data) ORDER BY p.id)
        FROM material_purchases p WHERE p.org_id=p_org AND p.job_id=j.id),'[]'::jsonb),
      'pendingSupplierCount',(SELECT count(*) FROM supplier_invoice_imports i
        WHERE i.org_id=p_org AND i.job_id=j.id AND i.status NOT IN ('approved','rejected','duplicate'))
    ) AS data FROM jobs j WHERE j.org_id=p_org AND j.id=p_job
  ) SELECT data || jsonb_build_object('revision',md5(data::text)) FROM evidence;
$$;
--> statement-breakpoint
CREATE FUNCTION mutate_estimation_observations(
  p_org UUID,p_actor UUID,p_key TEXT,p_action TEXT,p_request JSONB,p_job UUID,p_revision TEXT,p_payload JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
  v_op operation_results%ROWTYPE;
  v_evidence JSONB;
  v_entry JSONB;
  v_proposal estimation_rate_versions%ROWTYPE;
  v_rate production_rates%ROWTYPE;
  v_new_rate production_rates%ROWTYPE;
  v_result JSONB;
BEGIN
  IF p_key IS NULL OR length(p_key) NOT BETWEEN 1 AND 200 OR p_action NOT IN ('attribute','review','preview','apply','change-budget') THEN
    RAISE EXCEPTION 'A valid action and operation key are required.' USING ERRCODE='P0400';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships WHERE org_id=p_org AND user_id=p_actor AND role='owner') THEN
    RAISE EXCEPTION 'Only an owner can review closeout or approve rate versions.' USING ERRCODE='P0400';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('production-pricebook:' || p_org::text,0));
  SELECT * INTO v_op FROM operation_results WHERE org_id=p_org AND actor=p_actor::text
    AND action='estimation.' || p_action AND operation_key=p_key;
  IF FOUND THEN
    IF v_op.request <> p_request THEN RAISE EXCEPTION 'This operation key was used for different details.' USING ERRCODE='P0409'; END IF;
    RETURN v_op.result || '{"replayed":true}'::jsonb;
  END IF;
  IF p_action IN ('attribute','review','change-budget') THEN
    v_evidence := estimation_job_evidence(p_org,p_job);
    IF v_evidence IS NULL THEN RAISE EXCEPTION 'Job not found.' USING ERRCODE='P0404'; END IF;
    IF p_revision IS DISTINCT FROM v_evidence->>'revision' THEN
      RAISE EXCEPTION 'Job evidence changed. Reload and review it again.' USING ERRCODE='P0409';
    END IF;
  END IF;
  IF p_action='change-budget' THEN
    IF NOT EXISTS (SELECT 1 FROM change_orders WHERE org_id=p_org AND job_id=p_job
      AND id=(p_payload->>'changeOrderId')::uuid AND status IN ('approved','completed')) THEN
      RAISE EXCEPTION 'Select an approved change order from this job.' USING ERRCODE='P0404';
    END IF;
    IF EXISTS (SELECT 1 FROM estimation_change_budgets WHERE org_id=p_org AND change_order_id=(p_payload->>'changeOrderId')::uuid)
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_evidence->'changes') co
        WHERE co->>'id'=p_payload->>'changeOrderId' AND co->'budget' IS NOT NULL AND co->'budget' <> 'null'::jsonb) THEN
      RAISE EXCEPTION 'This change order already has an immutable operating budget.' USING ERRCODE='P0409';
    END IF;
    INSERT INTO estimation_change_budgets(org_id,job_id,change_order_id,budget,reviewed_by)
      VALUES(p_org,p_job,(p_payload->>'changeOrderId')::uuid,p_payload,p_actor);
    v_result := jsonb_build_object('jobId',p_job,'changeOrderId',p_payload->>'changeOrderId','budget',p_payload,'replayed',false);
  ELSIF p_action='attribute' THEN
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_evidence->'time') t
      WHERE t->>'id'=p_payload->>'timeEntryId' AND t->>'reviewStatus'='approved') THEN
      RAISE EXCEPTION 'Select approved time from this job.' USING ERRCODE='P0404';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM (
        SELECT v_evidence->'budget' AS budget UNION ALL
        SELECT c->'budget' FROM jsonb_array_elements(v_evidence->'changes') c WHERE c->>'status' IN ('approved','completed')
      ) b CROSS JOIN LATERAL jsonb_array_elements(b.budget->'calculation'->'items') item
      CROSS JOIN LATERAL jsonb_array_elements(item->'operations') op
      WHERE item->>'included'='true' AND (b.budget->'operationIds' ? (item->>'id') OR b.budget->'operationIds' ? (op->>'id'))
        AND (item->>'id') || ':' || (op->>'id')=p_payload->>'operationId'
    ) THEN RAISE EXCEPTION 'Select a task in the accepted job budget.' USING ERRCODE='P0400'; END IF;
    INSERT INTO estimation_time_attributions(org_id,job_id,time_entry_id,operation_id,reviewed_by)
      VALUES(p_org,p_job,(p_payload->>'timeEntryId')::uuid,p_payload->>'operationId',p_actor)
      ON CONFLICT(org_id,time_entry_id) DO UPDATE SET operation_id=EXCLUDED.operation_id,reviewed_by=p_actor,created_at=now()
      WHERE estimation_time_attributions.job_id=p_job;
    v_result := jsonb_build_object('jobId',p_job,'replayed',false);
  ELSIF p_action='review' THEN
    IF v_evidence->>'status' <> 'completed' THEN
      RAISE EXCEPTION 'Complete the job before reviewing closeout.' USING ERRCODE='P0409';
    END IF;
    FOR v_entry IN SELECT value FROM jsonb_array_elements(p_payload->'observations') LOOP
      IF EXISTS (SELECT 1 FROM estimation_observations WHERE org_id=p_org AND job_id=p_job
        AND operation_id=v_entry->>'operationId' AND evidence_revision=p_revision AND observation <> v_entry) THEN
        RAISE EXCEPTION 'This evidence already has an immutable closeout review. Correct the source evidence before reviewing again.' USING ERRCODE='P0409';
      END IF;
      INSERT INTO estimation_observations(org_id,job_id,operation_id,evidence_revision,observation,reviewed_by)
        VALUES(p_org,p_job,v_entry->>'operationId',p_revision,v_entry,p_actor)
        ON CONFLICT(org_id,job_id,operation_id,evidence_revision) DO NOTHING;
    END LOOP;
    v_result := jsonb_build_object('jobId',p_job,'revision',p_revision,'replayed',false);
  ELSIF p_action='preview' THEN
    SELECT * INTO v_rate FROM production_rates WHERE id=(p_payload->>'rateId')::uuid AND org_id=p_org AND is_active;
    IF NOT FOUND THEN RAISE EXCEPTION 'Rate not found.' USING ERRCODE='P0404'; END IF;
    IF v_rate.version <> (p_payload->>'expectedVersion')::integer THEN
      RAISE EXCEPTION 'The pricebook changed. Preview the current version.' USING ERRCODE='P0409';
    END IF;
    IF (p_payload->'suggestion'->>'suggestedRate')::numeric <= 0 THEN
      RAISE EXCEPTION 'A positive qualified rate is required.' USING ERRCODE='P0400';
    END IF;
    INSERT INTO estimation_rate_versions(org_id,source_rate_id,source_version,source_snapshot,suggestion,proposed_by)
      VALUES(p_org,v_rate.id,v_rate.version,to_jsonb(v_rate),p_payload->'suggestion',p_actor) RETURNING * INTO v_proposal;
    v_result := jsonb_build_object('proposal',to_jsonb(v_proposal),'replayed',false);
  ELSE
    SELECT * INTO v_proposal FROM estimation_rate_versions WHERE id=(p_payload->>'proposalId')::uuid AND org_id=p_org FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Rate preview not found.' USING ERRCODE='P0404'; END IF;
    IF v_proposal.status='applied' THEN
      v_result := jsonb_build_object('proposal',to_jsonb(v_proposal),'replayed',true);
    ELSE
      IF p_request->>'approve' IS DISTINCT FROM 'true' OR v_proposal.suggestion <> p_payload->'suggestion' THEN
        RAISE EXCEPTION 'Review and explicitly approve the current suggestion.' USING ERRCODE='P0409';
      END IF;
      FOR v_entry IN SELECT value FROM jsonb_array_elements(v_proposal.suggestion->'evidence') LOOP
        IF NOT EXISTS (SELECT 1 FROM estimation_observations o WHERE o.org_id=p_org
          AND o.id=(v_entry->>'observationId')::uuid AND o.job_id=(v_entry->>'jobId')::uuid
          AND o.evidence_revision=v_entry->>'revision' AND o.observation->>'qualified'='true'
          AND o.evidence_revision=estimation_job_evidence(p_org,o.job_id)->>'revision') THEN
          RAISE EXCEPTION 'Closeout evidence changed. Review and preview again.' USING ERRCODE='P0409';
        END IF;
      END LOOP;
      SELECT * INTO v_rate FROM production_rates WHERE id=v_proposal.source_rate_id AND org_id=p_org AND is_active FOR UPDATE;
      IF NOT FOUND OR v_rate.version <> v_proposal.source_version OR to_jsonb(v_rate) <> v_proposal.source_snapshot THEN
        RAISE EXCEPTION 'The pricebook changed. Preview the current version.' USING ERRCODE='P0409';
      END IF;
      -- Explicit approval creates a new row/version, retaining the previous pricebook row.
      -- Selling/burdened prices are cloned, never learned from production speed.
      INSERT INTO production_rates(org_id,category,surface_type,unit,rate_per_hour,hourly_rate,prep_multiplier,coats,
        description,rate_basis,coat_rates,application_method,selling_rate_source,burdened_rate,version,provenance,reviewed_at)
      VALUES(p_org,v_rate.category,v_rate.surface_type,v_rate.unit,
        CASE WHEN v_rate.rate_basis='complete_system' THEN v_rate.rate_per_hour ELSE (v_proposal.suggestion->>'suggestedRate')::numeric END,
        v_rate.hourly_rate,v_rate.prep_multiplier,v_rate.coats,v_rate.description,v_rate.rate_basis,
        CASE WHEN v_rate.rate_basis='complete_system' THEN v_rate.coat_rates || jsonb_build_object(v_rate.coats::text,v_proposal.suggestion->>'suggestedRate') ELSE v_rate.coat_rates END,
        v_rate.application_method,v_rate.selling_rate_source,v_rate.burdened_rate,v_rate.version+1,'manual',now())
        RETURNING * INTO v_new_rate;
      UPDATE production_rates SET is_active=false,updated_at=now() WHERE id=v_rate.id AND org_id=p_org;
      UPDATE estimation_rate_versions SET status='applied',approved_by=p_actor,approved_at=now(),applied_rate_id=v_new_rate.id
        WHERE id=v_proposal.id AND org_id=p_org RETURNING * INTO v_proposal;
      v_result := jsonb_build_object('proposal',to_jsonb(v_proposal),'replayed',false);
    END IF;
  END IF;
  INSERT INTO operation_results(org_id,action,actor,operation_key,request,result)
    VALUES(p_org,'estimation.' || p_action,p_actor::text,p_key,p_request,v_result);
  IF v_result->>'replayed' IS DISTINCT FROM 'true' THEN
    INSERT INTO audit_logs(org_id,user_id,action,entity_type,entity_id,metadata)
      VALUES(p_org,p_actor,'estimation.' || p_action,'estimation_observation',coalesce(p_job,v_proposal.id),
        jsonb_build_object('revision',p_revision,'proposalId',v_proposal.id));
  END IF;
  RETURN v_result;
END $$;
