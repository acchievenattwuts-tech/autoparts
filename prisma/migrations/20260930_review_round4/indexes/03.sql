-- Run independently outside a transaction, AFTER 01.sql and 02.sql succeeded.
-- T4: drop the old unique index that also blocked reusing a cancelled DN's number (owner approved 2026-09-30).
DROP INDEX CONCURRENTLY IF EXISTS "SupplierDebitNote_supplierId_supplierReferenceNo_key";
