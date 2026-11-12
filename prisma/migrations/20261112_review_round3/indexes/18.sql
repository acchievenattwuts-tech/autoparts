-- Phase B (any time, after checks/02-redundant-index-coverage.sql succeeded). Run independently outside a transaction.
-- R12: "CreditNote" (cashBankAccountId) is the leading column list of "CreditNote_cashBankAccountId_cnDate_status_idx" (cashBankAccountId, cnDate DESC, status),
-- which serves every lookup this index can serve. Removed from schema.prisma.
DROP INDEX CONCURRENTLY IF EXISTS "CreditNote_cashBankAccountId_idx";
