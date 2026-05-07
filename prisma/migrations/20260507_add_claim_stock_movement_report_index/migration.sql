CREATE INDEX IF NOT EXISTS "ClaimStockMovement_docDate_movementType_idx"
ON "ClaimStockMovement"("docDate", "movementType");
