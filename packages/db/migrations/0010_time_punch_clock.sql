ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS source VARCHAR(50) NOT NULL DEFAULT 'manual';
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS review_status VARCHAR(50) NOT NULL DEFAULT 'approved';
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS review_reason TEXT;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS actual_start_at TIMESTAMP;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS actual_end_at TIMESTAMP;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS rounded_start_at TIMESTAMP;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS rounded_end_at TIMESTAMP;
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS start_latitude NUMERIC(10, 7);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS start_longitude NUMERIC(10, 7);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS start_accuracy_meters NUMERIC(10, 2);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS end_latitude NUMERIC(10, 7);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS end_longitude NUMERIC(10, 7);
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS end_accuracy_meters NUMERIC(10, 2);

CREATE TABLE IF NOT EXISTS time_punch_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  job_id UUID NOT NULL REFERENCES jobs(id),
  team_member_id UUID NOT NULL REFERENCES team_members(id),
  time_entry_id UUID REFERENCES time_entries(id),
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  started_at_actual TIMESTAMP NOT NULL,
  ended_at_actual TIMESTAMP,
  started_at_rounded TIMESTAMP NOT NULL,
  ended_at_rounded TIMESTAMP,
  rounding_increment_minutes INTEGER NOT NULL DEFAULT 15,
  start_latitude NUMERIC(10, 7) NOT NULL,
  start_longitude NUMERIC(10, 7) NOT NULL,
  start_accuracy_meters NUMERIC(10, 2),
  end_latitude NUMERIC(10, 7),
  end_longitude NUMERIC(10, 7),
  end_accuracy_meters NUMERIC(10, 2),
  review_required BOOLEAN NOT NULL DEFAULT false,
  review_reason TEXT,
  crew_note TEXT,
  reminder_sent_at TIMESTAMP,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS time_punch_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  punch_session_id UUID NOT NULL REFERENCES time_punch_sessions(id),
  event_type VARCHAR(50) NOT NULL,
  actor_user_id UUID REFERENCES users(id),
  latitude NUMERIC(10, 7),
  longitude NUMERIC(10, 7),
  accuracy_meters NUMERIC(10, 2),
  occurred_at TIMESTAMP NOT NULL DEFAULT now(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_time_punch_sessions_org_status ON time_punch_sessions(org_id, status);
CREATE INDEX IF NOT EXISTS idx_time_punch_sessions_member_status ON time_punch_sessions(team_member_id, status);
CREATE INDEX IF NOT EXISTS idx_time_punch_sessions_review ON time_punch_sessions(org_id, review_required);
