import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// Warranty claim redesign: cancelling a claim on a SALE warranty deletes it and
// appends a history line to the sale; cancelling an ON-SITE claim keeps the row as
// CANCELLED. Runs the real server actions against an in-memory store.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type WarrantyRow = {
  id: string;
  status: "ACTIVE" | "CANCELLED";
  createdVia: "AUTO_FROM_SALE" | "MANUAL";
  saleId: string | null;
  productId: string;
  unitSeq: number;
  lotNo: string | null;
  endDate: Date;
  product: { name: string; inventoryTracking: string; isLotControl: boolean; avgCost: number };
};
type ClaimRow = {
  id: string;
  claimNo: string;
  warrantyId: string;
  status: string;
  claimType: "REPLACE_NOW" | "CUSTOMER_WAIT";
  symptom: string | null;
  supplierName: string | null;
};
type PurchaseReturnRow = { id: string; returnNo: string; claimId: string | null; status: "ACTIVE" | "CANCELLED" };

let warranties: WarrantyRow[] = [];
let claims: ClaimRow[] = [];
let purchaseReturns: PurchaseReturnRow[] = [];
let sale: { id: string; saleNo: string; claimCancelNotes: string | null };
const calls: string[] = [];
const txAudits: Array<Record<string, unknown>> = [];
const safeAudits: Array<Record<string, unknown>> = [];
const criticalReports: unknown[] = [];
let claimSeq = 0;

type Where = Record<string, unknown>;

const claimView = (claim: ClaimRow) => {
  const warranty = warranties.find((w) => w.id === claim.warrantyId);
  return { ...claim, warranty: warranty ? { ...warranty, saleItem: null } : null, claimStockMovements: [] };
};

const fakeDb = {
  $queryRaw: async (query: { strings?: string[]; values?: unknown[] }) => {
    calls.push(`lock:${(query.strings ?? []).join("?").match(/FROM "(\w+)"/)?.[1]}:${String(query.values?.[0])}`);
    return [];
  },
  $executeRaw: async () => 0,
  user: { findUnique: async () => ({ name: "Tester", signatureUrl: null }) },
  warranty: {
    findUnique: async ({ where }: { where: Where }) => {
      const warranty = warranties.find((w) => w.id === where.id);
      if (!warranty) return null;
      return {
        ...warranty,
        saleItem: null,
        claims: claims.filter((c) => c.warrantyId === warranty.id && c.status !== "CANCELLED"),
      };
    },
  },
  warrantyClaim: {
    findUnique: async ({ where }: { where: Where }) => {
      const claim = claims.find((c) => c.id === where.id);
      return claim ? claimView(claim) : null;
    },
    findFirst: async ({ where }: { where: { claimNo: { startsWith: string } } }) => {
      const last = claims
        .map((c) => c.claimNo)
        .filter((no) => no.startsWith(where.claimNo.startsWith))
        .sort()
        .reverse()[0];
      return last ? { claimNo: last } : null;
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      claimSeq += 1;
      const row: ClaimRow = {
        id: `claim-${claimSeq}`,
        claimNo: String(data.claimNo),
        warrantyId: String(data.warrantyId),
        status: String(data.status),
        claimType: data.claimType as ClaimRow["claimType"],
        symptom: (data.symptom as string | undefined) ?? null,
        supplierName: (data.supplierName as string | null) ?? null,
      };
      claims.push(row);
      calls.push(`warrantyClaim.create:${row.claimNo}`);
      return { id: row.id };
    },
    update: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      const claim = claims.find((c) => c.id === where.id);
      if (!claim) throw new Error("claim not found");
      Object.assign(claim, data);
      calls.push(`warrantyClaim.update:${String(data.status)}`);
      return claim;
    },
    delete: async ({ where }: { where: Where }) => {
      calls.push(`warrantyClaim.delete:${String(where.id)}`);
      claims = claims.filter((c) => c.id !== where.id);
      return { id: where.id };
    },
  },
  purchaseReturn: {
    findMany: async ({ where }: { where: Where }) =>
      purchaseReturns.filter((pr) => pr.claimId === where.claimId && pr.status === where.status),
    updateMany: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      const matching = purchaseReturns.filter((pr) => pr.claimId === where.claimId && pr.status === where.status);
      matching.forEach((pr) => Object.assign(pr, data));
      calls.push(`purchaseReturn.updateMany:${String(where.status)}:${matching.length}`);
      return { count: matching.length };
    },
  },
  sale: {
    findUnique: async () => ({ ...sale }),
    update: async ({ data }: { data: { claimCancelNotes: string } }) => {
      sale.claimCancelNotes = data.claimCancelNotes;
      calls.push("sale.update");
      return sale;
    },
  },
  stockCard: {
    deleteMany: async () => ({ count: 0 }),
    findFirst: async () => null,
  },
};

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  await mock.module("@/lib/db", {
    namedExports: {
      ...realDb,
      db: fakeDb,
      dbTx: (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
    },
  });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", {
    namedExports: {
      ...realAuth,
      requirePermission: async () => ({ user: { id: "user-1", name: "นวพล", role: "ADMIN" } }),
    },
  });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", {
    namedExports: {
      ...realAudit,
      getRequestContext: async () => ({ ipAddress: null, userAgent: null }),
      safeWriteAuditLog: async (input: Record<string, unknown>) => {
        safeAudits.push(input);
      },
      writeAuditLogTx: async (_tx: unknown, input: Record<string, unknown>) => {
        txAudits.push(input);
      },
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
  const realClaimStock = await import("@/lib/claim-stock");
  await mock.module("@/lib/claim-stock", {
    namedExports: {
      ...realClaimStock,
      getOriginalClaimUnitCost: async () => ({ productId: "prod-1", lotNo: "", unitCost: 50 }),
      writeClaimStockMovement: async () => {
        calls.push("claimStock.write");
        return "movement-1";
      },
      reverseClaimStockMovements: async () => {
        calls.push("claimStock.reverse");
      },
    },
  });
  const realLotControl = await import("@/lib/lot-control");
  await mock.module("@/lib/lot-control", {
    namedExports: {
      ...realLotControl,
      reverseClaimLotBalance: async () => {
        calls.push("lot.reverse");
      },
    },
  });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", {
    namedExports: {
      ...realStockCard,
      writeStockCard: async () => {
        calls.push("stockCard.write");
        return "stock-card-1";
      },
      recalculateStockCard: async () => {
        calls.push("stockCard.recalc");
      },
    },
  });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
});

const FAR_FUTURE = new Date("2099-01-01T00:00:00Z");
const product = { name: "คอมเพรสเซอร์แอร์", inventoryTracking: "TRACKED", isLotControl: false, avgCost: 50 };

beforeEach(() => {
  warranties = [
    { id: "w-sale", status: "ACTIVE", createdVia: "AUTO_FROM_SALE", saleId: "sale-1", productId: "prod-1", unitSeq: 2, lotNo: "L-01", endDate: FAR_FUTURE, product },
    { id: "w-site", status: "ACTIVE", createdVia: "MANUAL", saleId: null, productId: "prod-1", unitSeq: 1, lotNo: null, endDate: FAR_FUTURE, product },
  ];
  claims = [
    { id: "c-sale", claimNo: "WC26090004", warrantyId: "w-sale", status: "SENT_TO_SUPPLIER", claimType: "CUSTOMER_WAIT", symptom: "ไม่เย็น", supplierName: "ซัพ A" },
    { id: "c-site", claimNo: "WCM26090001", warrantyId: "w-site", status: "DRAFT", claimType: "REPLACE_NOW", symptom: null, supplierName: null },
  ];
  purchaseReturns = [];
  sale = { id: "sale-1", saleNo: "SA2609240001", claimCancelNotes: "old line kept" };
  calls.length = 0;
  txAudits.length = 0;
  safeAudits.length = 0;
  criticalReports.length = 0;
});

const cancelForm = (claimId: string, cancelNote?: string): FormData => {
  const formData = new FormData();
  formData.set("claimId", claimId);
  if (cancelNote !== undefined) formData.set("cancelNote", cancelNote);
  return formData;
};

const createForm = (warrantyId: string): FormData => {
  const formData = new FormData();
  formData.set("warrantyId", warrantyId);
  formData.set("claimDate", "2026-09-25");
  formData.set("claimType", "CUSTOMER_WAIT");
  return formData;
};

test("cancelling without a note is refused before anything is touched", { skip: moduleMocksUnavailable }, async () => {
  const { cancelClaimAction } = await import("../actions");

  for (const note of [undefined, "", "   "]) {
    const result = await cancelClaimAction(cancelForm("c-sale", note));
    assert.deepEqual(result, { error: "กรุณาระบุหมายเหตุการยกเลิกใบเคลม" });
  }
  const tooLong = await cancelClaimAction(cancelForm("c-site", "ก".repeat(501)));
  assert.deepEqual(tooLong, { error: "หมายเหตุการยกเลิกต้องไม่เกิน 500 ตัวอักษร" });
  assert.deepEqual(calls, []);
  assert.equal(claims.length, 2);
});

test("sale claim cancel: stock reversed, cancelled PR detached, claim deleted, history appended, audit on the sale", { skip: moduleMocksUnavailable }, async () => {
  purchaseReturns = [{ id: "pr-old", returnNo: "PR26090001", claimId: "c-sale", status: "CANCELLED" }];
  const { cancelClaimAction } = await import("../actions");

  const result = await cancelClaimAction(cancelForm("c-sale", "  ลูกค้าเปลี่ยนใจ  "));

  assert.deepEqual(result, { success: true, deleted: true });
  assert.equal(claims.some((c) => c.id === "c-sale"), false, "claim row deleted");
  assert.equal(purchaseReturns[0].claimId, null, "cancelled purchase return no longer points at it");
  assert.deepEqual(calls, [
    "lock:Sale:sale-1",
    "claimStock.reverse",
    "lot.reverse",
    "stockCard.recalc",
    "purchaseReturn.updateMany:CANCELLED:1",
    "warrantyClaim.delete:c-sale",
    "sale.update",
  ]);

  const lines = (sale.claimCancelNotes ?? "").split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "old line kept", "existing history is never overwritten");
  assert.match(
    lines[1],
    /^\d{2}\/\d{2}\/\d{4}.* • นวพล • คอมเพรสเซอร์แอร์ \(ชิ้นที่ 2, Lot L-01\) • ประเภท: ลูกค้ารอเคลม • อาการ: ไม่เย็น • หมายเหตุ: ลูกค้าเปลี่ยนใจ$/,
  );
  assert.doesNotMatch(lines[1], /WC26090004/);

  assert.equal(txAudits.length, 1);
  const audit = txAudits[0];
  assert.equal(audit.action, "CANCEL");
  assert.equal(audit.entityType, "Sale");
  assert.equal(audit.entityId, "sale-1");
  assert.equal(audit.entityRef, "SA2609240001");
  const meta = audit.meta as Record<string, unknown>;
  assert.equal(meta.event, "WARRANTY_CLAIM_DELETED");
  assert.equal(meta.productName, "คอมเพรสเซอร์แอร์");
  assert.equal(meta.unitSeq, 2);
  assert.equal(meta.lotNo, "L-01");
  assert.equal(meta.claimType, "CUSTOMER_WAIT");
  assert.equal(meta.symptom, "ไม่เย็น");
  assert.equal(meta.supplierName, "ซัพ A");
  assert.equal(meta.statusAtCancel, "SENT_TO_SUPPLIER");
  assert.equal(meta.cancelNote, "ลูกค้าเปลี่ยนใจ");
  assert.doesNotMatch(JSON.stringify(audit), /WC26090004/, "no claim number in the sale log");
  assert.deepEqual(criticalReports, []);
});

test("sale claim cancel is refused while an ACTIVE purchase return uses the claim", { skip: moduleMocksUnavailable }, async () => {
  purchaseReturns = [{ id: "pr-live", returnNo: "PR26090002", claimId: "c-sale", status: "ACTIVE" }];
  const { cancelClaimAction } = await import("../actions");

  const result = await cancelClaimAction(cancelForm("c-sale", "ยกเลิก"));

  assert.deepEqual(result, { error: "ไม่สามารถดำเนินการได้ เนื่องจากถูกนำไปใช้ที่ใบลดหนี้ซื้อ: PR26090002" });
  assert.equal(claims.some((c) => c.id === "c-sale"), true);
  assert.deepEqual(calls, []);
});

test("after a sale claim is cancelled (deleted) the same warranty can be claimed again", { skip: moduleMocksUnavailable }, async () => {
  const { cancelClaimAction, createClaim } = await import("../actions");

  const blocked = await createClaim(createForm("w-sale"));
  assert.deepEqual(blocked, { error: "รายการประกันนี้มีใบเคลม WC26090004 ค้างอยู่แล้ว" });

  assert.deepEqual(await cancelClaimAction(cancelForm("c-sale", "เปิดผิด")), { success: true, deleted: true });

  calls.length = 0;
  const reopened = await createClaim(createForm("w-sale"));
  assert.equal(reopened.error, undefined);
  assert.match(reopened.claimNo ?? "", /^WC\d{8}$/, "sale claims stay in the WC series");
  assert.deepEqual(
    calls.slice(0, 2),
    ["lock:Sale:sale-1", "lock:Warranty:w-sale"],
    "the new claim re-checks under the Sale → Warranty locks",
  );
  assert.equal(claims.filter((c) => c.warrantyId === "w-sale").length, 1);
});

test("on-site claim cancel keeps the row as CANCELLED with the note in its audit, and the warranty can be claimed again", { skip: moduleMocksUnavailable }, async () => {
  const { cancelClaimAction, createClaim } = await import("../actions");

  const result = await cancelClaimAction(cancelForm("c-site", "ลูกค้าไม่มารับ"));

  assert.deepEqual(result, { success: true, deleted: false });
  assert.equal(claims.find((c) => c.id === "c-site")?.status, "CANCELLED");
  assert.equal(calls.includes("warrantyClaim.delete:c-site"), false);
  assert.equal(calls.includes("sale.update"), false);
  assert.equal(sale.claimCancelNotes, "old line kept");
  const claimAudit = safeAudits.find((audit) => audit.entityType === "WarrantyClaim");
  assert.equal(claimAudit?.action, "CANCEL");
  assert.deepEqual(claimAudit?.meta, { cancelNote: "ลูกค้าไม่มารับ" });

  const reopened = await createClaim(createForm("w-site"));
  assert.equal(reopened.claimNo, "WCM26090002", "on-site claims use the WCM series, never reused");
});

test("a cancelled on-site warranty cannot get a new claim (server check)", { skip: moduleMocksUnavailable }, async () => {
  const { createClaim } = await import("../actions");
  claims = claims.filter((c) => c.id !== "c-site");
  warranties[1].status = "CANCELLED";

  const result = await createClaim(createForm("w-site"));

  assert.deepEqual(result, { error: "รายการประกันนี้ถูกยกเลิกแล้ว ไม่สามารถเปิดเคลมได้" });
  assert.equal(calls.some((call) => call.startsWith("warrantyClaim.create")), false);
});

test("a warranty cancelled between the pre-check and the transaction is still refused under the lock", { skip: moduleMocksUnavailable }, async () => {
  const { createClaim } = await import("../actions");
  claims = claims.filter((c) => c.id !== "c-site");
  const original = fakeDb.warranty.findUnique;
  let reads = 0;
  fakeDb.warranty.findUnique = async (args: { where: Where }) => {
    reads += 1;
    const row = await original(args);
    // First read = pre-check (still ACTIVE); the in-transaction re-read sees CANCELLED.
    return row && reads > 1 ? { ...row, status: "CANCELLED" as const } : row;
  };
  try {
    const result = await createClaim(createForm("w-site"));
    assert.deepEqual(result, { error: "รายการประกันนี้ถูกยกเลิกแล้ว ไม่สามารถเปิดเคลมได้" });
    assert.equal(calls.some((call) => call.startsWith("warrantyClaim.create")), false);
    assert.deepEqual(criticalReports, [], "an expected refusal is not reported as a crash");
  } finally {
    fakeDb.warranty.findUnique = original;
  }
});
