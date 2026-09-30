-- Run independently outside a transaction.
-- T4: a supplier's DN number may be reused after the earlier DN is cancelled, but never twice among ACTIVE DNs.
-- The key must match normalizeSupplierReferenceKey() in lib/supplier-debit-note.ts:
-- upper-case, with spaces, tabs, '.', '/' and '-' removed.
-- Not expressible in schema.prisma (partial expression index); listed as known drift in scripts/check-schema-drift.ts.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "SupplierDebitNote_active_supplier_reference_key"
  ON "SupplierDebitNote" ("supplierId", upper(regexp_replace("supplierReferenceNo", '[ \t./-]', '', 'g')))
  WHERE "status" = 'ACTIVE';
