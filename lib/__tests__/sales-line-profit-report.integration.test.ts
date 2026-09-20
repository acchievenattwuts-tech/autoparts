import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

const saleDate = new Date("2026-09-15T00:00:00+07:00");
const productRows = [
  {
    sourceType: "SALE",
    sourceId: "sale-1",
    sourceLineId: "line-1",
    sourceDocNo: "IV202609150001",
    referenceDocNo: null,
    businessDate: saleDate,
    customerName: "ลูกค้าทดสอบ",
    channel: "STORE",
    productCode: "A001",
    productName: "สินค้า A",
    quantity: 2,
    salesAmountIncVat: 180,
    salesAmountExVat: 168.22,
    costAmount: 100,
    grossProfit: 68.22,
  },
  {
    sourceType: "SALE",
    sourceId: "sale-1",
    sourceLineId: "line-2",
    sourceDocNo: "IV202609150001",
    referenceDocNo: null,
    businessDate: saleDate,
    customerName: "ลูกค้าทดสอบ",
    channel: "STORE",
    productCode: "B001",
    productName: "สินค้า B",
    quantity: 1,
    salesAmountIncVat: 45,
    salesAmountExVat: 42.06,
    costAmount: 30,
    grossProfit: 12.06,
  },
] as const;

const saleItems = [
  {
    id: "line-1",
    quantity: 2,
    showQty: null,
    showUnitName: "ชิ้น",
    unitListPrice: 100,
    lineDiscount: 10,
    totalAmount: 190,
  },
  {
    id: "line-2",
    quantity: 1,
    showQty: null,
    showUnitName: "ชิ้น",
    unitListPrice: 50,
    lineDiscount: 0,
    totalAmount: 50,
  },
] as const;

const returnRow = {
  sourceType: "SALE_RETURN",
  sourceId: "return-1",
  sourceLineId: "return-line-1",
  sourceDocNo: "CN202609160001",
  referenceDocNo: "IV202609150001",
  businessDate: new Date("2026-09-16T00:00:00+07:00"),
  customerName: "ลูกค้าทดสอบ",
  channel: "STORE",
  productCode: "A001",
  productName: "สินค้า A",
  quantity: -1,
  salesAmountIncVat: -90,
  salesAmountExVat: -84.11,
  costAmount: -50,
  grossProfit: -34.11,
} as const;

let fixtureMode: "SALE" | "RETURN" | "CANCELLED" = "SALE";
let capturedBillWhere: unknown = null;
let forcedLineCount: number | null = null;
let aggregateCalls = 0;
let factFindManyCalls = 0;
let billGroupCalls = 0;

type FindManyArgs = {
  where?: { id?: { in?: string[] }; productId?: { in?: string[] } };
  select?: Record<string, boolean>;
};

type SalesLineProfitModule = typeof import("@/lib/sales-line-profit-report");
let reportModule: SalesLineProfitModule;

before(async () => {
  if (moduleMocksUnavailable) return;

  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        product: {
          findMany: async () => [{ id: "product-a" }],
        },
        factProfit: {
          groupBy: async (args: { by: string[]; where?: unknown; _max?: unknown }) => {
            if (!args.by.includes("sourceDocNo")) {
              if (fixtureMode === "CANCELLED" && args._max) {
                return [
                  {
                    sourceType: "SALE",
                    sourceId: "sale-1",
                    _max: { versionNo: 2 },
                  },
                ];
              }
              return [{ sourceType: "SALE", sourceId: "sale-1" }];
            }
            billGroupCalls += 1;
            capturedBillWhere = args.where;
            if (fixtureMode === "RETURN") {
              return [
                {
                  sourceType: "SALE_RETURN",
                  sourceId: "return-1",
                  sourceDocNo: "CN202609160001",
                  referenceDocNo: "IV202609150001",
                  businessDate: returnRow.businessDate,
                  customerName: "ลูกค้าทดสอบ",
                  channel: "STORE",
                  _sum: {
                    quantity: -1,
                    salesAmountIncVat: -90,
                    salesAmountExVat: -84.11,
                    costAmount: -50,
                    grossProfit: -34.11,
                  },
                },
              ];
            }
            return [
              {
                sourceType: "SALE",
                sourceId: "sale-1",
                sourceDocNo: "IV202609150001",
                referenceDocNo: null,
                businessDate: saleDate,
                customerName: "ลูกค้าทดสอบ",
                channel: "STORE",
                _sum: {
                  quantity: 3,
                  salesAmountIncVat: 235,
                  salesAmountExVat: 220.28,
                  costAmount: 130,
                  grossProfit: 90.28,
                },
              },
            ];
          },
          aggregate: async (args: { where?: { productId?: unknown } }) => {
            aggregateCalls += 1;
            return fixtureMode === "RETURN"
              ? args.where?.productId
                ? { _sum: { salesAmountIncVat: -90 } }
                : {
                    _sum: {
                      salesAmountIncVat: -90,
                      salesAmountExVat: -84.11,
                      costAmount: -50,
                      grossProfit: -34.11,
                    },
                  }
              : args.where?.productId
              ? { _sum: { salesAmountIncVat: 225 } }
              : {
                  _sum: {
                    salesAmountIncVat: 235,
                    salesAmountExVat: 220.28,
                    costAmount: 130,
                    grossProfit: 90.28,
                  },
                  };
          },
          count: async (args: { where?: { productId?: { in?: string[] } } }) =>
            forcedLineCount ??
            (fixtureMode === "RETURN" ? 1 : args.where?.productId?.in ? 1 : 2),
          findMany: async (args: FindManyArgs) => {
            factFindManyCalls += 1;
            return fixtureMode === "RETURN"
              ? [returnRow]
              : args.where?.productId?.in
                ? [productRows[0]]
                : productRows;
          },
        },
        sale: {
          findMany: async (args: FindManyArgs) =>
            fixtureMode === "RETURN" ||
            (fixtureMode === "CANCELLED" && !args.select?.discount)
              ? fixtureMode === "CANCELLED"
                ? [{ id: "sale-1" }]
                : []
              : [{ id: "sale-1", discount: 15 }],
        },
        creditNote: {
          findMany: async () =>
            fixtureMode === "RETURN" ? [{ id: "return-1" }] : [],
        },
        saleItem: {
          findMany: async (args: FindManyArgs) => {
            const ids = new Set(args.where?.id?.in ?? []);
            return saleItems.filter((item) => ids.has(item.id));
          },
        },
        creditNoteItem: {
          findMany: async () =>
            fixtureMode === "RETURN"
              ? [
                  {
                    id: "return-line-1",
                    qty: 1,
                    showQty: null,
                    showUnitName: "ชิ้น",
                    unitPrice: 90,
                    showPricePerUnit: 90,
                    amount: 90,
                  },
                ]
              : [],
        },
      },
    },
  });

  reportModule = await import("@/lib/sales-line-profit-report");
});

test(
  "sales line profit keeps whole-bill totals while product detail uses AND scope",
  { skip: moduleMocksUnavailable },
  async () => {
    fixtureMode = "SALE";
    forcedLineCount = null;
    const filters = reportModule.parseSalesLineProfitFilters({
      from: "2026-09-01",
      to: "2026-09-30",
      categoryId: "category-a",
      productIds: "product-a",
      productCodeFrom: "A000",
      productCodeTo: "A999",
    });
    const data = await reportModule.querySalesLineProfitData(filters);

    assert.equal(data.bills.length, 1);
    assert.equal(data.bills[0].netSalesIncVat, 235);
    assert.equal(data.bills[0].grossProfit, 90.28);
    assert.equal(data.lines.length, 1);
    assert.equal(data.lines[0].productCode, "A001");
    assert.equal(data.lines[0].amountBeforeLineDiscount, 200);
    assert.equal(data.lines[0].lineDiscount, 10);
    assert.equal(data.lines[0].allocatedBillDiscount, 10);
    assert.equal(data.lines[0].netSalesExVat, 168.22);
    assert.equal(data.totals.amountBeforeLineDiscount, 250);
    assert.equal(data.totals.lineDiscount, 10);
    assert.equal(data.totals.amountAfterLineDiscount, 240);
    assert.equal(data.totals.allocatedBillDiscount, 15);
    assert.equal(data.totals.shippingAmountIncVat, 10);
    assert.equal(data.totalLineCount, 1);
  },
);

test(
  "cancelled product filtering keeps the latest-version scope when narrowing documents",
  { skip: moduleMocksUnavailable },
  async () => {
    fixtureMode = "CANCELLED";
    forcedLineCount = null;
    capturedBillWhere = null;
    const filters = reportModule.parseSalesLineProfitFilters({
      from: "2026-09-01",
      to: "2026-09-30",
      status: "CANCELLED",
      productIds: "product-a",
    });
    await reportModule.querySalesLineProfitData(filters);

    const where = capturedBillWhere as {
      AND?: Array<{ OR?: unknown }>;
    };
    assert.equal(where.AND?.length, 2);
    assert.ok(where.AND?.[0].OR, "latest version scope must remain in the final query");
    assert.ok(where.AND?.[1].OR, "matching document scope must remain in the final query");
  },
);

test(
  "sales return keeps quantity, revenue, cost, and gross profit negative",
  { skip: moduleMocksUnavailable },
  async () => {
    fixtureMode = "RETURN";
    forcedLineCount = null;
    const filters = reportModule.parseSalesLineProfitFilters({
      from: "2026-09-01",
      to: "2026-09-30",
      includeReturns: "1",
    });
    const data = await reportModule.querySalesLineProfitData(filters);

    assert.equal(data.lines.length, 1);
    assert.equal(data.lines[0].sourceType, "SALE_RETURN");
    assert.equal(data.lines[0].quantity, -1);
    assert.equal(data.lines[0].unitListPrice, null);
    assert.equal(data.lines[0].lineDiscount, null);
    assert.equal(data.lines[0].netSalesIncVat, -90);
    assert.equal(data.lines[0].costAmount, -50);
    assert.equal(data.lines[0].grossProfit, -34.11);
    assert.equal(data.totals.shippingAmountIncVat, 0);
  },
);

test(
  "export preflight stops before detail and aggregate queries when the row cap is exceeded",
  { skip: moduleMocksUnavailable },
  async () => {
    fixtureMode = "SALE";
    forcedLineCount = 10_001;
    aggregateCalls = 0;
    factFindManyCalls = 0;
    billGroupCalls = 0;
    const filters = reportModule.parseSalesLineProfitFilters({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    const data = await reportModule.querySalesLineProfitData(filters, {
      detailLimit: 10_000,
      billLimit: 10_000,
      mode: "EXPORT",
    });

    assert.equal(data.lineRowsTruncated, true);
    assert.equal(data.totalLineCount, 10_001);
    assert.equal(data.lines.length, 0);
    assert.equal(data.bills.length, 0);
    assert.equal(aggregateCalls, 0);
    assert.equal(factFindManyCalls, 0);
    assert.equal(billGroupCalls, 0);
    forcedLineCount = null;
  },
);

test(
  "export mode reads bounded bill and line rows without screen-only aggregates",
  { skip: moduleMocksUnavailable },
  async () => {
    fixtureMode = "SALE";
    forcedLineCount = 2;
    aggregateCalls = 0;
    factFindManyCalls = 0;
    billGroupCalls = 0;
    const filters = reportModule.parseSalesLineProfitFilters({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    const data = await reportModule.querySalesLineProfitData(filters, {
      detailLimit: 10_000,
      billLimit: 10_000,
      mode: "EXPORT",
    });

    assert.equal(data.lineRowsTruncated, false);
    assert.equal(data.lines.length, 2);
    assert.equal(data.bills.length, 1);
    assert.equal(aggregateCalls, 0);
    assert.equal(factFindManyCalls, 1);
    assert.equal(billGroupCalls, 1);
    forcedLineCount = null;
  },
);
