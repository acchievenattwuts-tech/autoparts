import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { AuditAction } from "@/lib/generated/prisma";

// Owner decision: deactivating a customer also releases its LINE link, so the
// LINE account is never left attached to an inactive row (which would block the
// customer from linking again with a unique conflict). Reactivation never
// restores the link. Both are captured in the deactivation audit before/after.

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type CustomerRow = {
  id: string; code: string | null; name: string; phone: string | null; address: string | null;
  shippingAddress: string | null; taxId: string | null; note: string | null; creditTerm: number | null;
  source: string; lineUserId: string | null; lineLinkedAt: Date | null; isActive: boolean;
};

const LINKED_AT = new Date("2026-09-01T03:00:00.000Z");
let customer: CustomerRow;
let updateData: Array<Partial<CustomerRow>> = [];
let audits: Array<{ action: AuditAction; before: Record<string, unknown>; after: Record<string, unknown>; meta?: unknown }> = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("next/cache", { namedExports: { revalidatePath: () => undefined } });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        customer: {
          findUnique: async () => ({ ...customer }),
          update: async ({ data }: { data: Partial<CustomerRow> }) => {
            updateData.push(data);
            Object.assign(customer, data);
            return { ...customer };
          },
        },
      },
    },
  });
  await mock.module("@/lib/transaction-options", {
    namedExports: { invalidateTransactionCustomerOptions: () => undefined },
  });
  await mock.module("@/lib/entity-code", { namedExports: { generateCustomerCode: async () => "C0099" } });
  await mock.module("@/lib/require-auth", {
    namedExports: { requirePermission: async () => ({ user: { id: "admin-1" } }) },
  });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      diffEntity: (beforeValue: Record<string, unknown>, afterValue: Record<string, unknown>) => ({ before: beforeValue, after: afterValue }),
      getAuditActorFromSession: () => ({ userId: "admin-1" }),
      getRequestContext: async () => ({}),
      safeWriteAuditLog: async (entry: { action: AuditAction; before: Record<string, unknown>; after: Record<string, unknown>; meta?: unknown }) => {
        audits.push(entry);
      },
    },
  });
});

beforeEach(() => {
  customer = {
    id: "customer-1", code: "C0001", name: "ลูกค้าทดสอบ", phone: "081-234-5678", address: null,
    shippingAddress: null, taxId: null, note: null, creditTerm: null, source: "LINE_LIFF",
    lineUserId: "line-a", lineLinkedAt: LINKED_AT, isActive: true,
  };
  updateData = [];
  audits = [];
});

test("deactivation clears the LINE link and records it in the audit before/after", { skip: moduleMocksUnavailable }, async () => {
  const { toggleCustomer } = await import("../actions");
  assert.deepEqual(await toggleCustomer("customer-1", false), { success: true });
  assert.deepEqual(updateData, [{ isActive: false, lineUserId: null, lineLinkedAt: null }]);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, AuditAction.CANCEL);
  assert.deepEqual(
    [audits[0].before.lineUserId, audits[0].before.lineLinkedAt, audits[0].before.isActive],
    ["line-a", LINKED_AT, true],
  );
  assert.deepEqual(
    [audits[0].after.lineUserId, audits[0].after.lineLinkedAt, audits[0].after.isActive],
    [null, null, false],
  );
  // Counts as an admin unlink for the LIFF relink notification.
  assert.deepEqual(audits[0].meta, { isActive: false, lineUnlinkedByAdmin: true });
});

test("deactivating a customer without a LINE link records no admin unlink", { skip: moduleMocksUnavailable }, async () => {
  customer.lineUserId = null;
  customer.lineLinkedAt = null;
  const { toggleCustomer } = await import("../actions");
  assert.deepEqual(await toggleCustomer("customer-1", false), { success: true });
  assert.deepEqual(audits[0].meta, { isActive: false });
});

test("reactivation only changes isActive and never touches LINE fields", { skip: moduleMocksUnavailable }, async () => {
  customer.isActive = false;
  const { toggleCustomer } = await import("../actions");
  assert.deepEqual(await toggleCustomer("customer-1", true), { success: true });
  assert.deepEqual(updateData, [{ isActive: true }]);
  assert.equal(audits[0].action, AuditAction.UPDATE);
  assert.deepEqual(audits[0].meta, { isActive: true });
});
