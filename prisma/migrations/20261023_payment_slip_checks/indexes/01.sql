-- Run independently outside a transaction.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "PaymentSlip_referenceNoKey_idx" ON "PaymentSlip"("referenceNoKey");
