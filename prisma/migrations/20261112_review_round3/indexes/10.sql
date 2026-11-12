-- Phase B (any time, after checks/02-redundant-index-coverage.sql succeeded). Run independently outside a transaction.
-- R12: "Product" (categoryId) is the leading column list of "Product_categoryId_isActive_isStorefrontVisible_stock_idx" (categoryId, isActive, isStorefrontVisible, stock DESC),
-- which serves every lookup this index can serve. Removed from schema.prisma.
DROP INDEX CONCURRENTLY IF EXISTS "Product_categoryId_idx";
