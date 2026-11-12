-- Phase B (any time, after checks/02-redundant-index-coverage.sql succeeded). Run independently outside a transaction.
-- R12: "SupplierAdvance" (cashBankAccountId) is the leading column list of "SupplierAdvance_cashBankAccountId_advanceDate_status_idx" (cashBankAccountId, advanceDate DESC, status),
-- which serves every lookup this index can serve. Removed from schema.prisma.
DROP INDEX CONCURRENTLY IF EXISTS "SupplierAdvance_cashBankAccountId_idx";
