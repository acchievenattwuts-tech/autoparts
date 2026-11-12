-- Phase A. Run independently outside a transaction (safe before the code deploy).
-- M5: one non-cancelled filing per form / tax month / submission type / additional sequence, so a cancelled
-- filing can be redone with the same submission type. Production has 0 WhtFiling rows.
-- Stricter old unique index (indexes/29.sql) stays until Phase C, so the deployed code sees no change.
-- Not expressible in schema.prisma (partial index), listed in KNOWN_UNMODELED_DRIFT_STATEMENTS (scripts/check-schema-drift.ts).
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "WhtFiling_active_period_key"
  ON "WhtFiling" ("formType", "taxYear", "taxMonth", "submissionType", "additionalSeq")
  WHERE "status" <> 'CANCELLED';
