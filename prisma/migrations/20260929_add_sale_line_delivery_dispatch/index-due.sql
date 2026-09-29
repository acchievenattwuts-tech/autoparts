CREATE INDEX CONCURRENTLY IF NOT EXISTS "SaleLineDeliveryDispatch_state_nextAttemptAt_idx" ON "SaleLineDeliveryDispatch"("state", "nextAttemptAt");
