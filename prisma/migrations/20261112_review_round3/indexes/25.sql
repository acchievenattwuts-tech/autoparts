-- Phase B (any time, after checks/02-redundant-index-coverage.sql succeeded). Run independently outside a transaction.
-- R12: "SupplierAdvanceRefund" (cashBankAccountId) is the leading column list of "SupplierAdvanceRefund_cashBankAccountId_refundDate_status_idx" (cashBankAccountId, refundDate DESC, status),
-- which serves every lookup this index can serve. Removed from schema.prisma.
DROP INDEX CONCURRENTLY IF EXISTS "SupplierAdvanceRefund_cashBankAccountId_idx";
