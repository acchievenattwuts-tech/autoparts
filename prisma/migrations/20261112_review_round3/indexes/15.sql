-- Phase B (any time, after checks/02-redundant-index-coverage.sql succeeded). Run independently outside a transaction.
-- R12: "ClaimStockBalance" (claimId) is the leading column list of unique "ClaimStockBalance_claimId_productId_lotNo_key" (claimId, productId, lotNo),
-- which serves every lookup this index can serve. Removed from schema.prisma.
DROP INDEX CONCURRENTLY IF EXISTS "ClaimStockBalance_claimId_idx";
