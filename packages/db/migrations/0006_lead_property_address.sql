ALTER TABLE leads ADD COLUMN IF NOT EXISTS street_address VARCHAR(255);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS state VARCHAR(50);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS postal_code VARCHAR(20);

CREATE INDEX IF NOT EXISTS leads_org_postal_code_idx ON leads(org_id, postal_code);

UPDATE leads
SET street_address = '742 Noe St', city = 'San Francisco', state = 'CA', postal_code = '94114'
WHERE street_address IS NULL AND name = 'Jessica Park';

UPDATE leads
SET street_address = '1818 Lake St', city = 'San Francisco', state = 'CA', postal_code = '94121'
WHERE street_address IS NULL AND name = 'Robert Chen';

UPDATE leads
SET street_address = '95 South Park St', city = 'San Francisco', state = 'CA', postal_code = '94107'
WHERE street_address IS NULL AND name = 'Emily Rivera';

UPDATE leads
SET street_address = '420 Bryant St', city = 'San Francisco', state = 'CA', postal_code = '94107'
WHERE street_address IS NULL AND name = 'Harper & Co Workspace';

UPDATE leads
SET street_address = '1120 Ralston Ave', city = 'Burlingame', state = 'CA', postal_code = '94010'
WHERE street_address IS NULL AND name = 'Thompson Residence';
