CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id),
  lead_id UUID REFERENCES leads(id),
  direction message_direction NOT NULL,
  from_number VARCHAR(50) NOT NULL,
  to_number VARCHAR(50) NOT NULL,
  body TEXT NOT NULL,
  twilio_sid VARCHAR(100),
  read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_messages_org_id ON messages(org_id);
CREATE INDEX idx_messages_lead_id ON messages(lead_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY messages_isolation ON messages
  USING (org_id = current_setting('app.current_org_id', true)::uuid);
