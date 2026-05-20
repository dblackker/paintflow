UPDATE leads
SET street_address = '742 Noe St', city = 'San Francisco', state = 'CA', postal_code = '94114'
WHERE (street_address IS NULL OR street_address = '')
  AND (phone = '+14155550101' OR email = 'jessica.park@example.com');

UPDATE leads
SET street_address = '1818 Lake St', city = 'San Francisco', state = 'CA', postal_code = '94121'
WHERE (street_address IS NULL OR street_address = '')
  AND (phone = '+14155550102' OR email = 'robert.chen@example.com');

UPDATE leads
SET street_address = '95 South Park St', city = 'San Francisco', state = 'CA', postal_code = '94107'
WHERE (street_address IS NULL OR street_address = '')
  AND (phone = '+14155550103' OR email = 'emily.rivera@example.com');

UPDATE leads
SET street_address = '420 Bryant St', city = 'San Francisco', state = 'CA', postal_code = '94107'
WHERE (street_address IS NULL OR street_address = '')
  AND (phone = '+14155550104' OR email = 'ops@harperco.example');

UPDATE leads
SET street_address = '1120 Ralston Ave', city = 'Burlingame', state = 'CA', postal_code = '94010'
WHERE (street_address IS NULL OR street_address = '')
  AND (phone = '+14155550105' OR email = 'thompson@example.com');
