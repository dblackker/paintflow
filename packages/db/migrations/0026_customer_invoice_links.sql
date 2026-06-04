ALTER TABLE "customer_invoices" ADD COLUMN IF NOT EXISTS "estimate_id" uuid REFERENCES "estimates"("id");
ALTER TABLE "customer_invoices" ADD COLUMN IF NOT EXISTS "change_order_id" uuid REFERENCES "change_orders"("id");
ALTER TABLE "customer_invoices" ADD COLUMN IF NOT EXISTS "stripe_checkout_session_id" varchar(255);

CREATE INDEX IF NOT EXISTS "customer_invoices_estimate_idx" ON "customer_invoices" ("estimate_id", "created_at");
CREATE INDEX IF NOT EXISTS "customer_invoices_change_order_idx" ON "customer_invoices" ("change_order_id", "created_at");
CREATE INDEX IF NOT EXISTS "customer_invoices_stripe_session_idx" ON "customer_invoices" ("stripe_checkout_session_id") WHERE "stripe_checkout_session_id" IS NOT NULL;
