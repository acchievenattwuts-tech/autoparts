-- Phase B (any time, after checks/02-redundant-index-coverage.sql succeeded). Run independently outside a transaction.
-- R12: "DeliveryCommissionRun" (expenseId) is the leading column list of unique "DeliveryCommissionRun_expenseId_key" (expenseId),
-- which serves every lookup this index can serve. Removed from schema.prisma.
DROP INDEX CONCURRENTLY IF EXISTS "DeliveryCommissionRun_expenseId_idx";
