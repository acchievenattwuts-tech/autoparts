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
type PendingSaleFindArgs = {
  where: { saleDate: DateRange };
  select: { creditNotes: { where: { settlementType: string } } };
};
type ProductProfitGroupArgs = {
  by: string[];
  where: { businessDate: DateRange };
};

let settlementGroupArgs: SettlementGroupArgs | null = null;
let pendingSaleFindArgs: PendingSaleFindArgs | null = null;
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
          findMany: async (args: PendingSaleFindArgs) => {
            pendingSaleFindArgs = args;
            return [
              { channel: SaleChannel.SHOPEE, netAmount: 200, creditNotes: [] },
              { channel: SaleChannel.SHOPEE, netAmount: 200, creditNotes: [] },
              // คืนบางส่วน — นับเป็นบิลค้าง ด้วยยอดหลังหักใบคืน
              { channel: SaleChannel.SHOPEE, netAmount: 150, creditNotes: [{ totalAmount: 50 }] },
              // คืนเต็มจำนวน — ไม่มีเงินค้างโอน ต้องไม่นับเป็นบิลค้าง
              { channel: SaleChannel.SHOPEE, netAmount: 2_250, creditNotes: [{ totalAmount: 2_250 }] },
              { channel: SaleChannel.LAZADA, netAmount: 250, creditNotes: [] },
              { channel: SaleChannel.LAZADA, netAmount: 150, creditNotes: [] },
              {
                channel: SaleChannel.LAZADA,
                netAmount: 300,
                creditNotes: [{ totalAmount: 100 }, { totalAmount: 200 }],
              },
            ];
          },
        },
        factProfit: {
          groupBy: async (args: ProductProfitGroupArgs) => {
            productProfitGroupArgs = args;
            return [
              {
                channel: SaleChannel.SHOPEE,
                sourceType: "SALE",
                sourceId: "shopee-sale-1",
                productId: "shared-product",
                productName: "Shared product",
                _sum: { quantity: 1, salesAmountExVat: 900, grossProfit: 300 },
              },
              {
                channel: SaleChannel.LAZADA,
                sourceType: "SALE",
                sourceId: "lazada-sale-1",
                productId: "shared-product",
                productName: "Shared product",
                _sum: { quantity: 1, salesAmountExVat: 100, grossProfit: 50 },
              },
              {
                channel: SaleChannel.SHOPEE,
                sourceType: "SALE",
                sourceId: "shopee-sale-2",
                productId: "loss-product",
                productName: "Loss product",
                _sum: { quantity: 1, salesAmountExVat: 100, grossProfit: 5 },
              },
              {
                channel: SaleChannel.SHOPEE,
                sourceType: "SALE",
                sourceId: "shopee-sale-pending",
                productId: "shared-product",
                productName: "Shared product",
                _sum: { quantity: 2, salesAmountExVat: 200, grossProfit: 80 },
              },
            ];
          },
        },
        marketplaceSettlementLine: {
          findMany: async () => [
            {
              saleId: "shopee-sale-1",
              creditNoteId: null,
              settlement: { feeAmount: 100, salesAmount: 1_000 },
            },
            {
              saleId: "shopee-sale-2",
              creditNoteId: null,
              settlement: { feeAmount: 100, salesAmount: 1_000 },
            },
          ],
        },
      },
    },
  });

  ({ estimatePendingChannelFees, getChannelProductProfit } = await import(
    "@/lib/marketplace/queries"
  ));
});

test(
  "estimates pending fees per channel and skips fully returned Shopee and Lazada orders",
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
        pendingSaleCount: row.pendingSaleCount,
        pendingSalesAmount: row.pendingSalesAmount,
        pendingFee: row.estimatedPendingFee,
      })),
      [
        {
          channel: SaleChannel.SHOPEE,
          rate: 0.1,
          pendingSaleCount: 3,
          pendingSalesAmount: 500,
          pendingFee: 50,
        },
        {
          channel: SaleChannel.LAZADA,
          rate: 0.3,
          pendingSaleCount: 2,
          pendingSalesAmount: 400,
          pendingFee: 120,
        },
      ],
    );
    assert.equal(estimate.pendingSaleCount, 5);
    assert.equal(estimate.pendingSalesAmount, 900);
    assert.equal(estimate.estimatedPendingFee, 170);
    assert.equal(estimate.sampleSettlementCount, 3);

    const products = await getChannelProductProfit(
      [SaleChannel.SHOPEE, SaleChannel.LAZADA],
      start,
      end,
    );

    assert.deepEqual(products[0].settled.best[0], {
      channel: SaleChannel.SHOPEE,
      productId: "shared-product",
      productName: "Shared product",
      quantity: 1,
      salesAmount: 900,
      grossProfit: 300,
      estimatedProfitAfterFee: 210,
      marginPct: 33.33333333333333,
    });
    assert.deepEqual(products[0].settled.worst, [
      {
        channel: SaleChannel.SHOPEE,
        productId: "loss-product",
        productName: "Loss product",
        quantity: 1,
        salesAmount: 100,
        grossProfit: 5,
        estimatedProfitAfterFee: -5,
        marginPct: 5,
      },
    ]);
    assert.deepEqual(products[0].pending, [
      {
        channel: SaleChannel.SHOPEE,
        productId: "shared-product",
        productName: "Shared product",
        quantity: 2,
        salesAmount: 200,
        grossProfit: 80,
        estimatedProfitAfterFee: null,
        marginPct: 40,
      },
    ]);
    assert.deepEqual(products[1].pending, [
      {
        channel: SaleChannel.LAZADA,
        productId: "shared-product",
        productName: "Shared product",
        quantity: 1,
        salesAmount: 100,
        grossProfit: 50,
        estimatedProfitAfterFee: null,
        marginPct: 50,
      },
    ]);
    assert.deepEqual(settlementGroupArgs?.by, ["channel"]);
    assert.equal(pendingSaleFindArgs?.where.saleDate.gte, start);
    assert.equal(pendingSaleFindArgs?.select.creditNotes.where.settlementType, "CASH_REFUND");
    assert.deepEqual(productProfitGroupArgs?.by, [
      "channel",
      "sourceType",
      "sourceId",
      "productId",
      "productName",
    ]);
  },
);
