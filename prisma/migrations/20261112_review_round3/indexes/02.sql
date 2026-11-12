-- Phase A. Run independently outside a transaction.
-- M5: plain lookup index replacing the old unique index (matches @@index([formType, taxYear, taxMonth, submissionType, additionalSeq]),
-- Prisma truncates the default name to 63 characters).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "WhtFiling_formType_taxYear_taxMonth_submissionType_addition_idx"
  ON "WhtFiling" ("formType", "taxYear", "taxMonth", "submissionType", "additionalSeq");
