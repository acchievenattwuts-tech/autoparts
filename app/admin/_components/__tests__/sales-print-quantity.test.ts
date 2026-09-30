import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Prisma } from "@/lib/generated/prisma";
import SharedSalesDeliveryPrintDocument from "../SharedSalesDeliveryPrintDocument";

// E7: the invoice / delivery-note form (sales/[id], delivery/print and the LIFF invoice and
// receipt pages all render this component) prints integer quantities exactly as before and a
// fractional line with exactly 2 decimals, whether Prisma returns a number or a Decimal.

Object.assign(globalThis, { React });

type PrintProps = Parameters<typeof SharedSalesDeliveryPrintDocument>[0];
type PrintItem = PrintProps["sale"]["items"][number];
type Quantity = number | Prisma.Decimal;

const item = (id: string, quantity: Quantity, showQty: Quantity | null, lotQty?: Quantity): PrintItem => ({
  id,
  quantity,
  salePrice: 200,
  totalAmount: 200,
  showQty,
  showUnitName: "ลิตร",
  showPricePerUnit: 200,
  unitScale: 1,
  lotItems: lotQty === undefined ? [] : [{ lotNo: "LOT-A", qty: lotQty }],
  product: { code: "OIL-1", name: "น้ำมันเครื่อง", reportUnitName: "ลิตร" },
});

const render = (items: PrintItem[]): string =>
  renderToStaticMarkup(
    React.createElement(SharedSalesDeliveryPrintDocument, {
      sale: {
        saleNo: "SA2609300001",
        saleDate: new Date("2026-09-30T00:00:00Z"),
        customerName: "ลูกค้า",
        totalAmount: 200,
        discount: 0,
        netAmount: 200,
        paymentType: "CASH_SALE",
        items,
      },
      shopConfig: { shopName: "ร้านทดสอบ" },
      dueDate: new Date("2026-09-30T00:00:00Z"),
      signerDisplayName: "ผู้บันทึก",
      transferPrimaryAccount: null,
      receivedTransferAccount: null,
      promptPayQrDataUrl: null,
      qrAmount: 0,
    }),
  );

test("integer quantities print byte-identically whether read as a number or a Decimal(12,4)", () => {
  const before = render([item("a", 3, 3, 3), item("b", 1200, null)]);
  const after = render([
    item("a", new Prisma.Decimal("3.0000"), new Prisma.Decimal("3.0000"), new Prisma.Decimal("3.0000")),
    item("b", new Prisma.Decimal("1200.0000"), null),
  ]);
  assert.equal(after, before);
  assert.ok(before.includes(">3</td>"));
  assert.ok(before.includes(">1,200</td>"));
  assert.ok(before.includes("LOT-A × 3"));
});

test("only the fractional line prints with 2 decimals", () => {
  const html = render([item("a", 2, 2), item("b", new Prisma.Decimal("0.4"), new Prisma.Decimal("0.4"), new Prisma.Decimal("0.4"))]);
  assert.ok(html.includes(">2</td>"));
  assert.ok(html.includes(">0.40</td>"));
  assert.ok(html.includes("LOT-A × 0.40"));
  assert.ok(!html.includes(">2.00</td>"));
});
