import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import {
  buildLockedLineError,
  isSaleLineUnchanged,
  matchLockedSaleLines,
  type IncomingSaleLine,
  type StoredSaleLine,
} from "../sale-claim-lock";
import { mergeClaimLockedItems } from "../sale-form-data";

// Sale edit while warranty claims exist: a claimed line is locked as a whole row,
// the date and customer are locked, VAT may change and other lines stay editable.

const stored: StoredSaleLine = {
  productId: "prod-1",
  quantity: 2,
  showQty: 2,
  showUnitName: "ชิ้น",
  salePrice: 900,
  unitListPrice: 1000,
  warrantyDays: 90,
  supplierId: "sup-1",
  supplierName: "ซัพ A",
  moreDetail: "สีดำ",
  lots: [{ lotNo: "L-01", qty: 2 }],
};

const incoming: IncomingSaleLine = {
  productId: "prod-1",
  unitName: "ชิ้น",
  qty: 2,
  salePrice: 900,
  unitListPrice: 1000,
  warrantyDays: 90,
  supplierId: "sup-1",
  supplierName: "ซัพ A",
  moreDetail: "สีดำ",
  lotItems: [{ lotNo: "L-01", qty: 2 }],
};

test("a locked line must come back identical — any field change breaks the lock", () => {
  assert.equal(isSaleLineUnchanged(stored, incoming, 1), true);
  const changes: Array<Partial<IncomingSaleLine>> = [
    { productId: "prod-2" },
    { unitName: "กล่อง" },
    { qty: 3, lotItems: [{ lotNo: "L-01", qty: 3 }] },
    { salePrice: 899 },
    { unitListPrice: 1100 },
    { warrantyDays: 30 },
    { supplierId: "sup-2" },
    { supplierName: "ซัพ B" },
    { moreDetail: "สีแดง" },
    { lotItems: [{ lotNo: "L-02", qty: 2 }] },
  ];
  for (const change of changes) {
    assert.equal(isSaleLineUnchanged(stored, { ...incoming, ...change }, 1), false, JSON.stringify(change));
  }
  // Legacy rows stored unitListPrice 0; the form shows max(list, net) for them.
  assert.equal(isSaleLineUnchanged({ ...stored, unitListPrice: 0 }, { ...incoming, unitListPrice: 900 }, 1), true);
});

test("locked lines pair with identical submitted lines in any order; missing ones are named in the error", () => {
  const locked = [{ saleItemId: "item-1", productName: "คอมเพรสเซอร์", claimNos: ["WC26090001"], stored }];
  const other: IncomingSaleLine = { ...incoming, productId: "prod-9", lotItems: [] };

  const moved = matchLockedSaleLines(locked, [other, incoming], () => 1);
  assert.deepEqual([...moved.matchedByNewIdx.entries()], [[1, "item-1"]]);
  assert.deepEqual(moved.violations, []);

  const removed = matchLockedSaleLines(locked, [other], () => 1);
  assert.equal(
    buildLockedLineError(removed.violations),
    "ไม่สามารถแก้ไขหรือลบรายการ \"คอมเพรสเซอร์\" (ใบเคลม WC26090001) ได้ เนื่องจากมีใบเคลมอ้างอิงอยู่ — รายการนี้ต้องคงเดิมทั้งแถว (สินค้า หน่วย จำนวน ราคา ส่วนลด ประกัน ซัพพลายเออร์ Lot และรายละเอียด)",
  );
});

test("restoring a draft keeps the server copy of claim-locked lines", () => {
  type Row = { id: string; claimLock?: { claimNos: string[] } };
  const lockedServer: Row = { id: "locked", claimLock: { claimNos: ["WC26090001"] } };
  const draftLockedEdited: Row = { id: "locked-edited", claimLock: { claimNos: ["WC26090001"] } };
  const draftFree: Row = { id: "free" };
  const otherServer: Row = { id: "x" };
  assert.deepEqual(mergeClaimLockedItems([draftLockedEdited, draftFree], [lockedServer, otherServer]), [lockedServer, draftFree]);
  assert.deepEqual(mergeClaimLockedItems([draftFree], [otherServer]), [draftFree]);
});

// ── updateSale / cancelSale end-to-end with the DB and side effects module-mocked ──

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type AnyAsync = (...args: unknown[]) => Promise<unknown>;
type ModelOverrides = Record<string, Record<string, AnyAsync>>;
type Call = { method: string; args: unknown };

const makeClient = (overrides: () => ModelOverrides, calls: Call[]) =>
  new Proxy(
    {},
    {
      get: (_target, modelName: string) => {
        if (modelName === "$executeRaw" || modelName === "$queryRaw") return async () => [];
        return new Proxy(
          {},
          {
            get: (_m, method: string) => {
              const override = overrides()[modelName]?.[method];
              return async (args: unknown) => {
                calls.push({ method: `${modelName}.${method}`, args });
                if (override) return override(args);
                if (method === "findMany") return [];
                if (method.startsWith("find")) return null;
                if (method === "count") return 0;
                return { id: `${modelName}-id`, count: 0 };
              };
            },
          },
        );
      },
    },
  );

const SALE_UPDATED_AT = new Date("2026-09-20T03:00:00.000Z");
let dbOverrides: ModelOverrides = {};
let txOverrides: ModelOverrides = {};
const dbCalls: Call[] = [];
const txCalls: Call[] = [];
const criticalReports: unknown[] = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  const fakeTx = makeClient(() => txOverrides, txCalls);
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: makeClient(() => dbOverrides, dbCalls),
      dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx),
    },
  });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", {
    namedExports: {
      ...realAuth,
      requirePermission: async () => ({ user: { id: "user-1", name: "Tester", role: "ADMIN" } }),
    },
  });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", {
    namedExports: {
      ...realAudit,
      getRequestContext: async () => ({ ipAddress: null, userAgent: null }),
      safeWriteAuditLog: async () => undefined,
      writeAuditLogTx: async () => undefined,
    },
  });
  const realErrorReporting = await import("@/lib/error-reporting");
  await mock.module("@/lib/error-reporting", {
    namedExports: {
      ...realErrorReporting,
      reportCriticalError: async (error: unknown) => {
        criticalReports.push(error);
      },
    },
  });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: { ...realStockCard, recalculateStockCard: async () => undefined },
  });
  const realLotControl = await import("@/lib/lot-control");
  await mock.module("@/lib/lot-control", {
    namedExports: { ...realLotControl, reverseSaleLotBalance: async () => undefined },
  });
  const realCashBank = await import("@/lib/cash-bank");
  await mock.module("@/lib/cash-bank", {
    namedExports: {
      ...realCashBank,
      clearCashBankSourceMovements: async () => undefined,
      replaceCashBankSourceMovements: async () => undefined,
    },
  });
  const realPayments = await import("@/lib/document-payments");
  await mock.module("@/lib/document-payments", {
    namedExports: {
      ...realPayments,
      clearDocumentPayments: async () => undefined,
      replaceDocumentPayments: async () => undefined,
    },
  });
  const realAmountRemain = await import("@/lib/amount-remain");
  await mock.module("@/lib/amount-remain", {
    namedExports: { ...realAmountRemain, recalculateSaleAmountRemain: async () => undefined },
  });
  const realWhtReceived = await import("@/lib/wht-received");
  await mock.module("@/lib/wht-received", {
    namedExports: {
      ...realWhtReceived,
      cancelWhtReceivedForDocument: async () => undefined,
      persistWhtReceived: async () => undefined,
    },
  });
  const realProfitFact = await import("@/lib/profit-fact");
  await mock.module("@/lib/profit-fact", {
    namedExports: { ...realProfitFact, rebuildSaleProfitFacts: async () => undefined },
  });
  const realProfitCache = await import("@/lib/profit-cache");
  await mock.module("@/lib/profit-cache", {
    namedExports: { ...realProfitCache, revalidateProfitDashboardCache: () => undefined },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
  const realNextServer = await import("next/server");
  await mock.module("next/server", { namedExports: { ...realNextServer, after: () => undefined } });
});

const lockedItem = {
  id: "item-locked",
  productId: "prod-1",
  quantity: 2,
  salePrice: 900,
  unitListPrice: 1000,
  warrantyDays: 90,
  supplierId: "sup-1",
  supplierName: "ซัพ A",
  moreDetail: "สีดำ",
  showQty: 2,
  showUnitName: "ชิ้น",
  product: { name: "คอมเพรสเซอร์" },
  lotItems: [] as Array<{ lotNo: string; qty: number }>,
};
const freeItem = {
  ...lockedItem,
  id: "item-free",
  productId: "prod-2",
  quantity: 1,
  salePrice: 100,
  unitListPrice: 100,
  warrantyDays: 0,
  supplierId: null,
  supplierName: null,
  moreDetail: null,
  showQty: 1,
  product: { name: "ไส้กรอง" },
};

const existingSale = {
  id: "sale1",
  saleNo: "SA2609200001",
  status: "ACTIVE",
  channel: "STORE",
  saleDate: new Date("2026-09-19T17:00:00.000Z"), // 2026-09-20 in Thailand
  customerId: "cust-1",
  quotationId: null,
  quotationRevision: null,
  updatedAt: SALE_UPDATED_AT,
  vatType: "NO_VAT",
  vatRate: 0,
  signerName: "Tester",
  signerSignatureUrl: null,
  signedAt: null,
  user: { name: "Tester", signatureUrl: null },
  items: [lockedItem, freeItem],
  creditNotes: [],
  receipts: [],
};

const claimOnLocked = { id: "claim-1", claimNo: "WC26090001", warranty: { saleItemId: "item-locked" } };

const lockedLinePayload = {
  productId: "prod-1",
  unitName: "ชิ้น",
  qty: 2,
  salePrice: 900,
  unitListPrice: 1000,
  lineDiscount: 200,
  warrantyDays: 90,
  supplierId: "sup-1",
  supplierName: "ซัพ A",
  moreDetail: "สีดำ",
  lotItems: [],
};

const saleForm = (overrides: Record<string, string> = {}, items: unknown[] = [lockedLinePayload]): FormData => {
  const formData = new FormData();
  const fields: Record<string, string> = {
    saleDate: "2026-09-20",
    customerId: "cust-1",
    paymentType: "CREDIT_SALE",
    fulfillmentType: "PICKUP",
    vatType: "NO_VAT",
    vatRate: "0",
    items: JSON.stringify(items),
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  return formData;
};

beforeEach(() => {
  dbCalls.length = 0;
  txCalls.length = 0;
  criticalReports.length = 0;
  const units = { findMany: async () => [{ productId: "prod-1", name: "ชิ้น", scale: 1 }, { productId: "prod-2", name: "ชิ้น", scale: 1 }] };
  dbOverrides = {
    sale: { findUnique: async () => existingSale },
    warrantyClaim: { findMany: async () => [claimOnLocked] },
    productUnit: units,
  };
  txOverrides = {
    sale: { findUnique: async () => ({ quotationId: null, status: "ACTIVE", updatedAt: SALE_UPDATED_AT }) },
    warrantyClaim: { findMany: async () => [claimOnLocked] },
  };
});

const txMethods = () => txCalls.map((call) => call.method);

test("updateSale rejects any change to a claim-locked line before writing anything", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  const expected = buildLockedLineError([{ saleItemId: "item-locked", productName: "คอมเพรสเซอร์", claimNos: ["WC26090001"] }]);

  for (const items of [
    [{ ...lockedLinePayload, qty: 1, lineDiscount: 100 }],
    [{ ...lockedLinePayload, salePrice: 950, lineDiscount: 100 }],
    [{ ...lockedLinePayload, moreDetail: "สีแดง" }],
    // the locked line removed (only the other line is sent back)
    [{ ...lockedLinePayload, productId: "prod-2", warrantyDays: 0, supplierId: "", supplierName: "", moreDetail: "" }],
  ]) {
    const result = await updateSale("sale1", saleForm({}, items));
    assert.deepEqual(result, { error: expected }, JSON.stringify(items));
  }
  assert.deepEqual(txCalls, [], "no transaction work at all");
});

test("updateSale locks the sale date and the customer while any claim exists", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");

  assert.deepEqual(await updateSale("sale1", saleForm({ saleDate: "2026-09-21" })), {
    error: "ไม่สามารถเปลี่ยนวันที่ขายได้ เนื่องจากมีใบเคลมอ้างอิงรายการในใบขายนี้: WC26090001",
  });
  assert.deepEqual(await updateSale("sale1", saleForm({ customerId: "cust-2" })), {
    error: "ไม่สามารถเปลี่ยนลูกค้าได้ เนื่องจากมีใบเคลมอ้างอิงรายการในใบขายนี้: WC26090001",
  });
  assert.deepEqual(txCalls, []);
});

test("updateSale allows a VAT change and edits to other lines while the claimed line stays untouched", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");

  // Locked line moved to the end, the free line removed, VAT switched on.
  const result = await updateSale("sale1", saleForm({ vatType: "EXCLUDING_VAT", vatRate: "7" }, [lockedLinePayload]));

  assert.deepEqual(result, { success: true });
  assert.deepEqual(criticalReports, []);
  const warrantyDeletes = txCalls.filter((call) => call.method === "warranty.deleteMany");
  assert.deepEqual(warrantyDeletes.map((call) => call.args), [{ where: { saleItemId: { in: ["item-free"] } } }]);
  const itemDeletes = txCalls.filter((call) => call.method === "saleItem.deleteMany");
  assert.deepEqual(itemDeletes.map((call) => call.args), [{ where: { id: { in: ["item-free"] } } }]);
  const lockedUpdate = txCalls.find((call) => call.method === "saleItem.update") as { args: { where: { id: string }; data: Record<string, unknown> } };
  assert.equal(lockedUpdate.args.where.id, "item-locked");
  assert.ok("subtotalAmount" in lockedUpdate.args.data, "VAT basis follows the header");
  assert.equal(txMethods().includes("saleItem.create"), false, "the claimed line is not rebuilt");
  const saleUpdate = txCalls.find((call) => call.method === "sale.update") as { args: { data: Record<string, unknown> } };
  assert.equal(saleUpdate.args.data.vatType, "EXCLUDING_VAT");
});

test("updateSale re-checks claims inside the transaction and refuses a claim opened meanwhile", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  txOverrides.warrantyClaim = {
    findMany: async () => [claimOnLocked, { id: "claim-2", claimNo: "WC26090002", warranty: { saleItemId: "item-free" } }],
  };

  const result = await updateSale("sale1", saleForm({}, [lockedLinePayload]));

  assert.deepEqual(result, {
    error: "มีการเปิดใบเคลมใหม่ระหว่างแก้ไข (WC26090002) กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง",
  });
  assert.equal(txMethods().includes("warranty.deleteMany"), false);
  assert.equal(txMethods().includes("sale.update"), false);
  assert.deepEqual(criticalReports, []);
});

test("cancelSale is refused while any claim exists on its warranties, listing the claim numbers", { skip: moduleMocksUnavailable }, async () => {
  const { cancelSale } = await import("../actions");
  dbOverrides = {
    sale: {
      findUnique: async () => ({
        ...existingSale,
        trackingToken: null,
        items: [{ id: "item-locked", productId: "prod-1" }],
        warranties: [{ id: "w-1", claims: [{ claimNo: "WC26090001" }] }],
      }),
    },
    warrantyClaim: { findMany: async () => [{ id: "claim-1", claimNo: "WC26090001" }] },
  };
  const formData = new FormData();
  formData.set("saleId", "sale1");

  const result = await cancelSale(formData);

  assert.deepEqual(result, { error: "ไม่สามารถดำเนินการได้ เนื่องจากถูกนำไปใช้ที่เอกสารปลายทาง: WC26090001" });
  const claimQuery = dbCalls.find((call) => call.method === "warrantyClaim.findMany");
  assert.deepEqual((claimQuery?.args as { where: unknown }).where, { warranty: { saleId: "sale1" } });
  assert.deepEqual(txCalls, []);
});

// ── updateSale returns the typed concurrent-edit messages instead of the generic error ──

const withConsoleErrorSpy = async (run: () => Promise<void>): Promise<number> => {
  let errors = 0;
  const spy = mock.method(console, "error", () => {
    errors += 1;
  });
  try {
    await run();
  } finally {
    spy.mock.restore();
  }
  return errors;
};

test("updateSale returns the concurrent-edit message when the sale changed after the form loaded", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  txOverrides.sale = {
    findUnique: async () => ({ quotationId: null, status: "ACTIVE", updatedAt: new Date("2026-09-20T03:05:00.000Z") }),
  };

  let result: Awaited<ReturnType<typeof updateSale>> | undefined;
  const consoleErrors = await withConsoleErrorSpy(async () => {
    result = await updateSale("sale1", saleForm({}, [lockedLinePayload]));
  });

  assert.deepEqual(result, { error: "ใบขายถูกแก้ไขระหว่างดำเนินการ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง" });
  assert.equal(txMethods().includes("sale.update"), false);
  assert.deepEqual(criticalReports, []);
  assert.equal(consoleErrors, 0, "an expected concurrent edit is not logged as an error");
});

test("updateSale returns the sale-status message when the sale was cancelled meanwhile", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  txOverrides.sale = {
    findUnique: async () => ({ quotationId: null, status: "CANCELLED", updatedAt: SALE_UPDATED_AT }),
  };

  let result: Awaited<ReturnType<typeof updateSale>> | undefined;
  const consoleErrors = await withConsoleErrorSpy(async () => {
    result = await updateSale("sale1", saleForm({}, [lockedLinePayload]));
  });

  assert.deepEqual(result, { error: "ใบขายไม่อยู่ในสถานะที่แก้ไขได้" });
  assert.equal(txMethods().includes("sale.update"), false);
  assert.deepEqual(criticalReports, []);
  assert.equal(consoleErrors, 0);
});

test("updateSale still hides unexpected errors behind the generic message", { skip: moduleMocksUnavailable }, async () => {
  const { updateSale } = await import("../actions");
  txOverrides.sale = {
    findUnique: async () => {
      throw new Error("connection reset");
    },
  };

  let result: Awaited<ReturnType<typeof updateSale>> | undefined;
  const consoleErrors = await withConsoleErrorSpy(async () => {
    result = await updateSale("sale1", saleForm({}, [lockedLinePayload]));
  });

  assert.deepEqual(result, { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" });
  assert.equal(consoleErrors, 1);
});
