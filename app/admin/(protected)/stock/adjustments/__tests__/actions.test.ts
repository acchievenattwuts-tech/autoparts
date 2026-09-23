import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type Call = { name: string; args: unknown[] };
const calls: Call[] = [];
const record = (name: string, ...args: unknown[]) => calls.push({ name, args });
const called = (name: string) => calls.filter((c) => c.name === name);

let units: { productId: string; name: string; scale: number }[] = [];
let lastAdjustNo: string | null = null;
let claimCount = 1;

const tx = {
  $executeRaw: async (query: { strings?: string[]; values?: unknown[] }) => {
    record("$executeRaw", query.strings?.join("?"), query.values);
    return 0;
  },
  productUnit: { findMany: async () => units },
  product: {
    findMany: async () => [
      { id: "p1", inventoryTracking: "TRACKED", isLotControl: false, requireExpiryDate: false, avgCost: 10 },
    ],
  },
  adjustment: {
    findFirst: async (args: unknown) => {
      record("adjustment.findFirst", args);
      return lastAdjustNo ? { adjustNo: lastAdjustNo } : null;
    },
    create: async (args: { data: { adjustNo: string; items: { create: { productId: string; qtyAdjust: number; lineNo: number }[] } } }) => {
      record("adjustment.create", args);
      return {
        id: "adj-1",
        items: args.data.items.create.map((item, idx) => ({ id: `ai-${idx}`, reason: null, ...item })),
      };
    },
    updateMany: async (args: unknown) => {
      record("adjustment.updateMany", args);
      return { count: claimCount };
    },
  },
  stockCard: {
    deleteMany: async (args: unknown) => {
      record("stockCard.deleteMany", args);
      return { count: 1 };
    },
  },
};

const db = {
  adjustment: {
    findUnique: async () => ({
      id: "adj-1",
      adjustNo: "ADJ26090001",
      status: "ACTIVE",
      items: ["p1", "p2", "p1"].map((productId) => ({
        productId,
        product: { code: productId, name: productId },
      })),
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
      recalculateStockCardMany: async (_tx: unknown, ids: string[]) => record("recalculateStockCardMany", ids),
    },
  });
  await mock.module("@/lib/lot-control", {
    namedExports: {
      getLotAvailability: async () => [],
      writeAdjustmentLots: async () => undefined,
      reverseAdjustmentLotBalance: async (_tx: unknown, id: string, ids: string[]) =>
        record("reverseAdjustmentLotBalance", id, ids),
      validateLotRows: () => null,
    },
  });
});

beforeEach(() => {
  calls.length = 0;
  units = [{ productId: "p1", name: "กล่อง", scale: 12 }];
  lastAdjustNo = null;
  claimCount = 1;
});

const load = async () => import("../actions");

const adjustForm = (overrides: { adjustDate?: string; items?: unknown[] } = {}) => {
  const formData = new FormData();
  formData.set("adjustDate", overrides.adjustDate ?? "2026-09-23");
  formData.set(
    "items",
    JSON.stringify(
      overrides.items ?? [{ productId: "p1", unitName: "กล่อง", qty: 5, price: 20, type: "ADJUST_IN", lotItems: [] }],
    ),
  );
  return formData;
};

test("createAdjustment rejects a malformed adjustDate with a Thai error instead of throwing", { skip: moduleMocksUnavailable }, async () => {
  const { createAdjustment } = await load();
  for (const adjustDate of ["abc", "2026-9-23", "2026-13-45"]) {
    assert.deepEqual(await createAdjustment(adjustForm({ adjustDate })), { error: "รูปแบบวันที่ไม่ถูกต้อง" });
  }
  assert.equal(calls.length, 0, "nothing touched the database");
});

test("createAdjustment rejects malformed lot MFG/EXP dates but accepts empty ones", { skip: moduleMocksUnavailable }, async () => {
  const { createAdjustment } = await load();
  const lot = { lotNo: "L1", qty: 5, unitCost: 0, mfgDate: "01/09/2026", expDate: "" };
  const result = await createAdjustment(
    adjustForm({ items: [{ productId: "p1", unitName: "กล่อง", qty: 5, price: 20, type: "ADJUST_IN", lotItems: [lot] }] }),
  );
  assert.deepEqual(result, { error: "รูปแบบวันที่ไม่ถูกต้อง" });

  const ok = await createAdjustment(
    adjustForm({
      items: [{ productId: "p1", unitName: "กล่อง", qty: 5, price: 20, type: "ADJUST_IN", lotItems: [{ ...lot, mfgDate: "2026-09-01" }] }],
    }),
  );
  assert.equal(ok.success, true);
});

test("createAdjustment rejects an unknown unit instead of silently using scale 1", { skip: moduleMocksUnavailable }, async () => {
  const { createAdjustment } = await load();
  units = [];
  assert.deepEqual(await createAdjustment(adjustForm()), { error: "ไม่พบหน่วยนับที่เลือก" });
  assert.equal(called("adjustment.create").length, 0);
  assert.equal(called("writeStockCard").length, 0);
});

test("createAdjustment allocates ADJ number inside the transaction under a per-month lock; quantities unchanged", { skip: moduleMocksUnavailable }, async () => {
  const { createAdjustment } = await load();
  lastAdjustNo = "ADJ26090007";
  const result = await createAdjustment(adjustForm());
  assert.deepEqual(result, { success: true, adjustNo: "ADJ26090008" });

  const names = calls.map((c) => c.name);
  assert.ok(names.indexOf("$executeRaw") < names.indexOf("adjustment.findFirst"), "lock taken before reading the last number");
  const lock = called("$executeRaw")[0];
  assert.match(String(lock.args[0]), /pg_advisory_xact_lock\(hashtext\(\?\)\)/);
  assert.deepEqual(lock.args[1], ["ADJ2609"]);

  const created = called("adjustment.create")[0].args[0] as { data: { adjustNo: string; items: { create: { qtyAdjust: number }[] } } };
  assert.equal(created.data.adjustNo, "ADJ26090008");
  assert.equal(created.data.items.create[0].qtyAdjust, 60, "5 boxes x 12 = 60 base units");
  const card = called("writeStockCard")[0].args[0] as { docNo: string; qtyIn: number };
  assert.equal(card.docNo, "ADJ26090008");
  assert.equal(card.qtyIn, 60);
});

const cancelForm = () => {
  const formData = new FormData();
  formData.set("adjustmentId", "adj-1");
  return formData;
};

test("cancelAdjustment claims the document first and stops if another cancel already did", { skip: moduleMocksUnavailable }, async () => {
  const { cancelAdjustment } = await load();
  claimCount = 0;
  assert.deepEqual(await cancelAdjustment(cancelForm()), { error: "เอกสารถูกยกเลิกไปแล้ว" });
  assert.equal(called("reverseAdjustmentLotBalance").length, 0, "lot balances not reversed a second time");
  assert.equal(called("stockCard.deleteMany").length, 0);
  assert.equal(called("recalculateStockCardMany").length, 0);
});

test("cancelAdjustment reverses, deletes and recalculates every affected product in one batch", { skip: moduleMocksUnavailable }, async () => {
  const { cancelAdjustment } = await load();
  assert.deepEqual(await cancelAdjustment(cancelForm()), { success: true });
  const claim = called("adjustment.updateMany")[0].args[0] as { where: unknown; data: { status: string } };
  assert.deepEqual(claim.where, { id: "adj-1", status: { not: "CANCELLED" } });
  assert.equal(claim.data.status, "CANCELLED");
  assert.deepEqual(
    calls.map((c) => c.name),
    ["adjustment.updateMany", "reverseAdjustmentLotBalance", "stockCard.deleteMany", "recalculateStockCardMany"],
  );
  assert.deepEqual(called("recalculateStockCardMany")[0].args[0], ["p1", "p2"]);
  assert.equal(called("recalculateStockCard").length, 0);
});
