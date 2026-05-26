ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS contractor_signature JSONB;
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS customer_signature_name VARCHAR(255);
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS customer_signature_data TEXT;
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS customer_signed_at TIMESTAMP;
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMP;
ALTER TABLE change_orders ADD COLUMN IF NOT EXISTS canceled_reason TEXT;
