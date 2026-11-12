import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// Tax ID (review round 3, owner decision): Thai digits are converted, more than 13 digits is
// rejected, and a new or changed tax ID must pass the Thai check digit. Saving a customer whose
// stored tax ID is unchanged must still succeed — production has two (C0001 "ลูกค้าทั่วไป", C0002)
// whose stored 13-digit ID fails the check digit.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type CustomerRow = {
  id: string; code: string | null; name: string; phone: string | null; address: string | null;
  shippingAddress: string | null; taxId: string | null; note: string | null; creditTerm: number | null;
  source: string; lineUserId: string | null; lineLinkedAt: Date | null; isActive: boolean; customerTypeId: string | null;
};

const STORED_INVALID = "0000000000000";
const VALID = "1101700207030";
const WRONG_CHECK_DIGIT = "1101700207031";

let customer: CustomerRow;
let updates: Array<Partial<CustomerRow>> = [];
let creates: Array<Partial<CustomerRow>> = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        customer: {
          findUnique: async () => ({ ...customer }),
          update: async ({ data }: { data: Partial<CustomerRow> }) => {
            updates.push(data);
            return { ...customer, ...data };
          },
          create: async ({ data }: { data: Partial<CustomerRow> }) => {
            creates.push(data);
            return { ...customer, ...data, id: "customer-new" };
          },
        },
      },
    },
  });
  await mock.module("@/lib/transaction-options", { namedExports: { invalidateTransactionCustomerOptions: () => undefined } });
  await mock.module("@/lib/entity-code", { namedExports: { generateCustomerCode: async () => "C0099" } });
  await mock.module("@/lib/require-auth", { namedExports: { requirePermission: async () => ({ user: { id: "admin-1" } }) } });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      diffEntity: (beforeValue: Record<string, unknown>, afterValue: Record<string, unknown>) => ({ before: beforeValue, after: afterValue }),
      getAuditActorFromSession: () => ({ userId: "admin-1" }),
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async () => undefined,
    },
  });
});

beforeEach(() => {
  customer = {
    id: "customer-1", code: "C0001", name: "ลูกค้าทั่วไป", phone: null, address: null, shippingAddress: null,
    taxId: STORED_INVALID, note: null, creditTerm: null, source: "ADMIN", lineUserId: null, lineLinkedAt: null,
    isActive: true, customerTypeId: null,
  };
  updates = [];
  creates = [];
});

const form = (taxId: string): FormData => {
  const formData = new FormData();
  formData.set("name", "ลูกค้าทั่วไป");
  formData.set("taxId", taxId);
  return formData;
};

test("update keeps working when the stored tax ID (wrong check digit) is unchanged", { skip: moduleMocksUnavailable }, async () => {
  const { updateCustomer } = await import("../actions");
  assert.deepEqual(await updateCustomer("customer-1", form(STORED_INVALID)), { success: true });
  assert.equal(updates[0]?.taxId, STORED_INVALID);
});

test("update refuses a changed tax ID that fails the check digit, before writing", { skip: moduleMocksUnavailable }, async () => {
  const { updateCustomer } = await import("../actions");
  assert.deepEqual(await updateCustomer("customer-1", form(WRONG_CHECK_DIGIT)), {
    error: "เลขผู้เสียภาษีไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
  });
  assert.deepEqual(updates, []);
});

test("Thai digits are saved as 0-9; a valid changed tax ID and a cleared one save", { skip: moduleMocksUnavailable }, async () => {
  const { updateCustomer } = await import("../actions");
  assert.deepEqual(await updateCustomer("customer-1", form("๑-๑๐๑๗-๐๐๒๐๗-๐๓-๐")), { success: true });
  assert.equal(updates[0]?.taxId, VALID);
  assert.deepEqual(await updateCustomer("customer-1", form("")), { success: true });
  assert.equal(updates[1]?.taxId, null);
});

test("more than 13 digits is rejected instead of being cut", { skip: moduleMocksUnavailable }, async () => {
  const { updateCustomer, createCustomer } = await import("../actions");
  assert.deepEqual(await updateCustomer("customer-1", form(`${VALID}9`)), { error: "เลขผู้เสียภาษีกรอกได้ไม่เกิน 13 หลัก" });
  assert.deepEqual(await createCustomer(form(`${VALID}9`)), { error: "เลขผู้เสียภาษีกรอกได้ไม่เกิน 13 หลัก" });
  assert.deepEqual([updates, creates], [[], []]);
});

test("create checks the check digit; fewer than 13 digits keeps its message", { skip: moduleMocksUnavailable }, async () => {
  const { createCustomer } = await import("../actions");
  assert.deepEqual(await createCustomer(form(STORED_INVALID)), { error: "เลขผู้เสียภาษีไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง" });
  assert.deepEqual(await createCustomer(form("123")), { error: "เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก" });
  assert.equal(creates.length, 0);
  assert.deepEqual(await createCustomer(form(VALID)), { success: true, id: "customer-new" });
  assert.equal(creates[0]?.taxId, VALID);
});
