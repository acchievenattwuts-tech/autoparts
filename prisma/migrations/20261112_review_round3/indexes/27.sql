-- Phase B (any time, after checks/02-redundant-index-coverage.sql succeeded). Run independently outside a transaction.
-- R12: "LotBalance" (productId) is the leading column list of unique "LotBalance_productId_lotNo_key" (productId, lotNo),
-- which serves every lookup this index can serve. Removed from schema.prisma.
DROP INDEX CONCURRENTLY IF EXISTS "LotBalance_productId_idx";
