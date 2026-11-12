-- Phase B (any time, after checks/02-redundant-index-coverage.sql succeeded). Run independently outside a transaction.
-- R12: "UserLineRecipient" (recipientId) is the leading column list of unique "UserLineRecipient_recipientId_key" (recipientId),
-- which serves every lookup this index can serve. Removed from schema.prisma.
DROP INDEX CONCURRENTLY IF EXISTS "UserLineRecipient_recipientId_idx";
