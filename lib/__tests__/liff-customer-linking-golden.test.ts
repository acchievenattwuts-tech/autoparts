import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { AuditAction, Prisma } from "@/lib/generated/prisma";

type Customer = {
  id: string;
  code: string | null;
  name: string;
  phone: string;
  lineUserId: string | null;
  isActive: boolean;
};
type LinkAudit = { action: AuditAction; entityId: string | null; entityRef: string | null; meta: unknown };
type LinkNotification = { kind: string; customerId: string; customerName: string; customerCode?: string | null; phone?: string | null };
type CustomerUpdate = {
  where: { id: string; isActive?: boolean; OR?: { lineUserId: string | null }[] };
  data: { phone: string; lineUserId: string; lineLinkedAt: Date };
};

const BASE_CUSTOMER: Customer = {
  id: "customer-1", code: "C0001", name: "Existing customer",
  phone: "0812345678", lineUserId: null, isActive: true,
};
const BLOCKED_RESULT = {
  status: "BLOCKED",
  message: "เบอร์นี้ผูกกับ LINE อื่นแล้ว กรุณาติดต่อร้านเพื่อให้พนักงานตรวจสอบ",
};
const LINKED_RESULT = { status: "LINKED", customerId: "customer-1", customerName: "Existing customer" };

let customers: Customer[] = [];
let audits: LinkAudit[] = [];
let notifications: LinkNotification[] = [];
let failedKeys: string[] = [];
let updates: CustomerUpdate[] = [];
let previouslyUnlinked = false;
let phoneReads = 0;
let bypassIdentityLookup = false;
let beforeWrite: (() => Promise<void>) | undefined;
let databaseError: Error | undefined;

before(async () => {
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        customer: {
          findFirst: async ({ where }: { where: { lineUserId: string } }) =>
            bypassIdentityLookup ? null : customers.find((row) => row.isActive && row.lineUserId === where.lineUserId) ?? null,
          findMany: async ({ where }: { where: { phone: { in: string[] } } }) => {
            phoneReads++;
            return customers.filter((row) => row.isActive && where.phone.in.includes(row.phone)).slice(0, 2).map((row) => ({ ...row }));
          },
          update: async (args: CustomerUpdate) => {
            updates.push(args);
            await beforeWrite?.();
            if (databaseError) throw databaseError;
            const row = customers.find((customer) =>
              customer.id === args.where.id &&
              (args.where.isActive === undefined || customer.isActive === args.where.isActive) &&
              (!args.where.OR || args.where.OR.some((condition) => customer.lineUserId === condition.lineUserId)),
            );
            if (!row) {
              throw new Prisma.PrismaClientKnownRequestError("Record to update not found", { code: "P2025", clientVersion: "test" });
            }
            Object.assign(row, args.data);
            return { id: row.id, code: row.code, name: row.name };
          },
          create: async ({ data }: { data: Omit<Customer, "id" | "isActive"> }) => {
            const customer = { ...data, id: "customer-new", isActive: true };
            customers.push(customer);
            return { id: customer.id, code: customer.code, name: customer.name };
          },
        },
        auditLog: { findFirst: async () => previouslyUnlinked ? { meta: { lineUnlinkedByAdmin: true } } : null },
        loginThrottle: {
          findMany: async () => [],
          upsert: async ({ where }: { where: { key: string } }) => { failedKeys.push(where.key); },
        },
        $transaction: async (operations: Promise<unknown>[]) => Promise.all(operations),
      },
    },
  });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      getRequestContext: async () => ({ ipAddress: null, userAgent: null }),
      getRequestContextFromHeaders: () => ({ ipAddress: null, userAgent: null }),
      safeWriteAuditLog: async (audit: LinkAudit) => { audits.push(audit); },
    },
  });
  await mock.module("@/lib/notifications", {
    namedExports: { notifyLineCustomerLinked: async (notification: LinkNotification) => { notifications.push(notification); } },
  });
  await mock.module("@/lib/entity-code", { namedExports: { generateCustomerCode: async () => "C0099" } });
});

beforeEach(() => {
  customers = [{ ...BASE_CUSTOMER }];
  audits = [];
  notifications = [];
  failedKeys = [];
  updates = [];
  previouslyUnlinked = false;
  phoneReads = 0;
  bypassIdentityLookup = false;
  beforeWrite = undefined;
  databaseError = undefined;
});

async function resolve(lineUserId = "line-a", phone = "+66 81 234 5678", displayName: string | null = "LINE name") {
  const { resolveLiffCustomerFromPhone } = await import("@/lib/liff-customer");
  return resolveLiffCustomerFromPhone({ lineUserId, phone, displayName, throttleKeys: [`liff-phone-lookup:line:${lineUserId}`] });
}

test("golden: existing link recreates the session without phone, writes, audit, notification or lookup failures", async () => {
  customers[0].lineUserId = "line-a";
  assert.deepEqual(await resolve("line-a", ""), LINKED_RESULT);
  assert.equal(phoneReads, 0);
  assert.deepEqual([updates, audits, notifications, failedKeys], [[], [], [], []]);
});

test("golden: first link keeps its result, normalized phone, audit metadata and notification", async () => {
  assert.deepEqual(await resolve(), LINKED_RESULT);
  assert.equal(customers[0].phone, "081-234-5678");
  assert.equal(customers[0].lineUserId, "line-a");
  assert.ok(updates[0].data.lineLinkedAt instanceof Date);
  assert.deepEqual(audits.map(({ action, entityId, meta }) => ({ action, entityId, meta })), [{
    action: AuditAction.LINE_LINK, entityId: "customer-1", meta: { lineUserId: "line-a", phone: "081-234-5678" },
  }]);
  assert.deepEqual(notifications, [{
    kind: "LINE_OLD_CUSTOMER_LINKED", customerId: "customer-1", customerName: "Existing customer", customerCode: "C0001", phone: "081-234-5678",
  }]);
  assert.deepEqual(failedKeys, []);
});

test("golden: a legacy empty LINE ID and a same-identity snapshot retain the allowed link behavior", async () => {
  for (const lineUserId of ["", "line-a"]) {
    customers[0].lineUserId = lineUserId;
    bypassIdentityLookup = true;
    assert.deepEqual(await resolve(), LINKED_RESULT);
  }
  assert.deepEqual(failedKeys, []);
});

test("golden: admin-unlinked history still emits the relink notification", async () => {
  previouslyUnlinked = true;
  assert.deepEqual(await resolve(), LINKED_RESULT);
  assert.equal(notifications[0].kind, "LINE_OLD_CUSTOMER_RELINKED");
  assert.equal(audits[0].action, AuditAction.LINE_LINK);
});

test("golden: a customer without a code retains the name as the audit reference", async () => {
  customers[0].code = null;
  assert.deepEqual(await resolve(), LINKED_RESULT);
  assert.equal(audits[0].entityRef, "Existing customer");
  assert.equal(notifications[0].customerCode, null);
});

test("golden: new registration retains normalized data, fallback name and side effects", async () => {
  customers = [];
  assert.deepEqual(await resolve("line-a", "+66 81 234 5678", "  "), {
    status: "REGISTERED", customerId: "customer-new", customerName: "ลูกค้า LINE",
  });
  assert.equal(customers[0].phone, "081-234-5678");
  assert.equal(customers[0].lineUserId, "line-a");
  assert.equal(audits[0].action, AuditAction.LINE_REGISTER);
  assert.deepEqual(audits[0].meta, { lineUserId: "line-a", phone: "081-234-5678", source: "LINE_LIFF" });
  assert.equal(notifications[0].kind, "LINE_NEW_CUSTOMER");
  assert.deepEqual(failedKeys, []);
});

test("golden: a new customer's display name is still trimmed", async () => {
  customers = [];
  assert.deepEqual(await resolve("line-a", "0812345678", "  LINE name  "), {
    status: "REGISTERED", customerId: "customer-new", customerName: "LINE name",
  });
  assert.equal(notifications[0].customerName, "LINE name");
});

test("golden: missing phone keeps the existing validation error without side effects", async () => {
  await assert.rejects(resolve("line-a", ""), /กรุณาระบุเบอร์โทรศัพท์/);
  assert.deepEqual([updates, audits, notifications, failedKeys], [[], [], [], []]);
});

test("golden: another owner's link remains blocked with one failed attempt and blocked audit", async () => {
  customers[0].lineUserId = "other-owner";
  assert.deepEqual(await resolve(), BLOCKED_RESULT);
  assert.equal(customers[0].lineUserId, "other-owner");
  assert.equal(audits[0].action, AuditAction.LINE_LINK_BLOCKED);
  assert.deepEqual(failedKeys, ["liff-phone-lookup:line:line-a"]);
  assert.deepEqual([updates, notifications], [[], []]);
});

test("golden: ambiguous phone stays ambiguous without a write or notification", async () => {
  customers.push({ ...BASE_CUSTOMER, id: "customer-2", code: "C0002" });
  assert.deepEqual(await resolve(), {
    status: "AMBIGUOUS", message: "พบบัญชีหลายรายการจากเบอร์นี้ กรุณาติดต่อร้านเพื่อยืนยันข้อมูล",
  });
  assert.equal(audits[0].action, AuditAction.LINE_LINK_AMBIGUOUS);
  assert.deepEqual(failedKeys, ["liff-phone-lookup:line:line-a"]);
  assert.deepEqual([updates, notifications], [[], []]);
});

test("two LINE identities that read the same unlinked snapshot cannot overwrite the winning owner", async () => {
  let releaseWrites: () => void = () => { throw new Error("barrier not initialized"); };
  const allReady = new Promise<void>((resolveBarrier) => { releaseWrites = resolveBarrier; });
  let ready = 0;
  beforeWrite = async () => {
    ready++;
    if (ready === 2) releaseWrites();
    await allReady;
  };
  const results = await Promise.all([resolve("line-a"), resolve("line-b")]);
  assert.equal(phoneReads, 2);
  assert.equal(ready, 2);
  assert.deepEqual(results, [LINKED_RESULT, BLOCKED_RESULT]);
  assert.equal(customers[0].lineUserId, "line-a");
  assert.equal(audits.filter((audit) => audit.action === AuditAction.LINE_LINK).length, 1);
  assert.equal(audits.filter((audit) => audit.action === AuditAction.LINE_LINK_BLOCKED).length, 1);
  assert.deepEqual(failedKeys, ["liff-phone-lookup:line:line-b"]);
  assert.equal(notifications.length, 1);
  assert.deepEqual(audits.find((audit) => audit.action === AuditAction.LINE_LINK)?.meta, { lineUserId: "line-a", phone: "081-234-5678" });
});

test("deactivation between lookup and write prevents linkage and success side effects", async () => {
  beforeWrite = async () => { customers[0].isActive = false; };
  assert.deepEqual(await resolve(), BLOCKED_RESULT);
  assert.equal(customers[0].lineUserId, null);
  assert.equal(customers[0].phone, "0812345678");
  assert.deepEqual(notifications, []);
  assert.equal(audits[0].action, AuditAction.LINE_LINK_BLOCKED);
  assert.deepEqual(failedKeys, ["liff-phone-lookup:line:line-a"]);
});

test("unexpected database failures are not misclassified as a link conflict", async () => {
  databaseError = new Error("database unavailable");
  await assert.rejects(resolve(), /database unavailable/);
  assert.deepEqual([audits, notifications, failedKeys], [[], [], []]);
});
