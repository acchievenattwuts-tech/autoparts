import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { Prisma } from "@/lib/generated/prisma";
import { getThailandDateKey, parseDateOnlyToDate } from "@/lib/th-date";

// I8: a claim step (send / close / return to customer / reopen / on-site cancel) moves the claim only while it
// still has the status the step was checked against, before any stock or lot row is written. Two requests on the
// same claim at once: the later one waits on the row lock, then stops with a reload message.
// I9: a claimNo taken by another save between "latest + 1" and the insert is regenerated and retried.
//
// The fake database keeps committed rows, gives each dbTx its own uncommitted writes (applied on commit), and makes
// an UPDATE / FOR UPDATE wait while another open transaction holds the row — READ COMMITTED, as in production.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type ClaimState = {
  id: string; claimNo: string; status: string; outcome: string | null; claimType: string;
  claimDate: Date; sentAt: Date | null; resolvedAt: Date | null; returnedAt: Date | null;
  symptom: string | null; supplierName: string | null;
};
type StockRow = { source: string; docNo: string };
type Pending = {
  claimData: Record<string, unknown> | null; claimWrites: Array<Record<string, unknown>>; createdClaims: ClaimState[];
  stockCards: StockRow[]; movements: string[]; lots: string[]; reversals: string[]; deletedDocNos: string[];
};
type Where = Record<string, unknown>;

class RowLocks {
  private held = new Map<string, { owner: number; released: Promise<void>; release: () => void }>();

  async acquire(owner: number, key: string): Promise<void> {
    for (let current = this.held.get(key); current && current.owner !== owner; current = this.held.get(key)) {
      await current.released;
    }
    if (this.held.get(key)?.owner === owner) return;
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => { release = resolve; });
    this.held.set(key, { owner, released, release });
  }

  releaseAll(owner: number): void {
    for (const [key, lock] of [...this.held]) {
      if (lock.owner !== owner) continue;
      this.held.delete(key);
      lock.release();
    }
  }
}

const SEPT = parseDateOnlyToDate("2026-09-20");
const CLAIM_NO = "WCM26090001";
const STALE = `สถานะใบเคลม ${CLAIM_NO} เปลี่ยนไปแล้ว กรุณาโหลดหน้าใหม่`;
const delay = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms); });

let locks = new RowLocks();
let txSeq = 0;
let claim: ClaimState;
let otherClaims: ClaimState[] = [];
let product = { inventoryTracking: "TRACKED", isLotControl: true };
let committed: { stockCards: StockRow[]; movements: string[]; lots: string[]; reversals: string[] };
let claimWrites: Array<Record<string, unknown>> = [];
let criticalReports: unknown[] = [];
let generated: string[] = [];
let takeGeneratedNumber: (claimNo: string, attempt: number) => boolean = () => false;
const pendingByTx = new WeakMap<object, Pending>();

const pendingOf = (tx: unknown): Pending => {
  const pending = pendingByTx.get(tx as object);
  if (!pending) throw new Error("write outside a transaction");
  return pending;
};

const claimView = () => ({
  ...claim,
  warranty: { id: "w1", lotNo: null, productId: "p-1", saleId: null, createdVia: "MANUAL", unitSeq: 1, product: { name: "คอมแอร์", ...product } },
});

const onsiteWarranty = () => ({
  id: "w1", endDate: parseDateOnlyToDate("2027-12-31"), lotNo: null, productId: "p-1", status: "ACTIVE", createdVia: "MANUAL",
  saleId: null, product, saleItem: null, claims: [],
});

const uniqueViolation = (): Error =>
  new Prisma.PrismaClientKnownRequestError("Invalid `prisma.warrantyClaim.create()` invocation: Unique constraint failed on the fields: (`claimNo`)", {
    code: "P2002",
    clientVersion: "test",
    meta: { driverAdapterError: { name: "DriverAdapterError", cause: { kind: "UniqueConstraintViolation", constraint: { fields: ['"claimNo"'] } } } },
  });

const matchesClaim = (current: ClaimState, where: Where): boolean =>
  current.id === where.id &&
  (where.status === undefined || current.status === where.status) &&
  (where.outcome === undefined || current.outcome === where.outcome);

const txOverrides = (owner: number, pending: Pending): Record<string, Record<string, (args: never) => Promise<unknown>>> => ({
  warrantyClaim: {
    update: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      await locks.acquire(owner, `WarrantyClaim:${String(where.id)}`);
      pending.claimData = { ...pending.claimData, ...data };
      pending.claimWrites.push(data);
      return { id: where.id };
    },
    updateMany: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      await locks.acquire(owner, `WarrantyClaim:${String(where.id)}`);
      if (!matchesClaim({ ...claim, ...pending.claimData }, where)) return { count: 0 };
      pending.claimData = { ...pending.claimData, ...data };
      pending.claimWrites.push(data);
      return { count: 1 };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const claimNo = String(data.claimNo);
      if ([claim, ...otherClaims, ...pending.createdClaims].some((row) => row.claimNo === claimNo)) throw uniqueViolation();
      txSeq += 1;
      const row: ClaimState = { ...claim, id: `claim-new-${txSeq}`, claimNo, status: String(data.status), outcome: null };
      pending.createdClaims.push(row);
      return { id: row.id };
    },
  },
  warranty: { findUnique: async () => ({ status: "ACTIVE", claims: [] }) },
  user: { findUnique: async () => ({ name: "Tester", signatureUrl: null }) },
  stockCard: {
    deleteMany: async ({ where }: { where: { docNo?: string } }) => {
      if (where.docNo) pending.deletedDocNos.push(where.docNo);
      return { count: 0 };
    },
  },
});

const makeClient = (owner: number | null, pending: Pending | null): object =>
  new Proxy(
    {},
    {
      get: (_target, modelName: string) => {
        if (modelName === "$executeRaw") return async () => 0;
        if (modelName === "$queryRaw") {
          return async (first: unknown, ...rest: unknown[]) => {
            const query = (Array.isArray(first) ? Prisma.sql(first as unknown as TemplateStringsArray, ...(rest as Prisma.Sql[])) : first) as Prisma.Sql;
            const table = /FROM\s+"(\w+)"/.exec(query.sql)?.[1] ?? "?";
            if (owner !== null && /FOR UPDATE/.test(query.sql)) {
              for (const id of query.values.filter((value): value is string => typeof value === "string")) {
                await locks.acquire(owner, `${table}:${id}`);
              }
            }
            return [];
          };
        }
        return new Proxy(
          {},
          {
            get: (_m, method: string) => async (args: never) => {
              if (owner === null && modelName === "warrantyClaim" && method === "findUnique") return claimView();
              if (owner === null && modelName === "warranty" && method === "findUnique") return onsiteWarranty();
              const override = owner !== null && pending ? txOverrides(owner, pending)[modelName]?.[method] : undefined;
              if (override) return override(args);
              if (method === "findMany") return [];
              if (method.startsWith("find")) return null;
              if (method === "count") return 0;
              return { id: `${modelName}-id`, count: 0 };
            },
          },
        );
      },
    },
  );

const commit = (pending: Pending): void => {
  if (pending.claimData) Object.assign(claim, pending.claimData);
  claimWrites.push(...pending.claimWrites);
  otherClaims.push(...pending.createdClaims);
  committed.stockCards = committed.stockCards.filter((row) => !pending.deletedDocNos.includes(row.docNo));
  committed.stockCards.push(...pending.stockCards);
  committed.movements.push(...pending.movements);
  committed.lots.push(...pending.lots);
  committed.reversals.push(...pending.reversals);
};

const dbTx = async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
  txSeq += 1;
  const owner = txSeq;
  const pending: Pending = { claimData: null, claimWrites: [], createdClaims: [], stockCards: [], movements: [], lots: [], reversals: [], deletedDocNos: [] };
  const tx = makeClient(owner, pending);
  pendingByTx.set(tx, pending);
  try {
    const result = await fn(tx);
    commit(pending);
    return result;
  } finally {
    locks.releaseAll(owner);
  }
};

/** Same "latest + 1 per month" rule as generateClaimNo, over the committed claims. */
const nextClaimNo = (date: Date): string => {
  const [year, month] = getThailandDateKey(date).split("-");
  const pattern = `WCM${year.slice(-2)}${month}`;
  const last = [claim, ...otherClaims].map((row) => row.claimNo).filter((no) => no.startsWith(pattern)).sort().at(-1);
  const seq = last ? Number(last.slice(pattern.length)) + 1 : 1;
  return `${pattern}${String(seq).padStart(4, "0")}`;
};

before(async () => {
  if (moduleMocksUnavailable) return;
  const realDb = await import("@/lib/db");
  await mock.module("@/lib/db", { namedExports: { ...realDb, db: makeClient(null, null), dbTx } });
  const realNotifications = await import("@/lib/notifications");
  await mock.module("@/lib/notifications", { namedExports: { ...realNotifications, safeNotifyPeriodLockOverride: async () => undefined } });
  const realAuth = await import("@/lib/require-auth");
  await mock.module("@/lib/require-auth", { namedExports: {
    ...realAuth,
    requirePermission: async () => ({ user: { id: "user-1", name: "Tester", permissions: ["warranty_claims.create", "warranty_claims.update"] } }),
  } });
  const realAudit = await import("@/lib/audit-log");
  await mock.module("@/lib/audit-log", { namedExports: {
    ...realAudit, getRequestContext: async () => ({}), safeWriteAuditLog: async () => undefined, writeAuditLogTx: async () => undefined,
  } });
  const realErrorReporting = await import("@/lib/error-reporting");
  await mock.module("@/lib/error-reporting", { namedExports: {
    ...realErrorReporting, reportCriticalError: async (error: unknown) => { criticalReports.push(error); },
  } });
  const realClaimStock = await import("@/lib/claim-stock");
  await mock.module("@/lib/claim-stock", { namedExports: {
    ...realClaimStock,
    getOriginalClaimUnitCost: async () => ({ unitCost: 100, lotNo: null }),
    writeClaimStockMovement: async (tx: unknown, input: { movementType: string }) => {
      await delay(5);
      pendingOf(tx).movements.push(input.movementType);
    },
    reverseClaimStockMovements: async (tx: unknown) => { pendingOf(tx).reversals.push("claimStock"); },
  } });
  const realLot = await import("@/lib/lot-control");
  await mock.module("@/lib/lot-control", { namedExports: {
    ...realLot,
    writeClaimLot: async (tx: unknown, _claimId: string, _productId: string, lot: { lotNo: string; direction: string }) => {
      pendingOf(tx).lots.push(`${lot.direction}:${lot.lotNo}`);
    },
    writeStockMovementLots: async () => undefined,
    reverseClaimLotBalance: async (tx: unknown) => { pendingOf(tx).reversals.push("lot"); },
  } });
  const realStockCard = await import("@/lib/stock-card");
  await mock.module("@/lib/stock-card", { namedExports: {
    ...realStockCard,
    writeStockCard: async (tx: unknown, input: { source: string; docNo: string }) => {
      // Hold the transaction open, so the second request runs its pre-check while this one is uncommitted.
      await delay(15);
      pendingOf(tx).stockCards.push({ source: input.source, docNo: input.docNo });
      return `sc-${pendingOf(tx).stockCards.length}`;
    },
    recalculateStockCard: async (tx: unknown) => { pendingOf(tx).reversals.push("recalculate"); },
  } });
  const realDocNumber = await import("@/lib/doc-number");
  await mock.module("@/lib/doc-number", { namedExports: {
    ...realDocNumber,
    generateClaimNo: async (_kind: string, date: Date) => {
      const claimNo = nextClaimNo(date);
      generated.push(claimNo);
      if (takeGeneratedNumber(claimNo, generated.length)) otherClaims.push({ ...claim, id: `other-${generated.length}`, claimNo });
      return claimNo;
    },
  } });
  const realNextCache = await import("next/cache");
  await mock.module("next/cache", { namedExports: { ...realNextCache, revalidatePath: () => undefined } });
});

beforeEach(() => {
  locks = new RowLocks();
  product = { inventoryTracking: "TRACKED", isLotControl: true };
  claim = { id: "c1", claimNo: CLAIM_NO, status: "SENT_TO_SUPPLIER", outcome: null, claimType: "CUSTOMER_WAIT",
    claimDate: SEPT, sentAt: SEPT, resolvedAt: null, returnedAt: null, symptom: null, supplierName: null };
  otherClaims = [];
  committed = { stockCards: [], movements: [], lots: [], reversals: [] };
  claimWrites = [];
  criticalReports = [];
  generated = [];
  takeGeneratedNumber = () => false;
});

/** Runs the same step twice at once and returns the two results, the successful one first. */
const twice = async (step: () => Promise<{ error?: string }>): Promise<Array<{ error?: string }>> => {
  const results = await Promise.all([step(), step()]);
  return [...results].sort((a, b) => Number(Boolean(a.error)) - Number(Boolean(b.error)));
};

test("I8: closeClaim twice at once — one closes, the other is told to reload; one CLAIM_RECV_IN row, one lot in", { skip: moduleMocksUnavailable }, async () => {
  const { closeClaim } = await import("../actions");
  const results = await twice(() => closeClaim("c1", "RECEIVED", "2026-09-30", undefined, "L-NEW"));
  assert.deepEqual(results, [{}, { error: STALE }]);
  assert.deepEqual(committed.stockCards, [{ source: "CLAIM_RECV_IN", docNo: `${CLAIM_NO}-R` }]);
  assert.deepEqual(committed.lots, ["in:L-NEW"]);
  assert.deepEqual(committed.movements, ["SUPPLIER_RECEIVE_IN", "TRANSFER_TO_NORMAL_OUT"]);
  assert.equal(claim.status, "CLOSED");
  assert.deepEqual(criticalReports, [], "a lost race is not reported as a crash");
});

test("I8: returnClaimToCustomer twice at once — stock is cut once, not twice", { skip: moduleMocksUnavailable }, async () => {
  product = { inventoryTracking: "TRACKED", isLotControl: false };
  claim = { ...claim, status: "CLOSED", outcome: "RECEIVED", resolvedAt: SEPT };
  const { returnClaimToCustomer } = await import("../actions");
  const results = await twice(() => returnClaimToCustomer("c1", "2026-09-30"));
  assert.deepEqual(results, [{}, { error: STALE }]);
  assert.deepEqual(committed.stockCards, [{ source: "CLAIM_REPLACE_OUT", docNo: `${CLAIM_NO}-C` }]);
  assert.equal(claim.status, "RETURNED_TO_CUSTOMER");
  assert.deepEqual(criticalReports, []);
});

test("I8: sendClaimToSupplier twice at once — one SEND_TO_SUPPLIER_OUT movement", { skip: moduleMocksUnavailable }, async () => {
  claim = { ...claim, status: "DRAFT", sentAt: null };
  const { sendClaimToSupplier } = await import("../actions");
  const results = await twice(() => sendClaimToSupplier("c1", "2026-09-30"));
  assert.deepEqual(results, [{}, { error: STALE }]);
  assert.deepEqual(committed.movements, ["SEND_TO_SUPPLIER_OUT"]);
  assert.equal(claim.status, "SENT_TO_SUPPLIER");
  assert.deepEqual(criticalReports, []);
});

test("I8: reopenClaim twice at once — the close is reversed once", { skip: moduleMocksUnavailable }, async () => {
  claim = { ...claim, status: "CLOSED", outcome: "RECEIVED", resolvedAt: SEPT };
  const { reopenClaim } = await import("../actions");
  const results = await twice(() => reopenClaim("c1"));
  assert.deepEqual(results, [{}, { error: STALE }]);
  assert.deepEqual(committed.reversals, ["claimStock", "lot", "recalculate"]);
  assert.equal(claim.status, "SENT_TO_SUPPLIER");
  assert.deepEqual(criticalReports, []);
});

test("I8: an on-site claim cancelled twice at once — the stock is reversed once", { skip: moduleMocksUnavailable }, async () => {
  const { cancelClaimAction } = await import("../actions");
  const form = (): FormData => {
    const data = new FormData();
    data.set("claimId", "c1");
    data.set("cancelNote", "ลูกค้ายกเลิก");
    return data;
  };
  const results = await Promise.all([cancelClaimAction(form()), cancelClaimAction(form())]);
  assert.deepEqual([...results].sort((a, b) => Number(Boolean(a.error)) - Number(Boolean(b.error))),
    [{ success: true, deleted: false }, { error: STALE }]);
  assert.deepEqual(committed.reversals, ["claimStock", "lot", "recalculate"]);
  assert.equal(claim.status, "CANCELLED");
  assert.deepEqual(criticalReports, []);
});

test("I8: a single close writes the same claim fields and stock rows, in the same order, as before", { skip: moduleMocksUnavailable }, async () => {
  const { closeClaim } = await import("../actions");
  assert.deepEqual(await closeClaim("c1", "RECEIVED", "2026-09-30", "ได้ของใหม่", "L-NEW"), {});
  assert.deepEqual(claimWrites, [{ status: "CLOSED", outcome: "RECEIVED", resolvedAt: parseDateOnlyToDate("2026-09-30"), returnedAt: null, note: "ได้ของใหม่" }]);
  assert.deepEqual(committed.movements, ["SUPPLIER_RECEIVE_IN", "TRANSFER_TO_NORMAL_OUT"]);
  assert.deepEqual(committed.stockCards, [{ source: "CLAIM_RECV_IN", docNo: `${CLAIM_NO}-R` }]);
  assert.deepEqual(committed.lots, ["in:L-NEW"]);
});

test("I9: the first claimNo is taken by another save — saved with the next number, same format", { skip: moduleMocksUnavailable }, async () => {
  claim = { ...claim, claimNo: "WCM26080009" };
  takeGeneratedNumber = (_claimNo, attempt) => attempt === 1;
  const { createClaim } = await import("../actions");
  const form = new FormData();
  form.set("warrantyId", "w1");
  form.set("claimDate", "2026-09-25");
  form.set("claimType", "CUSTOMER_WAIT");
  const result = await createClaim(form);
  assert.deepEqual(result, { claimNo: "WCM26090002" });
  assert.deepEqual(generated, ["WCM26090001", "WCM26090002"]);
  assert.match(result.claimNo ?? "", /^WCM\d{8}$/);
  assert.deepEqual(committed.movements, ["CUSTOMER_RETURN_IN"]);
});

test("I9: a claimNo collision on every attempt returns a plain Thai message, not the Prisma text", { skip: moduleMocksUnavailable }, async () => {
  claim = { ...claim, claimNo: "WCM26080009" };
  takeGeneratedNumber = () => true;
  const { createClaim } = await import("../actions");
  const form = new FormData();
  form.set("warrantyId", "w1");
  form.set("claimDate", "2026-09-25");
  form.set("claimType", "CUSTOMER_WAIT");
  assert.deepEqual(await createClaim(form), { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" });
  assert.equal(generated.length, 3);
  assert.deepEqual(committed.movements, []);
});
