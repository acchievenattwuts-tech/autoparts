import assert from "node:assert/strict";
import test from "node:test";
import { KNOWN_SEARCH_DRIFT_STATEMENTS } from "@/lib/prisma-db-push-guard";
// Importing the script must not run the diff or exit: it only runs when executed directly.
import {
  classifySchemaDrift, driftExitCode, EXIT_OK, EXIT_UNEXPECTED_DRIFT, KNOWN_UNMODELED_DRIFT_STATEMENTS,
} from "@/scripts/check-schema-drift";

const T4_INDEX_DROP = 'DROP INDEX "SupplierDebitNote_active_supplier_reference_key"';
const script = (...statements: string[]): string =>
  ["-- DropIndex", ...statements.map((statement) => `${statement};`)].join("\n");
const searchDrift = (): string[] => [...KNOWN_SEARCH_DRIFT_STATEMENTS];

test("T4: the allowlist holds exactly the partial expression index drop", () => {
  assert.deepEqual(KNOWN_UNMODELED_DRIFT_STATEMENTS, [T4_INDEX_DROP]);
});

test("T4: search drift plus the index drop is fully expected and exits 0", () => {
  const report = classifySchemaDrift(script(...searchDrift(), T4_INDEX_DROP));
  assert.deepEqual(report.unexpected, []);
  assert.deepEqual(report.unmodeledPresent, [T4_INDEX_DROP]);
  assert.deepEqual(report.knownMissing, []);
  assert.equal(driftExitCode(report), EXIT_OK);
});

test("T4: a diff without the index drop (Prisma skipped the expression index) still exits 0 and reports nothing missing", () => {
  const report = classifySchemaDrift(script(...searchDrift()));
  assert.deepEqual(report.unmodeledPresent, []);
  assert.deepEqual(report.knownMissing, []);
  assert.equal(driftExitCode(report), EXIT_OK);
});

test("T4: the allowance is narrow; every other statement still exits 1", () => {
  const others = [
    'DROP INDEX "SupplierDebitNote_active_supplier_reference_key_old"',
    'DROP INDEX "SupplierDebitNote_active_supplier_reference_key" CASCADE',
    'DROP INDEX "public"."SupplierDebitNote_active_supplier_reference_key"',
    // The old unique index still present (indexes/03.sql not run) and the new plain index missing (02.sql not run).
    'DROP INDEX "SupplierDebitNote_supplierId_supplierReferenceNo_key"',
    'CREATE INDEX "SupplierDebitNote_supplierId_supplierReferenceNo_idx" ON "SupplierDebitNote"("supplierId", "supplierReferenceNo")',
    'CREATE UNIQUE INDEX "SupplierDebitNote_active_supplier_reference_key" ON "SupplierDebitNote"("supplierId")',
    // Pending post-deploy migration 20260930_sale_item_quantity_decimal: deliberately NOT allowlisted.
    'ALTER TABLE "SaleItem" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(12,4)',
  ];
  for (const statement of others) {
    const report = classifySchemaDrift(script(...searchDrift(), T4_INDEX_DROP, statement));
    assert.deepEqual(report.unexpected, [statement], statement);
    assert.equal(driftExitCode(report), EXIT_UNEXPECTED_DRIFT, statement);
  }
});
