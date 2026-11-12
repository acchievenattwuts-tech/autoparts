-- Phase B (any time, after checks/02-redundant-index-coverage.sql succeeded). Run independently outside a transaction.
-- R12: "Receipt" (cashBankAccountId) is the leading column list of "Receipt_cashBankAccountId_receiptDate_status_idx" (cashBankAccountId, receiptDate DESC, status),
-- which serves every lookup this index can serve. Removed from schema.prisma.
DROP INDEX CONCURRENTLY IF EXISTS "Receipt_cashBankAccountId_idx";
