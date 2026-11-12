import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { AuditAction, Prisma } from "@/lib/generated/prisma";

// M5 + filing number (review round 3): the Server Actions refuse to cancel a FILED filing on the
// server with a Thai message, map a unique-period violation to the existing message, and number a
// new filing by its tax month. The cancel / create flows that were allowed before stay the same.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type FilingRow = { filingNo: string; status: "DRAFT" | "FILED" | "CANCELLED"; totalRecords: number };

let storedFiling: FilingRow | null;
let txFilingStatus: FilingRow["status"] | null;
let createError: Error | null;
let txCalls: string[] = [];
let txUsed = 0;
let audits: Array<{ action: AuditAction; entityRef?: string; after?: Record<string, unknown> }> = [];
let criticalReports = 0;

const fakeTx = {
  $executeRaw: async () => {
    txCalls.push("lock");
    return 0;
  },
  whtCertificate: {
    findMany: async () => {
      txCalls.push("whtCertificate.findMany");
      return [{ id: "cert-1", totalBaseAmount: new Prisma.Decimal("1000"), totalTaxAmount: new Prisma.Decimal("30") }];
    },
    updateMany: async () => {
      txCalls.push("whtCertificate.updateMany");
      return { count: 1 };
    },
  },
  whtFiling: {
    findFirst: async () => {
      txCalls.push("whtFiling.findFirst");
      return null;
    },
    findUnique: async () => {
      txCalls.push("whtFiling.findUnique");
      return txFilingStatus && storedFiling ? { status: txFilingStatus, filingNo: storedFiling.filingNo } : null;
    },
    create: async ({ data }: { data: { filingNo: string } }) => {
      txCalls.push("whtFiling.create");
      if (createError) throw createError;
      return { id: "filing-new", filingNo: data.filingNo };
    },
    update: async () => {
      txCalls.push("whtFiling.update");
      return {};
    },
  },
};

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
  await mock.module("@/lib/db", {
    namedExports: {
      db: { whtFiling: { findUnique: async () => (storedFiling ? { ...storedFiling } : null) } },
      dbTx: async <T>(fn: (tx: typeof fakeTx) => Promise<T>): Promise<T> => {
        txUsed += 1;
        return fn(fakeTx);
      },
    },
  });
  await mock.module("@/lib/require-auth", {
    namedExports: { requirePermission: async () => ({ user: { id: "admin-1" } }) },
  });
  await mock.module("@/lib/error-reporting", {
    namedExports: {
      reportCriticalError: async () => {
        criticalReports += 1;
      },
    },
  });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      diffEntity: (beforeValue: Record<string, unknown>, afterValue: Record<string, unknown>) => ({ before: beforeValue, after: afterValue }),
      getAuditActorFromSession: () => ({ userId: "admin-1" }),
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async (entry: { action: AuditAction; entityRef?: string; after?: Record<string, unknown> }) => {
        audits.push(entry);
      },
    },
  });
});

beforeEach(() => {
  storedFiling = { filingNo: "WF26100001", status: "DRAFT", totalRecords: 3 };
  txFilingStatus = "DRAFT";
  createError = null;
  txCalls = [];
  txUsed = 0;
  audits = [];
  criticalReports = 0;
});

const cancelForm = (): FormData => {
  const formData = new FormData();
  formData.set("filingId", "filing-1");
  formData.set("cancelNote", "จัดรอบใหม่");
  return formData;
};

const createForm = (): FormData => {
  const formData = new FormData();
  formData.set("formType", "PND3");
  formData.set("taxMonth", "10");
  formData.set("taxYear", "2569");
  formData.set("submissionType", "NORMAL");
  formData.set("additionalSeq", "0");
  formData.set("surchargeAmount", "0");
  return formData;
};

test("cancelFiling refuses a FILED filing with its number and touches nothing", { skip: moduleMocksUnavailable }, async () => {
  const { cancelFiling } = await import("../actions");
  storedFiling = { filingNo: "WF26100001", status: "FILED", totalRecords: 3 };
  assert.deepEqual(await cancelFiling(cancelForm()), { error: "รอบยื่น WF26100001 บันทึกว่ายื่นแบบแล้ว ยกเลิกไม่ได้" });
  assert.equal(txUsed, 0);
  assert.deepEqual(audits, []);
  assert.equal(criticalReports, 0);
});

test("cancelFiling: a filing marked FILED after the first check is refused inside the transaction", { skip: moduleMocksUnavailable }, async () => {
  const { cancelFiling } = await import("../actions");
  txFilingStatus = "FILED";
  assert.deepEqual(await cancelFiling(cancelForm()), { error: "รอบยื่น WF26100001 บันทึกว่ายื่นแบบแล้ว ยกเลิกไม่ได้" });
  assert.deepEqual(txCalls, ["whtFiling.findUnique"], "certificates stay linked");
  assert.deepEqual(audits, []);
  assert.equal(criticalReports, 0, "a refusal is not reported as a system error");
});

test("cancelFiling of a DRAFT filing is unchanged: certificates released, cancelled, audited", { skip: moduleMocksUnavailable }, async () => {
  const { cancelFiling } = await import("../actions");
  assert.deepEqual(await cancelFiling(cancelForm()), { success: true });
  assert.deepEqual(txCalls, ["whtFiling.findUnique", "whtCertificate.updateMany", "whtFiling.update"]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, AuditAction.CANCEL);
  assert.equal(audits[0].entityRef, "WF26100001");
});

test("cancelFiling of a cancelled filing keeps its message", { skip: moduleMocksUnavailable }, async () => {
  const { cancelFiling } = await import("../actions");
  storedFiling = { filingNo: "WF26100001", status: "CANCELLED", totalRecords: 3 };
  assert.deepEqual(await cancelFiling(cancelForm()), { error: "รอบยื่นนี้ถูกยกเลิกไปแล้ว" });
  assert.equal(txUsed, 0);
});

test("createFiling numbers the filing by its tax month (10/2569 -> WF2610...)", { skip: moduleMocksUnavailable }, async (t) => {
  const { createFiling } = await import("../actions");
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-12T03:00:00Z") });
  const result = await createFiling(createForm());
  assert.deepEqual(result, { success: true, filingId: "filing-new", filingNo: "WF26100001" });
  assert.equal(audits[0]?.entityRef, "WF26100001");
});

test("createFiling maps a unique-period violation (P2002) to the existing Thai message", { skip: moduleMocksUnavailable }, async () => {
  const { createFiling } = await import("../actions");
  createError = Object.assign(new Error("Unique constraint failed on the constraint: `WhtFiling_active_period_key`"), {
    code: "P2002",
    meta: { driverAdapterError: { cause: { constraint: { index: "WhtFiling_active_period_key" } } } },
  });
  assert.deepEqual(await createFiling(createForm()), { error: "มีรอบยื่นของแบบ เดือนภาษี และครั้งที่นี้อยู่แล้ว" });
  assert.equal(criticalReports, 0);
  assert.deepEqual(audits, []);
});
