import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { isValidElement, type ReactNode } from "react";

// The LIFF home used to derive "ยอดที่ต้องชำระ", the outstanding bill count and
// "บิลทั้งหมด" from the latest 50 bills only. The totals now come from separate
// aggregate/count queries (outstanding = same filter as /liff/outstanding),
// while the list itself still shows the latest 50.

type Where = Record<string, unknown>;
const calls: Array<{ kind: string; where: Where; take?: number }> = [];

const orderRow = (index: number) => ({
  id: `sale-${index}`,
  saleNo: `SA26092300${index}`,
  saleDate: new Date("2026-09-22T17:00:00.000Z"),
  netAmount: 1000,
  amountRemain: 0,
  paymentType: "CASH_SALE",
  fulfillmentType: "PICKUP",
  shippingStatus: "PENDING",
  _count: { items: 1 },
});

before(async () => {
  await mock.module("@/lib/liff-data", {
    namedExports: { getLiffCustomer: async () => ({ id: "cust1", name: "ลูกค้าเครดิต" }) },
  });
  await mock.module("@/lib/site-config", {
    namedExports: { getPublicSiteConfig: async () => ({ shopName: "ร้านทดสอบ" }) },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        sale: {
          findMany: async (args: { where: Where; take: number }) => {
            calls.push({ kind: "findMany", where: args.where, take: args.take });
            return [orderRow(1), orderRow(2)];
          },
          count: async (args: { where: Where }) => {
            calls.push({ kind: "count", where: args.where });
            return args.where.shippingStatus === "OUT_FOR_DELIVERY" ? 3 : 75;
          },
          aggregate: async (args: { where: Where }) => {
            calls.push({ kind: "aggregate", where: args.where });
            return { _sum: { amountRemain: 123456.78 }, _count: { _all: 61 } };
          },
        },
      },
    },
  });
});

beforeEach(() => {
  calls.length = 0;
});

const collectText = (node: ReactNode, parts: string[] = []): string[] => {
  if (typeof node === "string" || typeof node === "number") {
    parts.push(String(node));
  } else if (Array.isArray(node)) {
    for (const child of node) collectText(child, parts);
  } else if (isValidElement<{ children?: ReactNode }>(node)) {
    collectText(node.props.children, parts);
  }
  return parts;
};

const renderPage = async () => {
  const { default: Page } = await import("../page");
  const tree = await Page();
  return collectText(tree).join("|");
};

test("header totals come from aggregate/count queries, not the latest-50 list", async () => {
  const text = await renderPage();

  // Outstanding total + count from the aggregate (list only has 2 paid bills).
  assert.match(text, /123,456\.78/);
  assert.match(text, /มีบิลที่ต้องชำระ 61 รายการ/);
  // "บิลทั้งหมด" is the real count, not the list length.
  assert.match(text, /บิลทั้งหมด\|75/);
  assert.match(text, /กำลังจัดส่ง 3 รายการ/);
});

test("outstanding aggregate uses the same filter as the /liff/outstanding page", async () => {
  await renderPage();

  const aggregate = calls.find((call) => call.kind === "aggregate");
  assert.deepEqual(aggregate?.where, {
    customerId: "cust1",
    status: "ACTIVE",
    paymentType: "CREDIT_SALE",
    amountRemain: { gt: 0 },
  });
});

test("the bill list still shows only the latest 50 active bills", async () => {
  await renderPage();

  const list = calls.find((call) => call.kind === "findMany");
  assert.deepEqual(list?.where, { customerId: "cust1", status: "ACTIVE" });
  assert.equal(list?.take, 50);

  const totalCount = calls.find((call) => call.kind === "count" && !("shippingStatus" in call.where));
  assert.deepEqual(totalCount?.where, { customerId: "cust1", status: "ACTIVE" });
});
