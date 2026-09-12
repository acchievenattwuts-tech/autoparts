import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLineDailySummaryFlexMessageV3,
  renderEmojiLineDailySummaryMessage,
  type LineDailySummary,
} from "@/lib/line-daily-summary";

const money: LineDailySummary["money"] = {
  salesTotal: 9_265,
  storeSales: 8_000,
  storeGrossProfit: 2_491.75,
  storeOrderCount: 6,
  shopeeSales: 0,
  shopeeGrossProfit: 0,
  shopeeOrderCount: 0,
  lazadaSales: 1_265,
  lazadaGrossProfit: 629.96,
  lazadaOrderCount: 1,
  cashSales: 7_985,
  creditSales: 1_280,
  costOfGoodsSoldToday: 6_143.29,
  grossProfitToday: 3_121.71,
  grossMarginPctToday: 33.69,
  cashInFromSales: 7_985,
  cashInFromReceipts: 1_280,
  cashInFromCustomerAdvances: 0,
  cashInFromSupplierAdvanceRefunds: 0,
  cashInTotal: 9_265,
  cashChannelTotal: 4_320,
  transferChannelTotal: 4_945,
  arOutstanding: 0,
  codOutstanding: 0,
  apOutstanding: 0,
  expensesToday: 0,
  cashOutForCustomerAdvanceRefunds: 0,
  transfersToday: 0,
};

const counts: LineDailySummary["counts"] = {
  pendingDelivery: 0,
  outForDelivery: 0,
  deliveredToday: 0,
  lowStockCount: 0,
  outOfStockCount: 0,
  expiringLotCount: 0,
  expiredLotCount: 0,
  openClaimCount: 0,
  cancelledDocumentCount: 0,
  stockAdjustmentCount: 0,
};

const balances: LineDailySummary["balances"] = {
  accounts: [],
  totalBalance: 0,
};

const risks: LineDailySummary["risks"] = {
  overdueArCount: 0,
  overdueArAmount: 0,
  outOfStockCount: 0,
  dueApCount: 0,
  dueApAmount: 0,
  codWaitingCount: 0,
  codWaitingAmount: 0,
  expiringLotWithin30: 0,
  cashBankBelowCount: 0,
  pendingAndClaimCount: 0,
};

function collectText(value: unknown, output: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output);
    return;
  }
  if (typeof value !== "object" || value === null) return;

  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") output.push(record.text);
  for (const child of Object.values(record)) collectText(child, output);
}

test("renders Lazada in text and compact Flex while zero Shopee rows stay hidden", () => {
  const summary = {
    reportDateLabel: "12/09/2026",
    money,
    counts,
    balances,
    risks,
    monthly: null,
  };

  const textMessage = renderEmojiLineDailySummaryMessage(summary);
  assert.match(textMessage, /Shopee 0\.00 บาท \(0 ออเดอร์\)/);
  assert.match(textMessage, /Lazada 1,265\.00 บาท \(1 ออเดอร์\)/);

  const flexMessage = buildLineDailySummaryFlexMessageV3(summary, { compactMode: true });
  const textNodes: string[] = [];
  collectText(flexMessage.contents, textNodes);

  assert.equal(textNodes.includes("Shopee"), false);
  assert.equal(textNodes.includes("GP Shopee"), false);
  assert.equal(textNodes.includes("Lazada"), true);
  assert.equal(textNodes.includes("฿1,265.00 / 1 ออเดอร์"), true);
  assert.equal(textNodes.includes("GP Lazada"), true);
  assert.equal(textNodes.includes("฿629.96"), true);
});
