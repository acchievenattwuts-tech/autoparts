import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type Call = { name: string; args: unknown[] };
const calls: Call[] = [];
const record = (name: string, ...args: unknown[]) => calls.push({ name, args });
const called = (name: string) => calls.filter((c) => c.name === name);

let lastDocNo: string | null = null;
let claimCount = 1;
let productIsLotControl = false;

const tx = {
  $executeRaw: async (query: { strings?: string[]; values?: unknown[] }) => {
    record("$executeRaw", query.strings?.join("?"), query.values);
    return 0;
  },
  balanceForward: {
    findFirst: async (args: unknown) => {
      record("balanceForward.findFirst", args);
      return lastDocNo ? { docNo: lastDocNo } : null;
    },
    create: async (args: { data: { docNo: string } }) => {
      record("balanceForward.create", args);
      return { id: "bf-1" };
    },
    updateMany: async (args: unknown) => {
      record("balanceForward.updateMany", args);
      return { count: claimCount };
    },
  },
  stockCard: {
    findFirst: async () => null,
    deleteMany: async (args: unknown) => {
      record("stockCard.deleteMany", args);
      return { count: 1 };
    },
  },
};

const db = {
  productUnit: { findUnique: async () => ({ scale: 12 }) },
  product: { findUnique: async () => ({ inventoryTracking: "TRACKED", isLotControl: productIsLotControl, requireExpiryDate: false }) },
  balanceForward: {
    findUnique: async () => ({
      id: "bf-1",
      docNo: "BF26090001",
      status: "ACTIVE",
      productId: "p1",
      product: { code: "P1", name: "สินค้า", isLotControl: false },
      user: null,
    }),
  },
  stockCard: { findMany: async () => [] },
};

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("@/lib/db", {
    namedExports: { db, dbTx: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx) },
  });
  await mock.module("@/lib/require-auth", {
    namedExports: { requirePermission: async () => ({ user: { id: "u1" } }) },
  });
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      diffEntity: () => ({ before: {}, after: {} }),
      getAuditActorFromSession: () => ({}),
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async () => undefined,
    },
  });
  await mock.module("@/lib/stock-card", {
    namedExports: {
      writeStockCard: async (_tx: unknown, input: unknown) => {
        record("writeStockCard", input);
        return "sc-1";
      },
      recalculateStockCard: async (_tx: unknown, productId: string) => record("recalculateStockCard", productId),
    },
  });
  await mock.module("@/lib/lot-control", {
    namedExports: {
      writePurchaseLots: async (...args: unknown[]) => record("writePurchaseLots", ...args.slice(1)),
      writeBalanceForwardLots: async (_tx: unknown, productId: string, lots: unknown) =>
        record("writeBalanceForwardLots", productId, lots),
      writeStockMovementLots: async (_tx: unknown, stockCardId: string, lots: unknown, direction: string) =>
        record("writeStockMovementLots", stockCardId, lots, direction),
      reversePurchaseLotBalance: async (_tx: unknown, id: string, productId: string) =>
        record("reversePurchaseLotBalance", id, productId),
      reverseBalanceForwardLotBalance: async (_tx: unknown, id: string, productId: string) =>
        record("reverseBalanceForwardLotBalance", id, productId),
      validateLotRows: () => null,
    },
  });
});

beforeEach(() => {
  calls.length = 0;
  lastDocNo = null;
  claimCount = 1;
  productIsLotControl = false;
});

const load = async () => import("../actions");

const bfForm = (docDate: string, lotItems?: unknown[]) => {
  const formData = new FormData();
  formData.set("productId", "p1");
  formData.set("unitName", "กล่อง");
  formData.set("qty", "2");
  formData.set("costPerBaseUnit", "15");
  formData.set("docDate", docDate);
  if (lotItems) formData.set("lotItems", JSON.stringify(lotItems));
  return formData;
};

test("createBF rejects a malformed docDate / lot date with a Thai error instead of throwing", { skip: moduleMocksUnavailable }, async () => {
  const { createBF } = await load();
  for (const docDate of ["abc", "2026-02-31x", "2026-13-01"]) {
    assert.deepEqual(await createBF(bfForm(docDate)), { error: "รูปแบบวันที่ไม่ถูกต้อง" });
  }
  const badLot = [{ lotNo: "L1", qty: 2, unitCost: 0, mfgDate: "", expDate: "31/12/2026" }];
  assert.deepEqual(await createBF(bfForm("2026-09-23", badLot)), { error: "รูปแบบวันที่ไม่ถูกต้อง" });
  assert.equal(called("balanceForward.create").length, 0);
});

test("createBF allocates the BF number inside the transaction under a per-month lock", { skip: moduleMocksUnavailable }, async () => {
  const { createBF } = await load();
  lastDocNo = "BF26090041";
  assert.deepEqual(await createBF(bfForm("2026-09-23")), { success: true, docNo: "BF26090042" });
  const names = calls.map((c) => c.name);
  assert.ok(names.indexOf("$executeRaw") < names.indexOf("balanceForward.findFirst"));
  assert.deepEqual(called("$executeRaw")[0].args[1], ["BF2609"]);
  const created = called("balanceForward.create")[0].args[0] as { data: { docNo: string; qtyInBase: number } };
  assert.equal(created.data.docNo, "BF26090042");
  assert.equal(created.data.qtyInBase, 24);
  assert.equal((called("writeStockCard")[0].args[0] as { docNo: string }).docNo, "BF26090042");
});

test("createBF for a lot-controlled product books lots without PurchaseItemLot and trails them on its StockCard", { skip: moduleMocksUnavailable }, async () => {
  const { createBF } = await load();
  productIsLotControl = true;
  const lots = [
    { lotNo: " L1 ", qty: 1.5, unitCost: 24, mfgDate: "", expDate: "2027-01-31" },
    { lotNo: "L2", qty: 0.5, unitCost: 36, mfgDate: "", expDate: "" },
  ];
  assert.deepEqual(await createBF(bfForm("2026-09-23", lots)), { success: true, docNo: "BF26090001" });

  assert.equal(called("writePurchaseLots").length, 0, "a BF id must never be written as a purchaseItemId");
  const [booked] = called("writeBalanceForwardLots");
  assert.equal(booked.args[0], "p1");
  const bookedLots = booked.args[1] as { lotNo: string; qtyInBase: number; unitCostBase: number; expDate: Date | null }[];
  // Same base-unit conversion as before (scale = 12).
  assert.deepEqual(bookedLots.map((l) => [l.lotNo, l.qtyInBase, l.unitCostBase]), [["L1", 18, 2], ["L2", 6, 3]]);
  assert.equal(bookedLots[1].expDate, null);

  const [trail] = called("writeStockMovementLots");
  assert.equal(trail.args[0], "sc-1", "lot movements hang off the StockCard row writeStockCard created");
  assert.equal(trail.args[1], booked.args[1]);
  assert.equal(trail.args[2], "in");
  const names = calls.map((c) => c.name);
  assert.ok(names.indexOf("writeStockCard") < names.indexOf("writeStockMovementLots"));
});

const cancelForm = () => {
  const formData = new FormData();
  formData.set("bfId", "bf-1");
  return formData;
};

test("cancelBF stops without reversing lots when another cancel already claimed the document", { skip: moduleMocksUnavailable }, async () => {
  const { cancelBF } = await load();
  claimCount = 0;
  assert.deepEqual(await cancelBF(cancelForm()), { error: "เอกสารถูกยกเลิกไปแล้ว" });
  assert.equal(called("reverseBalanceForwardLotBalance").length, 0);
  assert.equal(called("stockCard.deleteMany").length, 0);
  assert.equal(called("recalculateStockCard").length, 0);
});

test("cancelBF claims, reverses, deletes and recalculates in that order", { skip: moduleMocksUnavailable }, async () => {
  const { cancelBF } = await load();
  assert.deepEqual(await cancelBF(cancelForm()), { success: true });
  assert.deepEqual(
    calls.map((c) => c.name),
    ["balanceForward.updateMany", "reverseBalanceForwardLotBalance", "stockCard.deleteMany", "recalculateStockCard"],
  );
  assert.deepEqual(called("reverseBalanceForwardLotBalance")[0].args, ["bf-1", "p1"]);
  const claim = called("balanceForward.updateMany")[0].args[0] as { where: unknown };
  assert.deepEqual(claim.where, { id: "bf-1", status: { not: "CANCELLED" } });
});
