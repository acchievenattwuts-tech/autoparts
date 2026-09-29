-- Run independently outside a transaction.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNote_supplierId_supplierReferenceNo_key" ON "SupplierDebitNote"("supplierId", "supplierReferenceNo");
