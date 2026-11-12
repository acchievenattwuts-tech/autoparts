import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// Tax ID (review round 3, owner decision), supplier master: same rules as customers. Thai digits
// are converted, more than 13 digits is rejected, a new or changed tax ID must pass the Thai check
// digit, and an unchanged stored tax ID saves as before.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type SupplierRow = {
  id: string; code: string | null; name: string; contactName: string | null; phone: string | null;
  address: string | null; taxId: string | null; creditTerm: number | null; isActive: boolean;
};

const STORED_INVALID = "1234567890123";
const VALID = "1101700207030";
const WRONG_CHECK_DIGIT = "1101700207031";
const SUPPLIER_ID = "supplier1";

let supplier: SupplierRow;
let updates: Array<Partial<SupplierRow>> = [];
let creates: Array<Partial<SupplierRow>> = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        supplier: {
          findUnique: async () => ({ ...supplier }),
          update: async ({ data }: { data: Partial<SupplierRow> }) => {
            updates.push(data);
            return { ...supplier, ...data };
          },
          create: async ({ data }: { data: Partial<SupplierRow> }) => {
            creates.push(data);
            return { ...supplier, ...data, id: "supplier2" };
          },
        },
      },
    },
  });
  await mock.module("@/lib/transaction-options", { namedExports: { invalidateTransactionSupplierOptions: () => undefined } });
  await mock.module("@/lib/entity-code", { namedExports: { generateSupplierCode: async () => "S0099" } });
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
  supplier = {
    id: SUPPLIER_ID, code: "S0001", name: "ร้านอะไหล่", contactName: null, phone: null, address: null,
    taxId: STORED_INVALID, creditTerm: null, isActive: true,
  };
  updates = [];
  creates = [];
});

const form = (taxId: string): FormData => {
  const formData = new FormData();
  formData.set("name", "ร้านอะไหล่");
  formData.set("taxId", taxId);
  return formData;
};

test("update with the stored tax ID unchanged saves, even though its check digit is wrong", { skip: moduleMocksUnavailable }, async () => {
  const { updateSupplier } = await import("../actions");
  assert.deepEqual(await updateSupplier(SUPPLIER_ID, form(STORED_INVALID)), {});
  assert.equal(updates[0]?.taxId, STORED_INVALID);
});

test("update refuses a changed tax ID with a wrong check digit, before writing", { skip: moduleMocksUnavailable }, async () => {
  const { updateSupplier } = await import("../actions");
  assert.deepEqual(await updateSupplier(SUPPLIER_ID, form(WRONG_CHECK_DIGIT)), { error: "เลขผู้เสียภาษีไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง" });
  assert.deepEqual(updates, []);
});

test("create: Thai digits converted, check digit enforced, more than 13 digits rejected", { skip: moduleMocksUnavailable }, async () => {
  const { createSupplier } = await import("../actions");
  assert.deepEqual(await createSupplier(form(WRONG_CHECK_DIGIT)), { error: "เลขผู้เสียภาษีไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง" });
  assert.deepEqual(await createSupplier(form(`${VALID}0`)), { error: "เลขผู้เสียภาษีกรอกได้ไม่เกิน 13 หลัก" });
  assert.equal(creates.length, 0);
  assert.deepEqual(await createSupplier(form("๑๑๐๑๗๐๐๒๐๗๐๓๐")), {});
  assert.equal(creates[0]?.taxId, VALID);
});
