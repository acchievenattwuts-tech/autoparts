import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { addThailandDays, getThailandDateKey, parseDateOnlyToStartOfDay } from "@/lib/th-date";

// Workboard "Supplier ครบกำหนดจ่าย": open supplier debit notes past their own
// dueDate are overdue AP alongside credit purchases (count, total and rows).

const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";
const todayStart = parseDateOnlyToStartOfDay(getThailandDateKey(new Date()));
const debitWhereCalls: unknown[] = [];

type WorkboardModule = typeof import("../../app/admin/(protected)/workboard/workboard-data");
let workboard: WorkboardModule;

const emptyModel = {
  findMany: async () => [],
  count: async () => 0,
  aggregate: async () => ({ _count: { id: 0 }, _sum: {} }),
};

before(async () => {
  if (mocksUnavailable) return;
  const models: Record<string, unknown> = {
    purchase: {
      // Credit purchase dated 40 days ago on a 30-day term → 10 days overdue.
      findMany: async () => [{ id: "pu-1", purchaseNo: "PU26080001", purchaseDate: addThailandDays(todayStart, -40),
        amountRemain: new Prisma.Decimal(1000), creditTerm: 30, supplier: { name: "Supplier A", creditTerm: 30 } }],
    },
    supplierDebitNote: {
      aggregate: async (args: { where: unknown }) => {
        debitWhereCalls.push(args.where);
        return { _count: { id: 2 }, _sum: { amountRemain: new Prisma.Decimal(700) } };
      },
      findMany: async (args: { where: unknown }) => {
        debitWhereCalls.push(args.where);
        return [
          { id: "dn-1", debitNo: "SDN26090001", dueDate: addThailandDays(todayStart, -20),
            amountRemain: new Prisma.Decimal(500), supplier: { name: "Supplier A" } },
          { id: "dn-2", debitNo: "SDN26090002", dueDate: addThailandDays(todayStart, -3),
            amountRemain: new Prisma.Decimal(200), supplier: { name: "Supplier B" } },
        ];
      },
    },
  };
  const db = new Proxy(models, { get: (target, key: string) => target[key] ?? emptyModel });
  await mock.module("@/lib/db", { namedExports: { db } });
  workboard = await import("../../app/admin/(protected)/workboard/workboard-data");
});

test("overdue DNs are counted, totalled and listed with purchases, most overdue first", { skip: mocksUnavailable }, async () => {
  const { dueAp } = await workboard.getWorkboardData();
  assert.equal(dueAp.count, 3);
  assert.equal(dueAp.totalAmountRemain, 1700);
  assert.deepEqual(
    dueAp.items.map((item) => [item.kind, item.purchaseNo, item.daysOverdue]),
    [["SUPPLIER_DEBIT", "SDN26090001", 20], ["PURCHASE", "PU26080001", 10], ["SUPPLIER_DEBIT", "SDN26090002", 3]],
  );
});

test("DN overdue filter uses the stored dueDate strictly before today on active open DNs", { skip: mocksUnavailable }, async () => {
  debitWhereCalls.length = 0;
  await workboard.getWorkboardData();
  assert.ok(debitWhereCalls.length > 0);
  for (const where of debitWhereCalls) {
    assert.deepEqual(where, { status: "ACTIVE", amountRemain: { gt: 0 }, dueDate: { lt: todayStart } });
  }
});
