import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

/**
 * prisma/migrations/20261112_review_round3 (M5, M9, D2, R12): file shape, and the index semantics
 * run in PGlite. PGlite cannot run CREATE/DROP INDEX CONCURRENTLY ("tuple concurrently updated"),
 * so the test removes the word CONCURRENTLY before executing a file. That changes only the lock
 * mode used while building / dropping, not the index that results.
 */

const MIGRATION_DIR = join(process.cwd(), "prisma/migrations/20261112_review_round3");
const readMigrationFile = (path: string): string => readFileSync(join(MIGRATION_DIR, path), "utf8").replace(/\r\n/g, "\n");
const withoutConcurrently = (sql: string): string => sql.replace(/\bCONCURRENTLY\s+/g, "");
const indexFile = (number: number): string => readMigrationFile(`indexes/${String(number).padStart(2, "0")}.sql`);
const statementsOf = (sql: string): string[] =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter((statement) => statement.length > 0);

const PHASE_A = [1, 2, 3, 4];
const D2_FILES = [5, 6, 7];
const R12_FILES = Array.from({ length: 20 }, (_, index) => 8 + index);
const PHASE_C = [28, 29];

/** R12: [dropped index, table, its columns, covering index DDL as Prisma created it]. */
const R12_INDEXES: ReadonlyArray<readonly [string, string, string[], string]> = [
  ["User_username_idx", "User", ["username"], `CREATE UNIQUE INDEX "User_username_key" ON "User"("username")`],
  ["UserLineRecipient_recipientId_idx", "UserLineRecipient", ["recipientId"], `CREATE UNIQUE INDEX "UserLineRecipient_recipientId_key" ON "UserLineRecipient"("recipientId")`],
  ["Product_categoryId_idx", "Product", ["categoryId"], `CREATE INDEX "Product_categoryId_isActive_isStorefrontVisible_stock_idx" ON "Product"("categoryId", "isActive", "isStorefrontVisible", "stock" DESC)`],
  ["SearchKeyword_normalized_idx", "SearchKeyword", ["normalized"], `CREATE UNIQUE INDEX "SearchKeyword_normalized_kind_key" ON "SearchKeyword"("normalized", "kind")`],
  ["Sale_trackingToken_idx", "Sale", ["trackingToken"], `CREATE UNIQUE INDEX "Sale_trackingToken_key" ON "Sale"("trackingToken")`],
  ["DeliveryTracking_saleId_idx", "DeliveryTracking", ["saleId"], `CREATE UNIQUE INDEX "DeliveryTracking_saleId_key" ON "DeliveryTracking"("saleId")`],
  ["WarrantyClaim_warrantyId_idx", "WarrantyClaim", ["warrantyId"], `CREATE INDEX "WarrantyClaim_warrantyId_claimDate_idx" ON "WarrantyClaim"("warrantyId", "claimDate" DESC)`],
  ["ClaimStockBalance_claimId_idx", "ClaimStockBalance", ["claimId"], `CREATE UNIQUE INDEX "ClaimStockBalance_claimId_productId_lotNo_key" ON "ClaimStockBalance"("claimId", "productId", "lotNo")`],
  ["Expense_cashBankAccountId_idx", "Expense", ["cashBankAccountId"], `CREATE INDEX "Expense_cashBankAccountId_expenseDate_status_idx" ON "Expense"("cashBankAccountId", "expenseDate" DESC, "status")`],
  ["DeliveryCommissionRun_expenseId_idx", "DeliveryCommissionRun", ["expenseId"], `CREATE UNIQUE INDEX "DeliveryCommissionRun_expenseId_key" ON "DeliveryCommissionRun"("expenseId")`],
  ["CreditNote_cashBankAccountId_idx", "CreditNote", ["cashBankAccountId"], `CREATE INDEX "CreditNote_cashBankAccountId_cnDate_status_idx" ON "CreditNote"("cashBankAccountId", "cnDate" DESC, "status")`],
  ["PurchaseReturn_cashBankAccountId_idx", "PurchaseReturn", ["cashBankAccountId"], `CREATE INDEX "PurchaseReturn_cashBankAccountId_returnDate_status_idx" ON "PurchaseReturn"("cashBankAccountId", "returnDate" DESC, "status")`],
  ["Receipt_cashBankAccountId_idx", "Receipt", ["cashBankAccountId"], `CREATE INDEX "Receipt_cashBankAccountId_receiptDate_status_idx" ON "Receipt"("cashBankAccountId", "receiptDate" DESC, "status")`],
  ["CashBankAccount_type_isActive_idx", "CashBankAccount", ["type", "isActive"], `CREATE INDEX "CashBankAccount_type_isActive_isPrimaryTransferAccount_idx" ON "CashBankAccount"("type", "isActive", "isPrimaryTransferAccount")`],
  ["CustomerAdvance_cashBankAccountId_idx", "CustomerAdvance", ["cashBankAccountId"], `CREATE INDEX "CustomerAdvance_cashBankAccountId_advanceDate_status_idx" ON "CustomerAdvance"("cashBankAccountId", "advanceDate" DESC, "status")`],
  ["CustomerAdvanceRefund_cashBankAccountId_idx", "CustomerAdvanceRefund", ["cashBankAccountId"], `CREATE INDEX "CustomerAdvanceRefund_cashBankAccountId_refundDate_status_idx" ON "CustomerAdvanceRefund"("cashBankAccountId", "refundDate" DESC, "status")`],
  ["SupplierAdvance_cashBankAccountId_idx", "SupplierAdvance", ["cashBankAccountId"], `CREATE INDEX "SupplierAdvance_cashBankAccountId_advanceDate_status_idx" ON "SupplierAdvance"("cashBankAccountId", "advanceDate" DESC, "status")`],
  ["SupplierAdvanceRefund_cashBankAccountId_idx", "SupplierAdvanceRefund", ["cashBankAccountId"], `CREATE INDEX "SupplierAdvanceRefund_cashBankAccountId_refundDate_status_idx" ON "SupplierAdvanceRefund"("cashBankAccountId", "refundDate" DESC, "status")`],
  ["SupplierPayment_cashBankAccountId_idx", "SupplierPayment", ["cashBankAccountId"], `CREATE INDEX "SupplierPayment_cashBankAccountId_paymentDate_status_idx" ON "SupplierPayment"("cashBankAccountId", "paymentDate" DESC, "status")`],
  ["LotBalance_productId_idx", "LotBalance", ["productId"], `CREATE UNIQUE INDEX "LotBalance_productId_lotNo_key" ON "LotBalance"("productId", "lotNo")`],
];

const indexNames = async (db: PGlite, table: string): Promise<string[]> =>
  (await db.query<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE tablename = $1 ORDER BY indexname`, [table])).rows.map(
    (row) => row.indexname,
  );

const uniqueViolation = async (db: PGlite, sql: string): Promise<string | null> => {
  try {
    await db.exec(sql);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, /duplicate key value violates unique constraint/);
    return message.match(/unique constraint "([^"]+)"/)?.[1] ?? message;
  }
};

test("every indexes/*.sql holds exactly one CONCURRENTLY statement, numbered 01-29 with no gap", () => {
  const files = readdirSync(join(MIGRATION_DIR, "indexes")).sort();
  assert.deepEqual(files, Array.from({ length: 29 }, (_, index) => `${String(index + 1).padStart(2, "0")}.sql`));
  for (const file of files) {
    const statements = statementsOf(readMigrationFile(`indexes/${file}`));
    assert.equal(statements.length, 1, file);
    assert.match(statements[0], /^(CREATE (UNIQUE )?INDEX CONCURRENTLY IF NOT EXISTS|DROP INDEX CONCURRENTLY IF EXISTS) "/, file);
  }
  for (const number of PHASE_A) assert.match(statementsOf(indexFile(number))[0], /^CREATE /);
  for (const number of [...D2_FILES, ...R12_FILES, ...PHASE_C]) assert.match(statementsOf(indexFile(number))[0], /^DROP /);
});

test("R12: the drop files, the coverage check and schema.prisma name the same 20 indexes", () => {
  const dropped = R12_FILES.map((number) => statementsOf(indexFile(number))[0].match(/"([^"]+)"/)?.[1]);
  assert.deepEqual(dropped, R12_INDEXES.map(([name]) => name));
  const check = readMigrationFile("checks/02-redundant-index-coverage.sql");
  for (const [name, table, columns] of R12_INDEXES) {
    assert.ok(check.includes(`('${table}', '${name}', ARRAY[${columns.map((column) => `'${column}'`).join(", ")}])`), name);
  }
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8").replace(/\r\n/g, "\n");
  for (const [name, table, columns] of R12_INDEXES) {
    const start = schema.indexOf(`\nmodel ${table} {`);
    assert.ok(start >= 0, table);
    const block = schema.slice(start, schema.indexOf("\n}", start));
    assert.ok(!block.includes(`@@index([${columns.join(", ")}])`), `${name} removed from schema.prisma`);
  }
});

test("M5: after the migration a cancelled filing no longer blocks the same period; two live ones still collide", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TYPE "WhtFormType" AS ENUM ('PND3', 'PND53');
      CREATE TYPE "WhtFilingSubmissionType" AS ENUM ('NORMAL', 'ADDITIONAL');
      CREATE TYPE "WhtFilingStatus" AS ENUM ('DRAFT', 'FILED', 'CANCELLED');
      CREATE TABLE "WhtFiling" (
        "id" TEXT PRIMARY KEY, "filingNo" TEXT NOT NULL, "formType" "WhtFormType" NOT NULL,
        "taxMonth" INTEGER NOT NULL, "taxYear" INTEGER NOT NULL,
        "submissionType" "WhtFilingSubmissionType" NOT NULL DEFAULT 'NORMAL', "additionalSeq" INTEGER NOT NULL DEFAULT 0,
        "status" "WhtFilingStatus" NOT NULL DEFAULT 'DRAFT'
      );
      CREATE UNIQUE INDEX "WhtFiling_formType_taxYear_taxMonth_submissionType_addition_key"
        ON "WhtFiling"("formType", "taxYear", "taxMonth", "submissionType", "additionalSeq");`);
    const insert = (id: string, status: string): string =>
      `INSERT INTO "WhtFiling" ("id", "filingNo", "formType", "taxMonth", "taxYear", "status") VALUES ('${id}', 'WF2610000${id}', 'PND3', 10, 2569, '${status}');`;

    await db.exec(insert("1", "CANCELLED"));
    for (const number of [1, 2]) await db.exec(withoutConcurrently(indexFile(number)));
    // Phase A only: the old unique index still refuses the re-created period (deployed behaviour unchanged).
    assert.equal(await uniqueViolation(db, insert("2", "DRAFT")), "WhtFiling_formType_taxYear_taxMonth_submissionType_addition_key");

    await db.exec(withoutConcurrently(indexFile(29)));
    assert.equal(await uniqueViolation(db, insert("2", "DRAFT")), null, "re-create after cancel");
    assert.equal(await uniqueViolation(db, insert("3", "DRAFT")), "WhtFiling_active_period_key");
    await db.exec(`UPDATE "WhtFiling" SET "status" = 'FILED' WHERE "id" = '2';`);
    assert.equal(await uniqueViolation(db, insert("3", "DRAFT")), "WhtFiling_active_period_key", "FILED also holds the period");
    assert.equal(await uniqueViolation(db, insert("4", "CANCELLED")), null, "any number of cancelled filings");
    assert.deepEqual(await indexNames(db, "WhtFiling"), [
      "WhtFiling_active_period_key",
      "WhtFiling_formType_taxYear_taxMonth_submissionType_addition_idx",
      "WhtFiling_pkey",
    ]);
  } finally {
    await db.close();
  }
});

test("M9: ACTIVE order numbers are unique per channel ignoring case and surrounding spaces; cancelled ones are reusable", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TYPE "SaleChannel" AS ENUM ('STORE', 'SHOPEE', 'LAZADA');
      CREATE TYPE "DocStatus" AS ENUM ('ACTIVE', 'CANCELLED');
      CREATE TABLE "Sale" (
        "id" TEXT PRIMARY KEY, "saleNo" TEXT NOT NULL, "channel" "SaleChannel" NOT NULL DEFAULT 'STORE',
        "channelRefNo" TEXT, "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE'
      );
      CREATE UNIQUE INDEX "Sale_channel_channelRefNo_key" ON "Sale"("channel", "channelRefNo");`);
    const insert = (id: string, channel: string, ref: string | null, status = "ACTIVE"): string =>
      `INSERT INTO "Sale" VALUES ('${id}', 'SP${id}', '${channel}', ${ref === null ? "NULL" : `'${ref}'`}, '${status}');`;

    await db.exec(insert("1", "SHOPEE", "2411ABC"));
    await db.exec(insert("2", "SHOPEE", "2411OLD", "CANCELLED"));
    await db.exec(insert("3", "STORE", null));
    await db.exec(insert("4", "STORE", null));

    await db.exec(readMigrationFile("checks/01-sale-channel-ref-duplicates.sql"));
    for (const number of [3, 4]) await db.exec(withoutConcurrently(indexFile(number)));
    assert.equal(await uniqueViolation(db, insert("5", "SHOPEE", " 2411abc ")), "Sale_active_channel_ref_key");
    // Before Phase C the old unique index still refuses a cancelled sale's exact number.
    assert.equal(await uniqueViolation(db, insert("6", "SHOPEE", "2411OLD")), "Sale_channel_channelRefNo_key");

    await db.exec(withoutConcurrently(indexFile(28)));
    assert.equal(await uniqueViolation(db, insert("6", "SHOPEE", "2411OLD")), null, "a cancelled number is reusable");
    assert.equal(await uniqueViolation(db, insert("7", "SHOPEE", "2411old")), "Sale_active_channel_ref_key");
    assert.equal(await uniqueViolation(db, insert("8", "LAZADA", "2411ABC")), null, "another channel may use the number");
    assert.equal(await uniqueViolation(db, insert("9", "STORE", null)), null, "store sales without a number never collide");
    await db.exec(`UPDATE "Sale" SET "status" = 'CANCELLED' WHERE "id" = '1';`);
    assert.equal(await uniqueViolation(db, insert("10", "SHOPEE", "2411abc")), null, "the number is free once its sale is cancelled");
    assert.deepEqual(await indexNames(db, "Sale"), ["Sale_active_channel_ref_key", "Sale_channel_channelRefNo_idx", "Sale_pkey"]);
  } finally {
    await db.close();
  }
});

test("M9 guard: checks/01 refuses ACTIVE duplicates that differ only by case or spaces and names the sales", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TYPE "SaleChannel" AS ENUM ('STORE', 'SHOPEE', 'LAZADA');
      CREATE TYPE "DocStatus" AS ENUM ('ACTIVE', 'CANCELLED');
      CREATE TABLE "Sale" ("id" TEXT PRIMARY KEY, "saleNo" TEXT NOT NULL, "channel" "SaleChannel" NOT NULL, "channelRefNo" TEXT, "status" "DocStatus" NOT NULL);
      INSERT INTO "Sale" VALUES ('1', 'SP26110001', 'SHOPEE', '2411abc', 'ACTIVE'), ('2', 'SP26110002', 'SHOPEE', ' 2411ABC', 'ACTIVE'),
                                ('3', 'SP26110003', 'SHOPEE', '2411XYZ', 'CANCELLED'), ('4', 'SP26110004', 'SHOPEE', '2411xyz', 'ACTIVE');`);
    await assert.rejects(db.exec(readMigrationFile("checks/01-sale-channel-ref-duplicates.sql")), /SHOPEE 2411ABC: SP26110001, SP26110002/);
  } finally {
    await db.close();
  }
});

test("R12: the coverage check passes, fails when a covering index is missing, and the drops keep every covering index", async () => {
  const db = new PGlite();
  try {
    const tables = new Map<string, Set<string>>();
    const coveringColumns = (ddl: string): string[] =>
      [...(ddl.match(/\((.*)\)$/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    for (const [, table, columns, covering] of R12_INDEXES) {
      const set = tables.get(table) ?? new Set<string>();
      for (const column of [...columns, ...coveringColumns(covering)]) set.add(column);
      tables.set(table, set);
    }
    for (const [table, columns] of tables) {
      await db.exec(`CREATE TABLE "${table}" ("id" TEXT PRIMARY KEY, ${[...columns].map((column) => `"${column}" TEXT`).join(", ")});`);
    }
    for (const [name, table, columns, covering] of R12_INDEXES) {
      await db.exec(`CREATE INDEX "${name}" ON "${table}"(${columns.map((column) => `"${column}"`).join(", ")}); ${covering};`);
    }

    const check = readMigrationFile("checks/02-redundant-index-coverage.sql");
    await db.exec(check);
    await db.exec(`DROP INDEX "Receipt_cashBankAccountId_receiptDate_status_idx";`);
    await assert.rejects(db.exec(check), /No covering index found for: Receipt\.Receipt_cashBankAccountId_idx/);
    await db.exec(`CREATE INDEX "Receipt_cashBankAccountId_receiptDate_status_idx" ON "Receipt"("cashBankAccountId", "receiptDate" DESC, "status");`);

    for (const number of R12_FILES) await db.exec(withoutConcurrently(indexFile(number)));
    for (const [name, table, , covering] of R12_INDEXES) {
      const names = await indexNames(db, table);
      assert.ok(!names.includes(name), `${name} dropped`);
      assert.ok(names.includes(covering.match(/INDEX "([^"]+)"/)?.[1] ?? ""), `${table} keeps its covering index`);
    }
  } finally {
    await db.close();
  }
});

test("D2: the three raw-column trigram indexes are dropped and the f_unaccent indexes stay", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE product_search_documents (product_id TEXT PRIMARY KEY, search_text TEXT, oem_text TEXT, keyword_text TEXT);
      CREATE INDEX idx_product_search_documents_text_trgm ON product_search_documents (search_text);
      CREATE INDEX idx_product_search_documents_oem_trgm ON product_search_documents (oem_text);
      CREATE INDEX idx_product_search_documents_keyword_trgm ON product_search_documents (keyword_text);
      CREATE INDEX idx_psd_oem_unaccent_trgm ON product_search_documents (lower(oem_text));`);
    for (const number of D2_FILES) await db.exec(withoutConcurrently(indexFile(number)));
    // Dropping twice is a no-op (IF EXISTS).
    for (const number of D2_FILES) await db.exec(withoutConcurrently(indexFile(number)));
    assert.deepEqual(await indexNames(db, "product_search_documents"), ["idx_psd_oem_unaccent_trgm", "product_search_documents_pkey"]);
  } finally {
    await db.close();
  }
});
