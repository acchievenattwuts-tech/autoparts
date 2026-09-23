import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";
import { isValidElement, type ReactNode } from "react";

// The bill detail page used to run a separate receiptItem.findFirst (no
// orderBy → arbitrary receipt) and then, for credit bills, fetch the same
// receipts again sequentially. It now reads the receipts once, alongside the
// sale, and links the newest receipt.

type Receipt = { id: string; receiptDate: Date };
let paymentType: "CASH_SALE" | "CREDIT_SALE" = "CREDIT_SALE";
let receipts: Receipt[] = [];
const calls: string[] = [];

const receiptRow = ({ id, receiptDate }: Receipt) => ({
  id,
  receiptNo: `RC-${id}`,
  receiptDate,
  paymentMethod: "CASH",
  status: "ACTIVE",
  cancelNote: null,
  items: [{ id: `item-${id}`, paidAmount: 100 }],
});

before(async () => {
  await mock.module("@/lib/liff-data", {
    namedExports: { getLiffCustomer: async () => ({ id: "cust1" }) },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        sale: {
          findFirst: async () => {
            calls.push("sale");
            return {
              id: "sale1",
              saleNo: "SA2609230001",
              saleDate: new Date("2026-09-22T17:00:00.000Z"),
              subtotalAmount: 100,
              discount: 0,
              vatAmount: 0,
              netAmount: 100,
              amountRemain: 0,
              paymentType,
              fulfillmentType: "PICKUP",
              shippingMethod: null,
              shippingStatus: "PENDING",
              shippingAddress: null,
              trackingNo: null,
              trackingToken: null,
              trackingExpiry: null,
              destLatitude: null,
              destLongitude: null,
              deliveryTracking: null,
              deliveryStaff: null,
              items: [],
            };
          },
        },
        receipt: {
          findMany: async (args: { orderBy: { receiptDate: string } }) => {
            calls.push("receipts");
            assert.deepEqual(args.orderBy, { receiptDate: "desc" });
            return [...receipts].sort((a, b) => b.receiptDate.getTime() - a.receiptDate.getTime()).map(receiptRow);
          },
        },
        receiptItem: {
          findFirst: async () => {
            calls.push("receiptItem");
            return null;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  calls.length = 0;
  receipts = [];
  paymentType = "CREDIT_SALE";
});

const collectHrefs = (node: ReactNode, hrefs: string[] = []): string[] => {
  if (Array.isArray(node)) {
    for (const child of node) collectHrefs(child, hrefs);
  } else if (isValidElement<{ href?: unknown; children?: ReactNode }>(node)) {
    if (typeof node.props.href === "string") hrefs.push(node.props.href);
    collectHrefs(node.props.children, hrefs);
  }
  return hrefs;
};

const renderPage = async () => {
  const { default: Page } = await import("../page");
  const tree = await Page({ params: Promise.resolve({ id: "sale1" }) });
  return collectHrefs(tree).filter((href) => href.includes("/receipt"));
};

test("credit bill links the newest active receipt and queries receipts once", async () => {
  receipts = [
    { id: "old", receiptDate: new Date("2026-09-01T00:00:00Z") },
    { id: "new", receiptDate: new Date("2026-09-20T00:00:00Z") },
  ];
  assert.deepEqual(await renderPage(), ["/liff/orders/sale1/receipt?receiptId=new"]);
  assert.deepEqual([...calls].sort(), ["receipts", "sale"]);
});

test("credit bill without receipts shows no receipt link", async () => {
  assert.deepEqual(await renderPage(), []);
});

test("cash bill keeps its plain receipt link", async () => {
  paymentType = "CASH_SALE";
  receipts = [{ id: "r1", receiptDate: new Date("2026-09-20T00:00:00Z") }];
  assert.deepEqual(await renderPage(), ["/liff/orders/sale1/receipt"]);
  assert.equal(calls.includes("receiptItem"), false);
});
