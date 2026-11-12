-- Phase B (any time, after checks/02-redundant-index-coverage.sql succeeded). Run independently outside a transaction.
-- R12: "WarrantyClaim" (warrantyId) is the leading column list of "WarrantyClaim_warrantyId_claimDate_idx" (warrantyId, claimDate DESC) and "WarrantyClaim_warrantyId_status_idx",
-- which serves every lookup this index can serve. Removed from schema.prisma.
DROP INDEX CONCURRENTLY IF EXISTS "WarrantyClaim_warrantyId_idx";
