import assert from "node:assert/strict";
import test, { before, mock } from "node:test";

import { SaleChannel } from "@/lib/generated/prisma";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

type DateRange = { gte: Date; lte: Date };
type SettlementGroupArgs = {
  by: string[];
  where: { status: string };
};
type PendingSaleGroupArgs = {
  by: string[];
  where: { saleDate: DateRange };
};
type ProductProfitGroupArgs = {
  by: string[];
  where: { businessDate: DateRange };
};

let settlementGroupArgs: SettlementGroupArgs | null = null;
let pendingSaleGroupArgs: PendingSaleGroupArgs | null = null;
let productProfitGroupArgs: ProductProfitGroupArgs | null = null;
let estimatePendingChannelFees:
  | typeof import("@/lib/marketplace/queries")["estimatePendingChannelFees"]
  | undefined;
let getChannelProductProfit:
  | typeof import("@/lib/marketplace/queries")["getChannelProductProfit"]
  | undefined;

before(async () => {
  if (moduleMocksUnavailable) return;

  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        marketplaceSettlement: {
          groupBy: async (args: SettlementGroupArgs) => {
            settlementGroupArgs = args;
            return [
              {
                channel: SaleChannel.SHOPEE,
                _count: { _all: 2 },
                _sum: { salesAmount: 1_000, feeAmount: 100 },
              },
              {
                channel: SaleChannel.LAZADA,
                _count: { _all: 1 },
                _sum: { salesAmount: 1_000, feeAmount: 300 },
              },
            ];
          },
        },
        sale: {
          groupBy: async (args: PendingSaleGroupArgs) => {
            pendingSaleGroupArgs = args;
            return [
              { channel: SaleChannel.SHOPEE, _sum: { netAmount: 500 } },
              { channel: SaleChannel.LAZADA, _sum: { netAmount: 400 } },
            ];
          },
        },
        factProfit: {
          groupBy: async (args: ProductProfitGroupArgs) => {
            productProfitGroupArgs = args;
            return [
              {
                channel: SaleChannel.SHOPEE,
                productId: "shared-product",
                productName: "Shared product",
                _sum: { quantity: 1, salesAmountExVat: 900, grossProfit: 300 },
              },
              {
                channel: SaleChannel.LAZADA,
                productId: "shared-product",
                productName: "Shared product",
                _sum: { quantity: 1, salesAmountExVat: 100, grossProfit: 50 },
              },
              {
                channel: SaleChannel.SHOPEE,
                productId: "loss-product",
                productName: "Loss product",
                _sum: { quantity: 1, salesAmountExVat: 100, grossProfit: 5 },
              },
            ];
          },
        },
      },
    },
  });

  ({ estimatePendingChannelFees, getChannelProductProfit } = await import(
    "@/lib/marketplace/queries"
  ));
});

test(
  "estimates pending fees and product profit with separate Shopee and Lazada rates",
  { skip: moduleMocksUnavailable },
  async () => {
    assert.ok(estimatePendingChannelFees);
    assert.ok(getChannelProductProfit);
    const start = new Date("2026-09-01T17:00:00.000Z");
    const end = new Date("2026-09-30T16:59:59.999Z");

    const estimate = await estimatePendingChannelFees(start, end);
    assert.deepEqual(
      estimate.byChannel.map((row) => ({
        channel: row.channel,
        rate: row.averageFeeRate,
        pendingFee: row.estimatedPendingFee,
      })),
      [
        { channel: SaleChannel.SHOPEE, rate: 0.1, pendingFee: 50 },
        { channel: SaleChannel.LAZADA, rate: 0.3, pendingFee: 120 },
      ],
    );
    assert.equal(estimate.pendingSalesAmount, 900);
    assert.equal(estimate.estimatedPendingFee, 170);
    assert.equal(estimate.sampleSettlementCount, 3);

    const feeRates = new Map(
      estimate.byChannel.map((row) => [row.channel, row.averageFeeRate] as const),
    );
    const products = await getChannelProductProfit(
      [SaleChannel.SHOPEE, SaleChannel.LAZADA],
      start,
      end,
      feeRates,
    );

    assert.deepEqual(products.best[0], {
      productId: "shared-product",
      productName: "Shared product",
      quantity: 2,
      salesAmount: 1_000,
      grossProfit: 350,
      estimatedProfitAfterFee: 230,
      marginPct: 35,
    });
    assert.deepEqual(products.worst, [
      {
        productId: "loss-product",
        productName: "Loss product",
        quantity: 1,
        salesAmount: 100,
        grossProfit: 5,
        estimatedProfitAfterFee: -5,
        marginPct: 5,
      },
    ]);
    assert.deepEqual(settlementGroupArgs?.by, ["channel"]);
    assert.deepEqual(pendingSaleGroupArgs?.by, ["channel"]);
    assert.deepEqual(productProfitGroupArgs?.by, ["channel", "productId", "productName"]);
  },
);
