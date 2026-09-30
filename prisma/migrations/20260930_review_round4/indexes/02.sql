-- Run independently outside a transaction.
-- T4: plain lookup index replacing the old unique index (matches @@index([supplierId, supplierReferenceNo])).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNote_supplierId_supplierReferenceNo_idx"
  ON "SupplierDebitNote" ("supplierId", "supplierReferenceNo");
