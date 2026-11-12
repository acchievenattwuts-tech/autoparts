import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { parseDateOnlyToDate } from "@/lib/th-date";

/**
 * R2 (review 2026-11-12): the CSV and Excel export routes read the sales channel and the cash-bank
 * source type / direction / transfer accounts the screens filter on, so the file holds the rows on
 * screen. Without those filters the routes read the same params as before, so the file is unchanged.
 * The purchase register's pager counts documents with the same where as its rows.
 */
const D = (value: string): Prisma.Decimal => new Prisma.Decimal(value);
const DAY = parseDateOnlyToDate("2026-11-05");
const RANGE = "from=2026-11-01&to=2026-11-10";

type Row = Record<string, unknown>;
type Where = Record<string, unknown>;
type Call = { model: string; op: string; where: Where };

const calls: Call[] = [];
const auditMeta: unknown[] = [];

const saleRow = (saleNo: string, channel: string): Row => ({
  saleNo, saleDate: DAY, channel, channelRefNo: channel === "STORE" ? null : `ORD-${saleNo}`, trackingNo: null,
  shippingStatus: null, saleType: "RETAIL", paymentType: "CASH_SALE", paymentMethod: "CASH", vatType: "NO_VAT",
  vatAmount: D("0"), subtotalAmount: D("100"), status: "ACTIVE", customerName: "ลูกค้า", note: null,
  cashBankAccountId: "acc-cash", cashBankAccount: { name: "เงินสด" }, customer: null, shopeeOrderImport: null,
  items: [{ quantity: D("1"), salePrice: D("100"), subtotalAmount: D("100"), totalAmount: D("100"),
    product: { code: "P1", name: "สินค้า", saleUnitName: "ชิ้น" } }],
});

const account = (id: string, code: string): Row => ({ id, code, name: `บัญชี ${code}` });

const purchaseRow = (id: string, purchaseNo: string, cashBankAccountId: string): Row => ({
  id, purchaseNo, purchaseDate: DAY, purchaseType: "CASH_PURCHASE", paymentMethod: "TRANSFER", cashBankAccountId,
  referenceNo: null, vatType: "NO_VAT", vatAmount: D("0"), subtotalAmount: D("200"), status: "ACTIVE",
  cashBankAccount: { name: "บัญชี" }, supplier: { code: "S1", name: "ร้าน" },
  items: [{ quantity: D("2"), costPrice: D("100"), subtotalAmount: D("200"), totalAmount: D("200"), showQty: null,
    showUnitName: null, showPricePerUnit: null, product: { code: "P1", name: "สินค้า", purchaseUnitName: "ชิ้น" } }],
});

const FIXTURE: Record<string, Row[]> = {
  sale: [saleRow("IV1", "STORE"), saleRow("IV2", "SHOPEE"), saleRow("IV3", "LAZADA"), saleRow("IV4", "SHOPEE")],
  cashBankAccount: [{ ...account("acc-a", "A"), openingBalance: D("0"), openingDate: DAY, isActive: true }],
  cashBankMovement: [
    { id: "m1", txnDate: DAY, direction: "IN", amount: D("10"), balanceAfter: D("10"), sourceType: "SALE", sourceId: "s1",
      referenceNo: "IV1", note: null, accountId: "acc-a", account: account("acc-a", "A") },
    { id: "m2", txnDate: DAY, direction: "OUT", amount: D("4"), balanceAfter: D("6"), sourceType: "EXPENSE", sourceId: "e1",
      referenceNo: "EX1", note: null, accountId: "acc-a", account: account("acc-a", "A") },
  ],
  cashBankTransfer: [
    { id: "t1", transferNo: "TR1", transferDate: DAY, amount: D("50"), note: null, status: "ACTIVE", cancelNote: null,
      fromAccountId: "acc-a", toAccountId: "acc-b", fromAccount: account("acc-a", "A"), toAccount: account("acc-b", "B") },
    { id: "t2", transferNo: "TR2", transferDate: DAY, amount: D("70"), note: null, status: "ACTIVE", cancelNote: null,
      fromAccountId: "acc-b", toAccountId: "acc-a", fromAccount: account("acc-b", "B"), toAccount: account("acc-a", "A") },
  ],
  cashBankAdjustment: [
    { id: "j1", adjustNo: "ADJ1", adjustDate: DAY, direction: "IN", amount: D("5"), reason: "นับเงิน", note: null,
      status: "ACTIVE", cancelNote: null, accountId: "acc-a", account: account("acc-a", "A") },
    { id: "j2", adjustNo: "ADJ2", adjustDate: DAY, direction: "OUT", amount: D("3"), reason: "นับเงิน", note: null,
      status: "ACTIVE", cancelNote: null, accountId: "acc-a", account: account("acc-a", "A") },
  ],
  purchase: [
    purchaseRow("p1", "PO1", "acc-a"),
    // Paid from two accounts; acc-a is the second one, so only a DocumentPayment row links it.
    purchaseRow("p2", "PO2", "acc-b"),
  ],
  documentPayment: [{ docType: "PURCHASE", cashBankAccountId: "acc-a", docId: "p2" }],
};

function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return (condition as Where[]).some((part) => matches(row, part));
    const value = row[key];
    if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
      const range = condition as { gte?: Date; lte?: Date; in?: unknown[] };
      if (range.in && !range.in.includes(value)) return false;
      if (range.gte && (value as Date) < range.gte) return false;
      if (range.lte && (value as Date) > range.lte) return false;
      return true;
    }
    return value === condition;
  });
}

function model(name: string) {
  const read = (op: string) => async (args: { where?: Where; take?: number; skip?: number } = {}): Promise<Row[]> => {
    const where = args.where ?? {};
    calls.push({ model: name, op, where });
    const rows = (FIXTURE[name] ?? []).filter((row) => matches(row, where));
    return rows.slice(args.skip ?? 0, args.take === undefined ? undefined : (args.skip ?? 0) + args.take);
  };
  return {
    findMany: read("findMany"),
    count: async (args: { where?: Where } = {}): Promise<number> => (await read("count")(args)).length,
  };
}

before(async () => {
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        sale: model("sale"),
        purchase: model("purchase"),
        documentPayment: model("documentPayment"),
        cashBankAccount: model("cashBankAccount"),
        cashBankMovement: model("cashBankMovement"),
        cashBankTransfer: model("cashBankTransfer"),
        cashBankAdjustment: model("cashBankAdjustment"),
        $queryRaw: async (): Promise<Row[]> => [],
      },
    },
  });
  await mock.module("@/lib/require-auth", {
    namedExports: { requirePermission: async () => ({ user: { id: "u1" } }) },
  });
  await mock.module("@/lib/audit-log", {
    namedExports: {
      getAuditActorFromSession: () => ({}),
      getRequestContextFromHeaders: () => ({}),
      safeWriteAuditLog: async (input: { meta: unknown }) => {
        auditMeta.push(input.meta);
      },
    },
  });
});

beforeEach(() => {
  calls.length = 0;
  auditMeta.length = 0;
});

async function exportCsv(query: string): Promise<string> {
  const { GET } = await import("../export/route");
  const response = await GET(new Request(`https://shop.test/admin/reports/export?${query}`));
  return Buffer.from(await response.arrayBuffer()).toString("utf8");
}

async function exportExcel(query: string): Promise<number> {
  const { GET } = await import("../export-excel/route");
  const response = await GET(new Request(`https://shop.test/admin/reports/export-excel?${query}`));
  return (await response.arrayBuffer()).byteLength;
}

/** The params object the routes built before R2 (no channel / cash-bank screen filters). */
function previousParams(query: string): Record<string, string | undefined> {
  const searchParams = new URLSearchParams(query);
  const keys = ["from", "to", "showCancelled", "accountId", "paymentType", "saleType", "cnType", "paymentMethod",
    "docType", "customerId", "arMode", "view", "supplierId", "categoryId", "search", "showAll"];
  return Object.fromEntries(keys.map((key) => [key, searchParams.get(key) ?? undefined]));
}

const readWheres = (name: string): Where[] => calls.filter((call) => call.model === name).map((call) => call.where);

test("sales export filtered by channel holds the same rows as the screen", async () => {
  const { parseReportQueryFilters, querySalesRows } = await import("@/lib/report-queries");
  const query = `type=sales&${RANGE}&channel=SHOPEE`;
  const csv = await exportCsv(query);
  const csvWhere = readWheres("sale");
  calls.length = 0;
  await exportExcel(query);
  const excelWhere = readWheres("sale");
  calls.length = 0;

  const screenParams = Object.fromEntries(new URLSearchParams(`${RANGE}&channel=SHOPEE`));
  const screenRows = await querySalesRows(parseReportQueryFilters(screenParams), 100, 0);
  const screenWhere = readWheres("sale");

  assert.deepEqual(csvWhere, screenWhere);
  assert.deepEqual(excelWhere, screenWhere);
  assert.deepEqual(screenRows.map((row) => row.docNo), ["IV2", "IV4"]);
  assert.ok(csv.includes("IV2") && csv.includes("IV4"));
  assert.ok(!csv.includes("IV1") && !csv.includes("IV3"));
  assert.deepEqual((auditMeta[0] as { filters: Record<string, unknown> }).filters.channel, "SHOPEE");
});

test("cash-bank exports apply the source type, direction and transfer-account filters", async () => {
  const cashBank = await import("@/lib/cash-bank-report-queries");
  const cases: Array<{ type: string; filter: string; model: string; screen: () => Promise<unknown[]> }> = [
    { type: "cash-bank-ledger", filter: "sourceType=EXPENSE", model: "cashBankMovement",
      screen: async () => (await cashBank.queryCashBankLedgerData(
        cashBank.parseCashBankReportFilters(Object.fromEntries(new URLSearchParams(`${RANGE}&sourceType=EXPENSE`))))).rows },
    { type: "cash-bank-ledger", filter: "direction=IN", model: "cashBankMovement",
      screen: async () => (await cashBank.queryCashBankLedgerData(
        cashBank.parseCashBankReportFilters(Object.fromEntries(new URLSearchParams(`${RANGE}&direction=IN`))))).rows },
    { type: "cash-bank-adjustments", filter: "direction=OUT", model: "cashBankAdjustment",
      screen: () => cashBank.queryCashBankAdjustmentHistoryRows(
        cashBank.parseCashBankReportFilters(Object.fromEntries(new URLSearchParams(`${RANGE}&direction=OUT`)))) },
    { type: "cash-bank-transfers", filter: "fromAccountId=acc-a", model: "cashBankTransfer",
      screen: () => cashBank.queryCashBankTransferHistoryRows(
        cashBank.parseCashBankReportFilters(Object.fromEntries(new URLSearchParams(`${RANGE}&fromAccountId=acc-a`)))) },
    { type: "cash-bank-transfers", filter: "toAccountId=acc-a", model: "cashBankTransfer",
      screen: () => cashBank.queryCashBankTransferHistoryRows(
        cashBank.parseCashBankReportFilters(Object.fromEntries(new URLSearchParams(`${RANGE}&toAccountId=acc-a`)))) },
  ];

  for (const testCase of cases) {
    calls.length = 0;
    await exportCsv(`type=${testCase.type}&${RANGE}&${testCase.filter}`);
    const csvWhere = readWheres(testCase.model);
    calls.length = 0;
    await exportExcel(`type=${testCase.type}&${RANGE}&${testCase.filter}`);
    const excelWhere = readWheres(testCase.model);
    calls.length = 0;
    const screenRows = await testCase.screen();
    const screenWhere = readWheres(testCase.model);
    assert.deepEqual(csvWhere, screenWhere, `${testCase.type} ${testCase.filter} (csv)`);
    assert.deepEqual(excelWhere, screenWhere, `${testCase.type} ${testCase.filter} (xlsx)`);
    assert.equal(screenRows.length, 1, `${testCase.type} ${testCase.filter} keeps one fixture row`);
  }
});

test("without the screen filters the export file and its params are unchanged", async () => {
  const reportQueries = await import("@/lib/report-queries");
  const cashBank = await import("@/lib/cash-bank-report-queries");
  const BOM = "﻿";

  for (const type of ["sales", "cash-bank-ledger", "cash-bank-transfers", "cash-bank-adjustments"]) {
    const query = `type=${type}&${RANGE}`;
    const csv = await exportCsv(query);
    const routeCalls = calls.splice(0);
    const params = previousParams(query);
    let expected: string;
    if (type === "sales") {
      const filters = reportQueries.parseReportQueryFilters(params);
      expected = reportQueries.buildSalesCsv(await reportQueries.querySalesRows(filters, null));
    } else if (type === "cash-bank-ledger") {
      expected = cashBank.buildCashBankLedgerCsv(
        await cashBank.queryCashBankLedgerData(cashBank.parseCashBankReportFilters(params)));
    } else if (type === "cash-bank-transfers") {
      expected = cashBank.buildCashBankTransferHistoryCsv(
        await cashBank.queryCashBankTransferHistoryRows(cashBank.parseCashBankReportFilters(params)));
    } else {
      expected = cashBank.buildCashBankAdjustmentHistoryCsv(
        await cashBank.queryCashBankAdjustmentHistoryRows(cashBank.parseCashBankReportFilters(params)));
    }
    const previousCalls = calls.splice(0);
    assert.equal(csv, BOM + expected, `${type} csv bytes`);
    assert.deepEqual(routeCalls.map((call) => call.where), previousCalls.map((call) => call.where), `${type} reads`);
    assert.deepEqual(auditMeta.at(-1), { format: "csv", fileName: (auditMeta.at(-1) as { fileName: string }).fileName,
      filters: params }, `${type} audit params`);
  }
});

test("purchase register pager counts the documents its rows show", async () => {
  const { countPurchaseRowsDocs, parseReportQueryFilters, queryPurchaseRows } = await import("@/lib/report-queries");
  const withAccount = parseReportQueryFilters({ from: "2026-11-01", to: "2026-11-10", accountId: "acc-a" });
  const rowsOnScreen = await queryPurchaseRows(withAccount, 100, 0);
  const shownWhere = readWheres("purchase").at(-1);
  calls.length = 0;
  assert.deepEqual(rowsOnScreen.map((row) => row.docNo), ["PO1", "PO2"]);
  // Before R2 the pager counted on cashBankAccountId alone and found 1 of the 2 documents shown.
  assert.equal(await countPurchaseRowsDocs(withAccount), 2);
  assert.deepEqual(readWheres("purchase").at(-1), shownWhere);

  const withoutAccount = parseReportQueryFilters({ from: "2026-11-01", to: "2026-11-10" });
  calls.length = 0;
  assert.equal(await countPurchaseRowsDocs(withoutAccount), 2);
  assert.deepEqual(readWheres("purchase"), [{
    purchaseDate: { gte: withoutAccount.from, lte: withoutAccount.to },
    status: "ACTIVE",
  }]);
});
