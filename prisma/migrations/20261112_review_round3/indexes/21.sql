-- Phase B (any time, after checks/02-redundant-index-coverage.sql succeeded). Run independently outside a transaction.
-- R12: "CashBankAccount" (type, isActive) is the leading column list of "CashBankAccount_type_isActive_isPrimaryTransferAccount_idx" (type, isActive, isPrimaryTransferAccount),
-- which serves every lookup this index can serve. Removed from schema.prisma.
DROP INDEX CONCURRENTLY IF EXISTS "CashBankAccount_type_isActive_idx";
