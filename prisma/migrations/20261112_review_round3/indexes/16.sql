-- Phase B (any time, after checks/02-redundant-index-coverage.sql succeeded). Run independently outside a transaction.
-- R12: "Expense" (cashBankAccountId) is the leading column list of "Expense_cashBankAccountId_expenseDate_status_idx" (cashBankAccountId, expenseDate DESC, status),
-- which serves every lookup this index can serve. Removed from schema.prisma.
DROP INDEX CONCURRENTLY IF EXISTS "Expense_cashBankAccountId_idx";
