-- Phase B (any time, after checks/02-redundant-index-coverage.sql succeeded). Run independently outside a transaction.
-- R12: "Sale" (trackingToken) is the leading column list of unique "Sale_trackingToken_key" (trackingToken),
-- which serves every lookup this index can serve. Removed from schema.prisma.
DROP INDEX CONCURRENTLY IF EXISTS "Sale_trackingToken_idx";
