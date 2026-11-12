import assert from "node:assert/strict";
import test, { after, before, beforeEach, mock } from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { Prisma } from "@/lib/generated/prisma";
import {
  clampPurchaseLotBalances,
  reversePurchaseLotBalancesBatch,
  reversePurchaseLotBalancesForEdit,
} from "../purchase-lot-reversal";

// I3 (owner 2026-11-12) — lot-controlled purchases:
// - Editing a purchase nets the lot change instead of clamping at 0 midway: lot L1 bought 10, sold 4
//   (LotBalance 6 = Product.stock 6), purchase edited (new cost) → LotBalance stays 6.
// - An edit that would leave a lot under what was already used from it (L1 edited to 3 after 4 were
//   sold, the lot line removed, the lot renamed, a smaller unit) is blocked before any write, before the
//   transaction and again under the product locks.
// - Cancelling a purchase whose lot no longer holds the purchased quantity is blocked before any write.
// I5: cancel/update refuse a purchase that changed between the pre-read and the row lock.
// LotBalance / PurchaseItemLot run in an in-process Postgres (PGlite), so the real SQL of
// purchase-lot-reversal.ts is what moves the balances; the rest of the database is faked.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Row = Record<string, unknown>;

let pg: PGlite;
const SQL_PARAM = (value: unknown): unknown => (value instanceof Prisma.Decimal ? value.toString() : value);

/** $executeRaw as a tagged template or a Prisma.Sql, run on PGlite when it touches LotBalance. */
const executeRaw = async (strings: TemplateStringsArray | Prisma.Sql, ...values: unknown[]): Promise<number> => {
  const query = Array.isArray(strings) ? Prisma.sql(strings as TemplateStringsArray, ...(values as Prisma.Sql[])) : (strings as Prisma.Sql);
  if (!query.text.includes('"LotBalance"')) return 0;
  const result = await pg.query(query.text, query.values.map(SQL_PARAM));
  return result.affectedRows ?? 0;
};

const lotBalance = async (lotNo = "L1"): Promise<number | null> => {
  const result = await pg.query<{ qtyOnHand: string }>(
    `SELECT "qtyOnHand" FROM "LotBalance" WHERE "productId" = 'prod-1' AND "lotNo" = $1`, [lotNo]);
  return result.rows[0] ? Number(result.rows[0].qtyOnHand) : null;
};

/** The Prisma calls lib/lot-control and purchase-lot-reversal make on the lot tables, on PGlite. */
const lotTables: ModelOverrides = {
  purchaseItemLot: {
    findMany: async (args) => {
      const ids = ((args as { where: { purchaseItemId: { in: string[] } } }).where.purchaseItemId.in);
      const result = await pg.query<{ purchaseItemId: string; lotNo: string; qty: string }>(
        `SELECT "purchaseItemId", "lotNo", "qty" FROM "PurchaseItemLot" WHERE "purchaseItemId" = ANY($1) ORDER BY "id"`, [ids]);
      return result.rows.map((row) => ({ ...row, qty: new Prisma.Decimal(row.qty) }));
    },
    create: async (args) => {
      const { data } = args as { data: { purchaseItemId: string; lotNo: string; qty: Prisma.Decimal } };
      await pg.query(`INSERT INTO "PurchaseItemLot" ("purchaseItemId", "lotNo", "qty") VALUES ($1, $2, $3)`,
        [data.purchaseItemId, data.lotNo, data.qty.toString()]);
      return { id: "lot-row" };
    },
  },
  lotBalance: {
    upsert: async (args) => {
      const { create, update } = args as {
        create: { productId: string; lotNo: string; qtyOnHand: Prisma.Decimal };
        update: { qtyOnHand: { increment: Prisma.Decimal } };
      };
      await pg.query(
        `INSERT INTO "LotBalance" ("productId", "lotNo", "qtyOnHand") VALUES ($1, $2, $3)
         ON CONFLICT ("productId", "lotNo") DO UPDATE SET "qtyOnHand" = "LotBalance"."qtyOnHand" + $4`,
        [create.productId, create.lotNo, create.qtyOnHand.toString(), update.qtyOnHand.increment.toString()]);
      return {};
    },
  },
};

const makeClient = (overrides: () => ModelOverrides, calls: string[], lockedRow: () => Row) =>
  new Proxy(
    {},
    {
      get: (_target, modelName: string) => {
        if (modelName === "$executeRaw") return executeRaw;
        if (modelName === "$queryRaw") {
          return async (query: Prisma.Sql) => {
            if (/FROM "Product"[\s\S]*FOR UPDATE/.test(query.sql)) calls.push("lock:Product");
            return /FROM "Purchase"/.test(query.sql) ? [lockedRow()] : [];
          };
        }
        return new Proxy(
          {},
          {
            get: (_m, method: string) => {
              const override = overrides()[modelName]?.[method];
              return async (args: unknown) => {
                calls.push(`${modelName}.${method}`);
                if (override) return override(args);
                if (method === "findMany") return [];
                if (method.startsWith("find")) return null;
                if (method === "count") return 0;
                return { id: `${modelName}-id`, count: 1 };
              };
            },
          },
        );
      },
    },
  );

const PURCHASE_DATE = new Date("2026-10-31T17:00:00.000Z"); // 2026-11-01 in Thailand
const READ_UPDATED_AT = new Date("2026-11-01T03:00:00.000Z");

let txOverrides: ModelOverrides = {};
let dbOverrides: ModelOverrides = {};
const txCalls: string[] = [];
const criticalErrors: unknown[] = [];
/** updatedAt the Purchase row shows under the row lock. */
let lockedUpdatedAt: Date;
/** Sales that used lot L1 (the cancel guard names them). */
let lotSales: Row[] = [];
/** prod-1 is lot-controlled (switched off to model a product whose lot control was turned off later). */
let lotControlled = true;
/** Reads of the purchase's lot rows by the lot guard (cancel and edit share them). */
let guardLotReadCount = 0;

const UNITS = [{ productId: "prod-1", name: "ชิ้น", scale: 1 }, { productId: "prod-1", name: "แพ็ค", scale: 2 }];

const existingPurchase = (): Row => ({
  id: "po1", purchaseNo: "RR26110001", status: "ACTIVE", supplierId: "sup-1", supplier: null,
  purchaseDate: PURCHASE_DATE, updatedAt: READ_UPDATED_AT, purchaseType: "CREDIT_PURCHASE",
  shippingFee: 0, discount: 0, vatType: "NO_VAT", vatRate: 0, taxInvoiceNo: null, taxInvoiceDate: null,
  items: [{
    id: "pi-1", lineNo: 1, productId: "prod-1", quantity: new Prisma.Decimal(10), costPrice: 50, landedCost: 0,
    showQty: new Prisma.Decimal(10), showUnitName: "ชิ้น", moreDetail: null,
    lotItems: [{ lotNo: "L1", qty: new Prisma.Decimal(10), unitCost: new Prisma.Decimal(50), mfgDate: null, expDate: null }],
    product: { code: "P1", name: "คอยล์เย็น" },
  }],
  purchaseReturns: [], supplierPaymentItems: [],
});

/** The cancel guard's lot reads (lib/purchase-lot-reversal-guard.ts), from the same PGlite tables. */
const guardLotReads: ModelOverrides = {
  purchaseItemLot: {
    findMany: async () => {
      guardLotReadCount += 1;
      const result = await pg.query<{ lotNo: string; qty: string }>(`SELECT "lotNo", "qty" FROM "PurchaseItemLot" WHERE "purchaseItemId" = 'pi-1'`);
      return result.rows.map((row) => ({
        lotNo: row.lotNo, qty: Number(row.qty),
        purchaseItem: {
          productId: "prod-1",
          product: { inventoryTracking: "TRACKED", isLotControl: lotControlled, units: [{ name: "ชิ้น" }] },
          purchase: { purchaseNo: "RR26110001", purchaseDate: PURCHASE_DATE },
        },
      }));
    },
  },
  lotBalance: {
    findMany: async () => {
      const result = await pg.query<{ productId: string; lotNo: string; qtyOnHand: string }>(`SELECT * FROM "LotBalance"`);
      return result.rows.map((row) => ({ ...row, qtyOnHand: Number(row.qtyOnHand) }));
    },
  },
  saleItemLot: { findMany: async () => lotSales },
};

before(async () => {
  pg = new PGlite();
  await pg.exec(`
    CREATE TABLE "LotBalance" (
      "productId" TEXT NOT NULL, "lotNo" TEXT NOT NULL, "qtyOnHand" DECIMAL(12,4) NOT NULL DEFAULT 0,
      UNIQUE ("productId", "lotNo")
    );
    CREATE TABLE "PurchaseItemLot" (
      "id" SERIAL PRIMARY KEY, "purchaseItemId" TEXT NOT NULL, "lotNo" TEXT NOT NULL, "qty" DECIMAL(12,4) NOT NULL
    );
  `);
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls, () => ({ status: "ACTIVE", purchaseDate: PURCHASE_DATE, updatedAt: lockedUpdatedAt }));
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: makeClient(() => dbOverrides, [], () => ({})),
      dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
    },
  });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", {
    namedExports: { ...realAuth, requirePermission: async () => ({ user: { id: "user-1", name: "Tester", permissions: [] } }) },
  });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", {
    namedExports: { ...realAudit, getRequestContext: async () => ({}), safeWriteAuditLog: async () => undefined },
  });
  const realErrorReporting = await import("@/lib/error-reporting");
  await mock.module("@/lib/error-reporting", {
    namedExports: { ...realErrorReporting, reportCriticalError: async (error: unknown) => { criticalErrors.push(error); } },
  });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: { ...realStockCard, recalculateStockCardMany: async () => { txCalls.push("stockCard.recalculate"); } },
  });
  const realPurchaseLast = await import("@/lib/product-purchase-last");
  await mock.module("@/lib/product-purchase-last", {
    namedExports: { ...realPurchaseLast, refreshProductPurchaseLastFields: async () => undefined },
  });
  const realCashBank = await import("@/lib/cash-bank");
  await mock.module("@/lib/cash-bank", {
    namedExports: { ...realCashBank, replaceCashBankSourceMovements: async () => undefined, clearCashBankSourceMovements: async () => undefined },
  });
  const realPayments = await import("@/lib/document-payments");
  await mock.module("@/lib/document-payments", {
    namedExports: { ...realPayments, replaceDocumentPayments: async () => undefined, clearDocumentPayments: async () => undefined },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
  const realNextServer = await import("next/server");
  await mock.module("next/server", { namedExports: { ...realNextServer, after: () => undefined } });
});

after(async () => {
  await pg?.close();
});

/** Lot L1 of purchase line pi-1: bought `bought`, `sold` of it already sold. */
const seedLot = async (bought: number, sold: number): Promise<void> => {
  await pg.exec(`DELETE FROM "LotBalance"; DELETE FROM "PurchaseItemLot";`);
  await pg.query(`INSERT INTO "LotBalance" VALUES ('prod-1', 'L1', $1)`, [bought - sold]);
  await pg.query(`INSERT INTO "PurchaseItemLot" ("purchaseItemId", "lotNo", "qty") VALUES ('pi-1', 'L1', $1)`, [bought]);
};

beforeEach(() => {
  txCalls.length = 0;
  criticalErrors.length = 0;
  lockedUpdatedAt = READ_UPDATED_AT;
  lotSales = [];
  lotControlled = true;
  guardLotReadCount = 0;
  const units = { findMany: async () => UNITS };
  dbOverrides = { purchase: { findUnique: async () => existingPurchase() }, productUnit: units, ...guardLotReads };
  txOverrides = {
    saleItemLot: guardLotReads.saleItemLot,
    lotBalance: { ...lotTables.lotBalance, ...guardLotReads.lotBalance },
    // The reversal reads the lines' lot rows; the cancel guard reads the purchase's (with its date).
    purchaseItemLot: { ...lotTables.purchaseItemLot,
      findMany: async (args) => ((args as { where?: { purchaseItemId?: unknown } }).where?.purchaseItemId
        ? lotTables.purchaseItemLot.findMany(args)
        : guardLotReads.purchaseItemLot.findMany(args)) },
    productUnit: units,
    product: { findMany: async () => [{ id: "prod-1", inventoryTracking: "TRACKED", isLotControl: lotControlled, requireExpiryDate: false }] },
    purchaseItem: {
      // Deleting a purchase line cascades to its PurchaseItemLot rows.
      delete: async (args) => {
        const { where } = args as { where: { id: string } };
        await pg.query(`DELETE FROM "PurchaseItemLot" WHERE "purchaseItemId" = $1`, [where.id]);
        return {};
      },
      findMany: async () => [{ id: "pi-2", lineNo: 1 }],
    },
    stockCard: {
      groupBy: async () => [],
      findMany: async (args) => ((args as { where?: { referenceId?: unknown } }).where?.referenceId
        ? [{ id: "sc-2", referenceId: "pi-2" }]
        : []),
    },
  };
});

const editForm = (qty: number, costPrice: number, extra: Record<string, string> = {}): FormData => {
  const form = new FormData();
  const fields: Record<string, string> = {
    supplierId: "sup-1", purchaseDate: "2026-11-01", purchaseType: "CREDIT_PURCHASE", vatType: "NO_VAT", vatRate: "0",
    items: JSON.stringify([{ productId: "prod-1", unitName: "ชิ้น", qty, costPrice,
      lotItems: [{ lotNo: "L1", qty, unitCost: costPrice, mfgDate: "", expDate: "" }] }]),
    ...extra,
  };
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return form;
};

/** One prod-1 line of `qty` `unitName`, all of it in lot `lotNo` (no lot when lotNo is null). */
const editLineForm = (qty: number, unitName: string, lotNo: string | null): FormData => editForm(0, 0, {
  items: JSON.stringify([{ productId: "prod-1", unitName, qty, costPrice: 50,
    lotItems: lotNo ? [{ lotNo, qty, unitCost: 50, mfgDate: "", expDate: "" }] : [] }]),
});

const writeCalls = (): string[] =>
  txCalls.filter((call) => /\.(create|createMany|update|upsert|delete|deleteMany)$/.test(call));

const LOT_EDIT_REFUSED_4_USED =
  "ไม่สามารถดำเนินการได้ เนื่องจากLot L1 (ใช้ไปแล้ว 4 ชิ้น ต้องไม่ต่ำกว่า 4 ชิ้น) ที่รับเข้าจากใบซื้อนี้ถูกนำไปใช้ต่อแล้ว กรุณาแก้จำนวนไม่ให้ต่ำกว่าที่ใช้ไป หรือยกเลิกเอกสารที่ใช้ Lot ก่อน: SA26110001";

const purchaseLotRows = async (): Promise<Array<[string, number]>> =>
  (await pg.query<{ purchaseItemId: string; qty: string }>(`SELECT "purchaseItemId", "qty" FROM "PurchaseItemLot" ORDER BY "id"`))
    .rows.map((row) => [row.purchaseItemId, Number(row.qty)]);

const cancelForm = (): FormData => {
  const form = new FormData();
  form.set("purchaseId", "po1");
  return form;
};

// ── The SQL helpers on their own ────────────────────────────────────────────

test("helpers: bought 10, sold 4 — reverse-for-edit + add the same lot + clamp keeps 6 (the clamped reversal gave 10)", async () => {
  const tx = { ...lotTables, $executeRaw: executeRaw } as unknown as Parameters<typeof reversePurchaseLotBalancesForEdit>[0];
  const addLot = (qty: number) => lotTables.lotBalance.upsert({
    create: { productId: "prod-1", lotNo: "L1", qtyOnHand: new Prisma.Decimal(qty) },
    update: { qtyOnHand: { increment: new Prisma.Decimal(qty) } },
  });

  await seedLot(10, 4);
  const touched = await reversePurchaseLotBalancesForEdit(tx, [{ id: "pi-1", productId: "prod-1" }]);
  assert.equal(await lotBalance(), -4, "not clamped midway");
  await addLot(10);
  await clampPurchaseLotBalances(tx, touched);
  assert.equal(await lotBalance(), 6, "LotBalance 6 = Product.stock 6 (10 in − 4 sold)");

  // Before I3: GREATEST(6 − 10, 0) + 10.
  await seedLot(10, 4);
  await reversePurchaseLotBalancesBatch(tx, [{ id: "pi-1", productId: "prod-1" }]);
  await addLot(10);
  assert.equal(await lotBalance(), 10);
});

test("helpers: a lot nothing was sold from gives the same balance on both paths (unchanged)", async () => {
  const tx = { ...lotTables, $executeRaw: executeRaw } as unknown as Parameters<typeof reversePurchaseLotBalancesForEdit>[0];
  for (const newQty of [10, 7, 12]) {
    await seedLot(10, 0);
    const touched = await reversePurchaseLotBalancesForEdit(tx, [{ id: "pi-1", productId: "prod-1" }]);
    await lotTables.lotBalance.upsert({ create: { productId: "prod-1", lotNo: "L1", qtyOnHand: new Prisma.Decimal(newQty) },
      update: { qtyOnHand: { increment: new Prisma.Decimal(newQty) } } });
    await clampPurchaseLotBalances(tx, touched);
    const netted = await lotBalance();

    await seedLot(10, 0);
    await reversePurchaseLotBalancesBatch(tx, [{ id: "pi-1", productId: "prod-1" }]);
    await lotTables.lotBalance.upsert({ create: { productId: "prod-1", lotNo: "L1", qtyOnHand: new Prisma.Decimal(newQty) },
      update: { qtyOnHand: { increment: new Prisma.Decimal(newQty) } } });
    assert.equal(netted, await lotBalance(), `new quantity ${newQty}`);
    assert.equal(netted, newQty);
  }
});

test("helpers: no lines or no lots run no SQL", async () => {
  const calls: string[] = [];
  const tx = {
    purchaseItemLot: { findMany: async () => { calls.push("findMany"); return []; } },
    $executeRaw: async () => { calls.push("update"); return 0; },
  } as unknown as Parameters<typeof reversePurchaseLotBalancesForEdit>[0];
  assert.deepEqual(await reversePurchaseLotBalancesForEdit(tx, []), []);
  assert.deepEqual(calls, []);
  assert.deepEqual(await reversePurchaseLotBalancesForEdit(tx, [{ id: "a", productId: "p" }]), []);
  assert.deepEqual(calls, ["findMany"]);
  await clampPurchaseLotBalances(tx, []);
  assert.deepEqual(calls, ["findMany"]);
});

// ── updatePurchase / cancelPurchase ─────────────────────────────────────────

test("updatePurchase: bought 10, sold 4, cost edited → LotBalance stays 6 (= Product.stock)", { skip: moduleMocksUnavailable }, async () => {
  await seedLot(10, 4);
  const { updatePurchase } = await import("../actions");
  const result = await updatePurchase("po1", editForm(10, 55));
  assert.deepEqual(result, { success: true }, String(criticalErrors[0] ?? ""));
  assert.equal(await lotBalance(), 6);
  const lots = await pg.query<{ purchaseItemId: string; qty: string }>(`SELECT "purchaseItemId", "qty" FROM "PurchaseItemLot"`);
  assert.deepEqual(lots.rows.map((row) => [row.purchaseItemId, Number(row.qty)]), [["pi-2", 10]], "the new line holds the lot");
  assert.ok(txCalls.indexOf("stockCard.recalculate") > txCalls.lastIndexOf("lotBalance.upsert"));
});

test("updatePurchase: a lot nothing was sold from is edited exactly as before", { skip: moduleMocksUnavailable }, async () => {
  await seedLot(10, 0);
  const { updatePurchase } = await import("../actions");
  assert.deepEqual(await updatePurchase("po1", editForm(10, 55)), { success: true });
  assert.equal(await lotBalance(), 10);
});

test("updatePurchase: bought 10, sold 4, edited to 3 → refused naming lot, used, minimum and the sale; nothing written", { skip: moduleMocksUnavailable }, async () => {
  // Before the owner decision this saved and left LotBalance 0 while Product.stock went to −1.
  await seedLot(10, 4);
  lotSales = [{ saleItem: { sale: { id: "s1", saleNo: "SA26110001" } } }];
  const { updatePurchase } = await import("../actions");
  assert.deepEqual(await updatePurchase("po1", editForm(3, 50)), { error: LOT_EDIT_REFUSED_4_USED });
  assert.equal(await lotBalance(), 6);
  assert.deepEqual(await purchaseLotRows(), [["pi-1", 10]], "the purchase keeps its lot rows");
  assert.deepEqual(txCalls, [], "refused by the pre-check: no transaction");
  assert.equal(criticalErrors.length, 0, "a refusal is a user message, not a critical alert");
});

test("updatePurchase: bought 10, sold 4, edited to 4 or 12 → saved, LotBalance = new quantity − 4 (= Product.stock)", { skip: moduleMocksUnavailable }, async () => {
  const { updatePurchase } = await import("../actions");
  for (const newQty of [4, 12]) {
    await seedLot(10, 4);
    const result = await updatePurchase("po1", editForm(newQty, 50));
    assert.deepEqual(result, { success: true }, `new quantity ${newQty}: ${String(criticalErrors[0] ?? "")}`);
    assert.equal(await lotBalance(), newQty - 4, `new quantity ${newQty}: ${newQty} in − 4 sold`);
    assert.deepEqual(await purchaseLotRows(), [["pi-2", newQty]]);
  }
});

test("updatePurchase: after 4 were sold, removing the lot line, renaming the lot or a smaller unit is refused", { skip: moduleMocksUnavailable }, async () => {
  const { updatePurchase } = await import("../actions");
  lotSales = [{ saleItem: { sale: { id: "s1", saleNo: "SA26110001" } } }];
  const removeLine = editForm(0, 0, {
    items: JSON.stringify([{ productId: "prod-2", unitName: "ชิ้น", qty: 1, costPrice: 10, lotItems: [] }]),
  });
  const cases: Array<[string, FormData]> = [
    ["lot line removed", removeLine],
    ["lot renamed L1 → L9", editLineForm(10, "ชิ้น", "L9")],
    ["1 แพ็ค (2 in base) instead of 10 ชิ้น", editLineForm(1, "แพ็ค", "L1")],
  ];
  for (const [label, form] of cases) {
    await seedLot(10, 4);
    assert.deepEqual(await updatePurchase("po1", form), { error: LOT_EDIT_REFUSED_4_USED }, label);
    assert.equal(await lotBalance(), 6, label);
    assert.deepEqual(await purchaseLotRows(), [["pi-1", 10]], label);
  }
  assert.deepEqual(txCalls, []);

  // 2 แพ็ค = 4 in base covers the 4 used: saved, nothing left of the lot.
  await seedLot(10, 4);
  assert.deepEqual(await updatePurchase("po1", editLineForm(2, "แพ็ค", "L1")), { success: true });
  assert.equal(await lotBalance(), 0);
  assert.deepEqual(await purchaseLotRows(), [["pi-2", 4]]);
});

test("updatePurchase: a sale committed after the pre-check is still caught under the product locks", { skip: moduleMocksUnavailable }, async () => {
  await seedLot(10, 0);
  // The pre-check (db) sees the full lot; inside the transaction a sale has taken 4.
  txOverrides.lotBalance = { ...txOverrides.lotBalance, findMany: async () => [{ productId: "prod-1", lotNo: "L1", qtyOnHand: 6 }] };
  lotSales = [{ saleItem: { sale: { id: "s1", saleNo: "SA26110001" } } }];
  const { updatePurchase } = await import("../actions");
  assert.deepEqual(await updatePurchase("po1", editForm(3, 50)), { error: LOT_EDIT_REFUSED_4_USED });
  assert.equal(guardLotReadCount, 2, "checked before the transaction and again inside it");
  const lockAt = txCalls.indexOf("lock:Product");
  assert.ok(lockAt >= 0 && lockAt < txCalls.indexOf("lotBalance.findMany"), "the lot check runs under the product lock");
  assert.equal(await lotBalance(), 10, "nothing reversed");
  assert.deepEqual(await purchaseLotRows(), [["pi-1", 10]]);
  assert.deepEqual(writeCalls(), [], "refused before any write");
  assert.equal(criticalErrors.length, 0);
});

test("updatePurchase: a purchase without lots reads no lot rows and is edited as before", { skip: moduleMocksUnavailable }, async () => {
  await pg.exec(`DELETE FROM "LotBalance"; DELETE FROM "PurchaseItemLot";`);
  lotControlled = false;
  const plain = existingPurchase();
  const [line] = plain.items as Row[];
  plain.items = [{ ...line, lotItems: [] }];
  dbOverrides.purchase = { findUnique: async () => plain };
  const { updatePurchase } = await import("../actions");
  assert.deepEqual(await updatePurchase("po1", editLineForm(3, "ชิ้น", null)), { success: true });
  assert.equal(guardLotReadCount, 0, "no lot guard read, before or inside the transaction");
  assert.deepEqual(txCalls.filter((call) => call.startsWith("purchaseItemLot.") || call.startsWith("lotBalance.")),
    ["purchaseItemLot.findMany"], "only the removed line's lot lookup, as before");
});

test("updatePurchase: lots of a product no longer lot-controlled are not checked (clamped at 0 as before)", { skip: moduleMocksUnavailable }, async () => {
  // bought 10 as lot L1, sold 4, lot control switched off since: edited to 3 without lots → saved,
  // the old lot taken out (6 − 10) and clamped at 0, exactly as before the owner decision.
  await seedLot(10, 4);
  lotControlled = false;
  const { updatePurchase } = await import("../actions");
  assert.deepEqual(await updatePurchase("po1", editLineForm(3, "ชิ้น", null)), { success: true });
  assert.equal(await lotBalance(), 0);
  assert.deepEqual(await purchaseLotRows(), []);
});

test("cancelPurchase: a lot already sold from is blocked before any write, naming the sale", { skip: moduleMocksUnavailable }, async () => {
  await seedLot(10, 4);
  lotSales = [{ saleItem: { sale: { id: "s1", saleNo: "SA26110001" } } }];
  const { cancelPurchase } = await import("../actions");
  const result = await cancelPurchase(cancelForm());
  assert.equal(
    result.error,
    "ไม่สามารถดำเนินการได้ เนื่องจากLot L1 ที่รับเข้าจากใบซื้อนี้ถูกนำไปใช้ต่อแล้ว ยอดคงเหลือของ Lot ไม่พอให้ถอนออก กรุณายกเลิกเอกสารที่ใช้ Lot ก่อน: SA26110001",
  );
  assert.equal(await lotBalance(), 6);
  assert.deepEqual(txCalls, [], "refused by the pre-check: no transaction write");
  assert.equal(criticalErrors.length, 0);
});

test("cancelPurchase: a sale committed after the pre-check is still caught under the product locks", { skip: moduleMocksUnavailable }, async () => {
  await seedLot(10, 0);
  // The pre-check (db) sees the full lot; inside the transaction the sale has taken 4.
  txOverrides.lotBalance = { ...txOverrides.lotBalance, findMany: async () => [{ productId: "prod-1", lotNo: "L1", qtyOnHand: 6 }] };
  const { cancelPurchase } = await import("../actions");
  const result = await cancelPurchase(cancelForm());
  assert.match(result.error ?? "", /Lot L1 ที่รับเข้าจากใบซื้อนี้ถูกนำไปใช้ต่อแล้ว/);
  assert.equal(await lotBalance(), 10, "nothing reversed");
  assert.ok(!txCalls.includes("stockCard.deleteMany") && !txCalls.includes("purchase.update"));
});

test("cancelPurchase: a lot still fully on hand is cancelled as before", { skip: moduleMocksUnavailable }, async () => {
  await seedLot(10, 0);
  const { cancelPurchase } = await import("../actions");
  assert.deepEqual(await cancelPurchase(cancelForm()), { success: true });
  assert.equal(await lotBalance(), 0);
  assert.ok(txCalls.includes("purchase.update"));
});

test("I5: a purchase saved by someone else between the pre-read and the row lock is refused", { skip: moduleMocksUnavailable }, async () => {
  await seedLot(10, 0);
  lockedUpdatedAt = new Date("2026-11-01T03:05:00.000Z");
  const { cancelPurchase, updatePurchase } = await import("../actions");
  const message = "ใบซื้อ RR26110001 ถูกแก้ไขระหว่างดำเนินการ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง";
  assert.deepEqual(await cancelPurchase(cancelForm()), { error: message });
  assert.deepEqual(await updatePurchase("po1", editForm(10, 55)), { error: message });
  assert.equal(await lotBalance(), 10, "no lot moved");
  assert.deepEqual(txCalls.filter((call) => /\.(create|createMany|update|upsert|delete|deleteMany)$/.test(call)), []);
  assert.equal(criticalErrors.length, 0, "a lost race is a user message, not a critical alert");
});
