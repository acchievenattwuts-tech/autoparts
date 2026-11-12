-- Phase B (any time, after checks/02-redundant-index-coverage.sql succeeded). Run independently outside a transaction.
-- R12: "SupplierPayment" (cashBankAccountId) is the leading column list of "SupplierPayment_cashBankAccountId_paymentDate_status_idx" (cashBankAccountId, paymentDate DESC, status),
-- which serves every lookup this index can serve. Removed from schema.prisma.
DROP INDEX CONCURRENTLY IF EXISTS "SupplierPayment_cashBankAccountId_idx";
