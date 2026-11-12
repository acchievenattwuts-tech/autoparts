-- Phase B (any time, after checks/02-redundant-index-coverage.sql succeeded). Run independently outside a transaction.
-- R12: "DeliveryTracking" (saleId) is the leading column list of unique "DeliveryTracking_saleId_key" (saleId),
-- which serves every lookup this index can serve. Removed from schema.prisma.
DROP INDEX CONCURRENTLY IF EXISTS "DeliveryTracking_saleId_idx";
