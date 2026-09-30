import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";

// Owner decision Q10a: the AP side of a Supplier Debit Note is dated by
// receivedDate (วันรับใบ), not postingDate. Overdue still follows dueDate.

const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";
const receivedDate = parseDateOnlyToDate("2026-09-20");
const postingDate = parseDateOnlyToDate("2026-09-29");
const dueDate = parseDateOnlyToDate("2026-09-25");
const debitArgs: Array<{ where: Record<string, unknown>; orderBy: unknown }> = [];

let apModule: typeof import("@/lib/ar-ap-stock-report-queries");
let registerModule: typeof import("@/lib/ar-ap-register-queries");

before(async () => {
  if (mocksUnavailable) return;
  const debit = { id: "dn-1", debitNo: "SDN26090001", postingDate, receivedDate, dueDate, status: "ACTIVE",
    supplierId: "sup-1", supplier: { name: "Supplier A" },
    netAmount: new Prisma.Decimal(500), amountRemain: new Prisma.Decimal(500) };
  await mock.module("@/lib/db", { namedExports: { db: {
    purchase: { findMany: async () => [] },
    supplierAdvance: { findMany: async () => [] },
    purchaseReturn: { findMany: async () => [] },
    supplierDebitNote: { findMany: async (args: { where: Record<string, unknown>; orderBy: unknown }) => {
      debitArgs.push(args);
      return [debit];
    } },
  } } });
  apModule = await import("@/lib/ar-ap-stock-report-queries");
  registerModule = await import("@/lib/ar-ap-register-queries");
});

test("AP balance report filters, orders and dates DNs by receivedDate", { skip: mocksUnavailable }, async () => {
  debitArgs.length = 0;
  const filters = apModule.parseARAPStockFilters({ from: "2026-09-01", to: "2026-09-30" });
  const data = await apModule.queryAPData(filters);
  assert.deepEqual(debitArgs[0].where.receivedDate, { gte: filters.from, lte: filters.to });
  assert.equal("postingDate" in debitArgs[0].where, false);
  assert.deepEqual(debitArgs[0].orderBy, { receivedDate: "asc" });
  assert.equal(data.purchases[0].purchaseDate, receivedDate);
});

test("AP register dates DNs by receivedDate but keeps dueDate for overdue", { skip: mocksUnavailable }, async () => {
  debitArgs.length = 0;
  const filters = apModule.parseARAPStockFilters({ from: "2026-09-01", to: "2026-09-30" });
  const rows = await registerModule.queryAPRegisterRows(filters);
  assert.deepEqual(debitArgs[0].where.receivedDate, { gte: filters.from, lte: filters.to });
  assert.equal("postingDate" in debitArgs[0].where, false);
  assert.deepEqual(debitArgs[0].orderBy, [{ supplierId: "asc" }, { receivedDate: "asc" }]);
  assert.equal(rows[0].docDate, receivedDate);
  assert.equal(rows[0].dueDate, dueDate);
  assert.equal(rows[0].status, "OVERDUE");
});
