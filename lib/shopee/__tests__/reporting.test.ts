import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

import { SaleChannel } from "@/lib/generated/prisma";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type DateRange = { gte: Date; lte: Date };
type SaleGroupByArgs = { where: { status: string; saleDate: DateRange } };
type ProfitGroupByArgs = {
  by: string[];
  where: { isActive: boolean; businessDate: DateRange; OR: unknown[] };
};

let saleGroupByArgs: SaleGroupByArgs | null = null;
let profitGroupByArgs: ProfitGroupByArgs | null = null;
let getShopeeReportingSummary:
  | typeof import("@/lib/shopee/services/reporting")["getShopeeReportingSummary"]
  | undefined;
let computeChannelNetFigures:
  | typeof import("@/lib/shopee/services/reporting")["computeChannelNetFigures"]
  | undefined;

const profitSum = (sum: {
  grossProfit?: number;
  salesAmountIncVat?: number;
  expenseAmount?: number;
  netProfitAmount?: number;
}) => ({ grossProfit: 0, salesAmountIncVat: 0, expenseAmount: 0, netProfitAmount: 0, ...sum });

before(async () => {
  if (moduleMocksUnavailable) return;

  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        sale: {
          groupBy: async (args: SaleGroupByArgs) => {
            saleGroupByArgs = args;
            return [
              {
                channel: SaleChannel.STORE,
                _sum: { netAmount: 8_000 },
                _count: { _all: 6 },
              },
              {
                channel: SaleChannel.SHOPEE,
                _sum: { netAmount: 2_400 },
                _count: { _all: 2 },
              },
              {
                channel: SaleChannel.LAZADA,
                _sum: { netAmount: 1_265 },
                _count: { _all: 1 },
              },
            ];
          },
        },
        factProfit: {
          groupBy: async (args: ProfitGroupByArgs) => {
            profitGroupByArgs = args;
            return [
              { channel: SaleChannel.STORE, sourceType: "SALE", _sum: profitSum({ grossProfit: 2_491.75 }) },
              { channel: SaleChannel.SHOPEE, sourceType: "SALE", _sum: profitSum({ grossProfit: 600 }) },
              {
                channel: SaleChannel.SHOPEE,
                sourceType: "SALE_RETURN",
                _sum: profitSum({ grossProfit: -300, salesAmountIncVat: -1_200 }),
              },
              {
                channel: SaleChannel.SHOPEE,
                sourceType: "OTHER_INCOME",
                _sum: profitSum({ netProfitAmount: 15 }),
              },
              { channel: SaleChannel.LAZADA, sourceType: "SALE", _sum: profitSum({ grossProfit: 629.96 }) },
              {
                channel: SaleChannel.LAZADA,
                sourceType: "EXPENSE",
                _sum: profitSum({ expenseAmount: 210.5, netProfitAmount: -210.5 }),
              },
              // facts not yet tagged with a channel are skipped
              { channel: null, sourceType: "EXPENSE", _sum: profitSum({ expenseAmount: 99 }) },
            ];
          },
        },
      },
    },
  });

  ({ getShopeeReportingSummary, computeChannelNetFigures } = await import(
    "@/lib/shopee/services/reporting"
  ));
});

test(
  "reports store, Shopee, and Lazada sales with channel profit",
  { skip: moduleMocksUnavailable },
  async () => {
    assert.ok(getShopeeReportingSummary);
    const from = new Date("2026-09-11T17:00:00.000Z");
    const to = new Date("2026-09-12T16:59:59.999Z");

    const summary = await getShopeeReportingSummary({ from, to });

    assert.deepEqual(summary.store, {
      channel: SaleChannel.STORE,
      salesAmount: 8_000,
      grossProfit: 2_491.75,
      orderCount: 6,
      returnAmount: 0,
      returnGrossProfit: 0,
      marketplaceFeeAmount: 0,
      marketplaceIncomeAmount: 0,
    });
    assert.deepEqual(summary.shopee, {
      channel: SaleChannel.SHOPEE,
      salesAmount: 2_400,
      grossProfit: 600,
      orderCount: 2,
      returnAmount: 1_200,
      returnGrossProfit: 300,
      marketplaceFeeAmount: 0,
      marketplaceIncomeAmount: 15,
    });
    assert.deepEqual(summary.lazada, {
      channel: SaleChannel.LAZADA,
      salesAmount: 1_265,
      grossProfit: 629.96,
      orderCount: 1,
      returnAmount: 0,
      returnGrossProfit: 0,
      marketplaceFeeAmount: 210.5,
      marketplaceIncomeAmount: 0,
    });
    assert.deepEqual(saleGroupByArgs?.where, {
      status: "ACTIVE",
      saleDate: { gte: from, lte: to },
    });
    assert.deepEqual(profitGroupByArgs?.by, ["channel", "sourceType"]);
    assert.deepEqual(profitGroupByArgs?.where, {
      isActive: true,
      businessDate: { gte: from, lte: to },
      OR: [
        { sourceType: { in: ["SALE", "SALE_RETURN"] } },
        { sourceType: "EXPENSE", sourceSubtype: "MARKETPLACE_FEE" },
        { sourceType: "OTHER_INCOME", sourceSubtype: "MARKETPLACE_INCOME" },
      ],
    });
  },
);

test(
  "dashboard figures deduct credit notes, then the net settled marketplace fee",
  { skip: moduleMocksUnavailable },
  () => {
    assert.ok(computeChannelNetFigures);
    // Lazada 2026-10 production numbers: three settled sales, no credit note.
    assert.deepEqual(
      computeChannelNetFigures({
        channel: SaleChannel.LAZADA,
        salesAmount: 10_709.73,
        grossProfit: 3_682.35,
        orderCount: 3,
        returnAmount: 0,
        returnGrossProfit: 0,
        marketplaceFeeAmount: 2_991.93,
        marketplaceIncomeAmount: 0,
      }),
      { hasReturn: false, profitAfterReturn: 3_682.35, netMarketplaceFee: 2_991.93, profitAfterFee: 690.42 },
    );
    // Shopee 2026-10: the only sale was fully returned, nothing settled yet.
    assert.deepEqual(
      computeChannelNetFigures({
        channel: SaleChannel.SHOPEE,
        salesAmount: 4_900,
        grossProfit: 1_291.24,
        orderCount: 1,
        returnAmount: 4_900,
        returnGrossProfit: 1_291.24,
        marketplaceFeeAmount: 0,
        marketplaceIncomeAmount: 0,
      }),
      { hasReturn: true, profitAfterReturn: 0, netMarketplaceFee: 0, profitAfterFee: 0 },
    );
    // Platform income is added back: fee 100 − income 30 = net fee 70.
    assert.deepEqual(
      computeChannelNetFigures({
        channel: SaleChannel.SHOPEE,
        salesAmount: 1_000,
        grossProfit: 300,
        orderCount: 1,
        returnAmount: 0,
        returnGrossProfit: 0,
        marketplaceFeeAmount: 100,
        marketplaceIncomeAmount: 30,
      }),
      { hasReturn: false, profitAfterReturn: 300, netMarketplaceFee: 70, profitAfterFee: 230 },
    );
  },
);
