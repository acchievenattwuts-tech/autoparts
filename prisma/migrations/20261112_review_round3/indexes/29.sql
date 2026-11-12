-- Phase C. Run independently outside a transaction, only AFTER the new code is live and indexes/01.sql + 02.sql succeeded.
-- M5: drop the old unique index that also counted CANCELLED filings. Created by prisma/scripts/wht-schema.sql as
-- CREATE UNIQUE INDEX (name truncated by Prisma to 63 characters), so DROP INDEX is the matching statement.
DROP INDEX CONCURRENTLY IF EXISTS "WhtFiling_formType_taxYear_taxMonth_submissionType_addition_key";
