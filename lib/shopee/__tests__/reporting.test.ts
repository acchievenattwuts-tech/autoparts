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
  where: { isActive: boolean; sourceType: string; businessDate: DateRange };
};

let saleGroupByArgs: SaleGroupByArgs | null = null;
let profitGroupByArgs: ProfitGroupByArgs | null = null;
let getShopeeReportingSummary:
  | typeof import("@/lib/shopee/services/reporting")["getShopeeReportingSummary"]
  | undefined;

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
              { channel: SaleChannel.STORE, _sum: { grossProfit: 2_491.75 } },
              { channel: SaleChannel.SHOPEE, _sum: { grossProfit: 600 } },
              { channel: SaleChannel.LAZADA, _sum: { grossProfit: 629.96 } },
            ];
          },
        },
        shopeeProductMapping: { findMany: async () => [] },
        shopeeSyncJob: { count: async () => 0 },
        shopeeOrderImport: { count: async () => 0 },
      },
    },
  });

  ({ getShopeeReportingSummary } = await import("@/lib/shopee/services/reporting"));
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
    });
    assert.deepEqual(summary.shopee, {
      channel: SaleChannel.SHOPEE,
      salesAmount: 2_400,
      grossProfit: 600,
      orderCount: 2,
    });
    assert.deepEqual(summary.lazada, {
      channel: SaleChannel.LAZADA,
      salesAmount: 1_265,
      grossProfit: 629.96,
      orderCount: 1,
    });
    assert.deepEqual(saleGroupByArgs?.where, {
      status: "ACTIVE",
      saleDate: { gte: from, lte: to },
    });
    assert.deepEqual(profitGroupByArgs?.where, {
      isActive: true,
      sourceType: "SALE",
      businessDate: { gte: from, lte: to },
    });
  },
);
