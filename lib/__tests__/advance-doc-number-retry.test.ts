import assert from "node:assert/strict";
import { before, beforeEach, describe, it, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { getThailandDateKey } from "@/lib/th-date";

/**
 * I9: customer deposit (SD), supplier deposit (ADV) and both deposit refunds (CNSD / CNADV) generate their number as
 * "latest + 1" before the transaction. A number taken by another save in between is now regenerated and the save
 * retried; a collision that survives every retry is shown as the action's plain Thai message, not the Prisma text.
 * Without a collision the number is exactly what it was before.
 */

type Model = "customerAdvance" | "supplierAdvance" | "customerAdvanceRefund" | "supplierAdvanceRefund";
const NUMBER_FIELD: Record<Model, "advanceNo" | "refundNo"> = {
  customerAdvance: "advanceNo", supplierAdvance: "advanceNo", customerAdvanceRefund: "refundNo", supplierAdvanceRefund: "refundNo",
};
const PREFIX: Record<Model, string> = { customerAdvance: "SD", supplierAdvance: "ADV", customerAdvanceRefund: "CNSD", supplierAdvanceRefund: "CNADV" };

let saved: Record<Model, string[]>;
let generated: string[];
let takeGeneratedNumber: (attempt: number) => boolean;

const uniqueViolation = (field: string): Error =>
  new Prisma.PrismaClientKnownRequestError(`Invalid \`prisma.create()\` invocation: Unique constraint failed on the fields: (\`${field}\`)`, {
    code: "P2002",
    clientVersion: "test",
    meta: { driverAdapterError: { name: "DriverAdapterError", cause: { kind: "UniqueConstraintViolation", constraint: { fields: [`"${field}"`] } } } },
  });

/** Same "latest + 1 per month" rule as lib/doc-number.ts, over the committed rows. */
const generator = (model: Model) => async (date: Date): Promise<string> => {
  const [year, month] = getThailandDateKey(date).split("-");
  const pattern = `${PREFIX[model]}${year.slice(-2)}${month}`;
  const last = saved[model].filter((no) => no.startsWith(pattern)).sort().at(-1);
  const next = `${pattern}${String(last ? Number(last.slice(pattern.length)) + 1 : 1).padStart(4, "0")}`;
  generated.push(next);
  // Another user commits the same number before this save inserts it.
  if (takeGeneratedNumber(generated.length)) saved[model].push(next);
  return next;
};

const makeTx = (pending: Array<[Model, string]>) => {
  const creator = (model: Model) => ({
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const docNo = String(data[NUMBER_FIELD[model]]);
      if (saved[model].includes(docNo)) throw uniqueViolation(NUMBER_FIELD[model]);
      pending.push([model, docNo]);
      return { id: `${model}-${docNo}` };
    },
  });
  return {
    $queryRaw: async () => [],
    cashBankAccount: { findMany: async () => [{ type: "BANK" }] },
    user: { findUnique: async () => ({ name: "Tester", signatureUrl: null }) },
    documentPayment: { deleteMany: async () => ({ count: 0 }), createMany: async () => ({ count: 1 }) },
    customerAdvance: { ...creator("customerAdvance"), findUnique: async () => ({ status: "ACTIVE", amountRemain: new Prisma.Decimal(1000) }) },
    supplierAdvance: { ...creator("supplierAdvance"), findUnique: async () => ({ status: "ACTIVE", amountRemain: new Prisma.Decimal(1000) }) },
    customerAdvanceRefund: creator("customerAdvanceRefund"),
    supplierAdvanceRefund: creator("supplierAdvanceRefund"),
  };
};

const dbTx = async (callback: (client: ReturnType<typeof makeTx>) => Promise<unknown>): Promise<unknown> => {
  const pending: Array<[Model, string]> = [];
  const result = await callback(makeTx(pending));
  for (const [model, docNo] of pending) saved[model].push(docNo);
  return result;
};

let customerAdvances: typeof import("@/app/admin/(protected)/customer-advances/actions");
let supplierAdvances: typeof import("@/app/admin/(protected)/supplier-advances/actions");
let refunds: typeof import("@/lib/advance-refund-actions");

before(async () => {
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
  await mock.module("@/lib/require-auth", { namedExports: {
    requirePermission: async () => ({ user: { id: "user-1", permissions: [] } }),
    requireAnyPermission: async () => ({ user: { id: "user-1", permissions: [] } }),
  } });
  await mock.module("@/lib/audit-log", { namedExports: { diffEntity: () => ({ before: {}, after: {} }),
    getAuditActorFromSession: () => ({ userId: "user-1" }), getRequestContext: async () => ({}), safeWriteAuditLog: async () => undefined } });
  const auditRead = { findUnique: async () => null };
  await mock.module("@/lib/db", { namedExports: {
    db: { customerAdvance: auditRead, supplierAdvance: auditRead, customerAdvanceRefund: auditRead, supplierAdvanceRefund: auditRead,
      documentPayment: { findMany: async () => [] } },
    dbTx,
  } });
  await mock.module("@/lib/doc-number", { namedExports: {
    generateCustomerAdvanceNo: generator("customerAdvance"),
    generateSupplierAdvanceNo: generator("supplierAdvance"),
    generateCustomerAdvanceRefundNo: generator("customerAdvanceRefund"),
    generateSupplierAdvanceRefundNo: generator("supplierAdvanceRefund"),
  } });
  await mock.module("@/lib/cash-bank", { namedExports: {
    replaceCashBankSourceMovements: async () => undefined, clearCashBankSourceMovements: async () => undefined,
  } });
  await mock.module("@/lib/amount-remain", { namedExports: {
    recalculateCustomerAdvanceAmountRemain: async () => undefined, recalculateSupplierAdvanceAmountRemain: async () => undefined,
  } });
  customerAdvances = await import("@/app/admin/(protected)/customer-advances/actions");
  supplierAdvances = await import("@/app/admin/(protected)/supplier-advances/actions");
  refunds = await import("@/lib/advance-refund-actions");
});

beforeEach(() => {
  saved = { customerAdvance: ["SD26090001"], supplierAdvance: ["ADV26090001"], customerAdvanceRefund: [], supplierAdvanceRefund: [] };
  generated = [];
  takeGeneratedNumber = () => false;
});

const payments = JSON.stringify([{ cashBankAccountId: "acc-bank", amount: 500 }]);
const advanceForm = (party: "customerId" | "supplierId"): FormData => {
  const data = new FormData();
  data.set(party, `${party}-1`); data.set("advanceDate", "2026-09-30"); data.set("totalAmount", "500"); data.set("payments", payments);
  return data;
};
const refundForm = (): FormData => {
  const data = new FormData();
  data.set("sourceAdvanceId", "adv-1"); data.set("refundDate", "2026-09-30"); data.set("refundAmount", "500"); data.set("payments", payments);
  return data;
};

describe("I9 — deposit and deposit-refund numbers", () => {
  it("without a collision the number is the same latest + 1 as before", async () => {
    assert.deepEqual(await customerAdvances.createCustomerAdvance(advanceForm("customerId")),
      { success: true, advanceNo: "SD26090002", advanceId: "customerAdvance-SD26090002" });
    assert.deepEqual(await supplierAdvances.createSupplierAdvance(advanceForm("supplierId")), { success: true, advanceNo: "ADV26090002" });
    assert.deepEqual(await refunds.createCustomerAdvanceRefund(refundForm()),
      { success: true, refundId: "customerAdvanceRefund-CNSD26090001", refundNo: "CNSD26090001" });
    assert.deepEqual(await refunds.createSupplierAdvanceRefund(refundForm()),
      { success: true, refundId: "supplierAdvanceRefund-CNADV26090001", refundNo: "CNADV26090001" });
    assert.deepEqual(generated, ["SD26090002", "ADV26090002", "CNSD26090001", "CNADV26090001"]);
  });

  it("customer deposit: the first number is taken by another save — saved with the next number", async () => {
    takeGeneratedNumber = (attempt) => attempt === 1;
    const result = await customerAdvances.createCustomerAdvance(advanceForm("customerId"));
    assert.deepEqual(result, { success: true, advanceNo: "SD26090003", advanceId: "customerAdvance-SD26090003" });
    assert.deepEqual(generated, ["SD26090002", "SD26090003"]);
    assert.match(result.advanceNo ?? "", /^SD\d{4}\d{4}$/);
  });

  it("supplier deposit: the first number is taken by another save — saved with the next number", async () => {
    takeGeneratedNumber = (attempt) => attempt === 1;
    assert.deepEqual(await supplierAdvances.createSupplierAdvance(advanceForm("supplierId")), { success: true, advanceNo: "ADV26090003" });
    assert.deepEqual(generated, ["ADV26090002", "ADV26090003"]);
  });

  it("customer and supplier deposit refunds: the first number is taken — saved with the next number", async () => {
    takeGeneratedNumber = (attempt) => attempt === 1;
    assert.deepEqual(await refunds.createCustomerAdvanceRefund(refundForm()),
      { success: true, refundId: "customerAdvanceRefund-CNSD26090002", refundNo: "CNSD26090002" });
    generated = [];
    assert.deepEqual(await refunds.createSupplierAdvanceRefund(refundForm()),
      { success: true, refundId: "supplierAdvanceRefund-CNADV26090002", refundNo: "CNADV26090002" });
    assert.deepEqual(generated, ["CNADV26090001", "CNADV26090002"]);
  });

  it("a collision on every attempt shows each action's plain Thai message, never the Prisma text", async () => {
    takeGeneratedNumber = () => true;
    assert.deepEqual(await customerAdvances.createCustomerAdvance(advanceForm("customerId")),
      { success: false, error: "ไม่สามารถบันทึกรับเงินมัดจำลูกค้าได้" });
    assert.deepEqual(await supplierAdvances.createSupplierAdvance(advanceForm("supplierId")),
      { success: false, error: "เกิดข้อผิดพลาด ไม่สามารถบันทึกเงินมัดจำซัพพลายเออร์ได้" });
    assert.deepEqual(await refunds.createCustomerAdvanceRefund(refundForm()),
      { success: false, error: "ไม่สามารถบันทึกคืนเงินมัดจำลูกค้าได้" });
    assert.deepEqual(await refunds.createSupplierAdvanceRefund(refundForm()),
      { success: false, error: "ไม่สามารถบันทึกรับคืนเงินมัดจำซัพพลายเออร์ได้" });
    assert.equal(generated.length, 12, "three attempts each");
  });

  it("a business-rule refusal inside the transaction still reaches the user as before", async () => {
    const data = refundForm();
    data.set("refundAmount", "1500");
    data.set("payments", JSON.stringify([{ cashBankAccountId: "acc-bank", amount: 1500 }]));
    const result = await refunds.createCustomerAdvanceRefund(data);
    assert.equal(result.success, false);
    assert.match(result.error ?? "", /^ยอดคืนต้องไม่เกินยอดคงเหลือ 1,000\.00 บาท$/);
    assert.deepEqual(generated, ["CNSD26090001"], "a refusal is not retried");
  });
});
