import assert from "node:assert/strict";
import test, { before, mock } from "node:test";
import { Prisma, type DocStatus } from "@/lib/generated/prisma";

const mocksUnavailable = typeof (mock as { module?: unknown }).module !== "function" && "requires module mocks";
const postingDate = new Date("2026-09-29T00:00:00+07:00");
const debit = { id: "dn-1", debitNo: "SDN26090001", postingDate, dueDate: postingDate, status: "ACTIVE" as DocStatus,
  supplierId: "sup-1", supplier: { name: "Supplier A" }, purchase: { purchaseNo: "PU26090001" },
  netAmount: new Prisma.Decimal(500), amountRemain: new Prisma.Decimal(375),
  varianceAmount: new Prisma.Decimal(300), vatAmount: new Prisma.Decimal(0), vatRecoverable: true,
  items: [{ id: "dni-1", varianceAmount: new Prisma.Decimal(300), productId: "product-1", product: { code: "A001", name: "Item A" } },
    { id: "dni-2", varianceAmount: new Prisma.Decimal(0), productId: "product-2", product: { code: "A002", name: "Item B" } }] };
let apModule: typeof import("@/lib/ar-ap-stock-report-queries");
let registerModule: typeof import("@/lib/ar-ap-register-queries");
let factModule: typeof import("@/lib/profit-fact");
let reportsModule: typeof import("@/lib/reports");
before(async () => {
  if (mocksUnavailable) return;
  await mock.module("@/lib/db", { namedExports: { db: {
    purchase: { findMany: async () => [] }, supplierAdvance: { findMany: async () => [] },
    purchaseReturn: { findMany: async () => [] }, supplierDebitNote: { findMany: async (args: { select: { varianceAmount?: unknown } }) =>
      args.select.varianceAmount ? [{ ...debit, netAmount: new Prisma.Decimal(535), vatAmount: new Prisma.Decimal(35) }] : [debit] },
    sale: { findMany: async (args: { select: { items?: unknown } }) => args.select.items ? [{ id: "sale-1", saleNo: "IV26090001",
      saleDate: postingDate, netAmount: 1200, vatAmount: 0, amountRemain: 0, customer: null, customerName: "Customer A",
      paymentType: "CASH_SALE", paymentMethod: "CASH", note: null, cashBankAccount: null,
      items: [{ quantity: 6, costPrice: 100, lineDiscount: 0 }] }] : [] },
    expense: { findMany: async () => [{ id: "expense-1", expenseNo: "OE26090001", expenseDate: postingDate,
      netAmount: 100, totalAmount: 100, vatAmount: 0, cashBankAccount: null, note: null, items: [] }] },
    creditNote: { findMany: async () => [] }, customerAdvance: { findMany: async () => [] },
    supplierAdvanceRefund: { findMany: async () => [] }, customerAdvanceRefund: { findMany: async () => [] },
    supplierPayment: { findMany: async () => [] }, warranty: { findMany: async () => [] },
    warrantyClaim: { findMany: async () => [] }, receipt: { findMany: async () => [] }, $queryRaw: async () => [],
  } } });
  apModule = await import("@/lib/ar-ap-stock-report-queries");
  registerModule = await import("@/lib/ar-ap-register-queries");
  factModule = await import("@/lib/profit-fact");
  reportsModule = await import("@/lib/reports");
});

test("golden P&L keeps sale COGS 600, adds variance 300 once, yields gross 300/net 200 and input VAT 35", { skip: mocksUnavailable }, async () => {
  const data = await reportsModule.getReportsData({ from: postingDate, to: postingDate, fromInput: "2026-09-29", toInput: "2026-09-29",
    customerCodeFrom: "", customerCodeTo: "", supplierCodeFrom: "", supplierCodeTo: "", productCodeFrom: "", productCodeTo: "",
    expenseCodeFrom: "", expenseCodeTo: "" });
  assert.equal(data.profitLoss.netRevenue, 1200);
  assert.equal(data.profitLoss.costOfGoodsSold, 900);
  assert.equal(data.profitLoss.purchaseCostVariance, 300);
  assert.equal(data.profitLoss.grossProfit, 300);
  assert.equal(data.profitLoss.netProfit, 200);
  assert.equal(data.profitLoss.purchaseVat, 35);
});

test("golden DN-only supplier AP retains the extra 500 payable and partial balance 375 in CSV", { skip: mocksUnavailable }, async () => {
  const filters = apModule.parseARAPStockFilters({ from: "2026-09-01", to: "2026-09-30" });
  const balances = await apModule.queryAPData(filters);
  assert.equal(balances.purchases.length, 1);
  assert.deepEqual(balances.purchases[0], { kind: "SUPPLIER_DEBIT", id: "dn-1", purchaseNo: "SDN26090001", purchaseDate: postingDate,
    supplierName: "Supplier A", totalAmount: 500, amountRemain: 375 });
  assert.match(apModule.buildAPCsv(balances), /SDN26090001,[^\r\n]*,500,375/);
  const register = await registerModule.queryAPRegisterRows(filters);
  assert.equal(register[0].kind, "SUPPLIER_DEBIT");
  assert.equal(register[0].paidAmount, 125);
  assert.equal(registerModule.summarizeAPRegister(register).totalRemain, 375);
  assert.match(registerModule.buildAPRegisterCsv(register), /SDN26090001,[^\r\n]*,500,125,375/);
});

test("golden rebuild expenses only posted variance 300, keeps zero variance rows, and cancels without active costs", { skip: mocksUnavailable }, async () => {
  const rows: Prisma.FactProfitCreateInput[] = [];
  const deactivated: Prisma.FactProfitUpdateManyArgs[] = [];
  let status: DocStatus = "ACTIVE";
  const fake = {
    supplierDebitNote: { findUnique: async () => ({ ...debit, status }) },
    factProfit: { updateMany: async (args: Prisma.FactProfitUpdateManyArgs) => { deactivated.push(args); return { count: 1 }; },
      aggregate: async () => ({ _max: { versionNo: 1 } }),
      create: async ({ data }: { data: Prisma.FactProfitCreateInput }) => { rows.push(data); return { id: "fact" }; } },
  };
  const tx = fake as unknown as Parameters<typeof factModule.rebuildSupplierDebitProfitFacts>[0];
  await factModule.rebuildSupplierDebitProfitFacts(tx, "dn-1");
  assert.equal(rows.length, 2);
  assert.equal(Number(rows[0].costAmount), 300);
  assert.equal(Number(rows[0].grossProfit), -300);
  assert.equal(Number(rows[0].netProfitAmount), -300);
  assert.equal(Number(rows[1].costAmount), 0);
  assert.equal(Number(rows[0].quantity), 0);
  assert.equal(Number(rows[0].salesAmount), 0);
  assert.equal(rows[0].sourceLineId, "dni-1");
  assert.equal(rows[0].supplierName, "Supplier A");
  assert.equal(rows[0].referenceDocNo, "PU26090001");
  assert.equal(rows[0].businessDate, postingDate);
  assert.equal(rows[0].versionNo, 2);
  status = "CANCELLED";
  await factModule.rebuildSupplierDebitProfitFacts(tx, "dn-1");
  assert.equal(rows.length, 2);
  assert.equal(deactivated.length, 2);
  assert.deepEqual(deactivated[1].where, { sourceType: "PURCHASE_COST_VARIANCE", sourceId: "dn-1", isActive: true });
});
