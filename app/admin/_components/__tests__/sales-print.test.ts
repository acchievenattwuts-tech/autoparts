import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import SharedSalesDeliveryPrintDocument from "../SharedSalesDeliveryPrintDocument";

Object.assign(globalThis, { React });
const sale = { saleNo: "SA26090001", saleDate: new Date("2026-09-07T00:00:00Z"), customerName: "ชื่อที่กรอก", customerPhone: "0811111111", shippingAddress: "ที่อยู่จัดส่งที่กรอก", customer: { name: "ชื่อทะเบียน", phone: "0899999999", address: "ที่อยู่ทะเบียน" }, totalAmount: 100, discount: 0, netAmount: 100, paymentType: "CASH_SALE" as const, creditTerm: 30, items: [] };
const render = (patch: Partial<Parameters<typeof SharedSalesDeliveryPrintDocument>[0]["sale"]>) => renderToStaticMarkup(React.createElement(SharedSalesDeliveryPrintDocument, { sale: { ...sale, ...patch }, shopConfig: { shopName: "ร้านทดสอบ" }, dueDate: new Date("2026-10-07T00:00:00Z"), signerDisplayName: "ผู้บันทึก", transferPrimaryAccount: null, receivedTransferAccount: null, promptPayQrDataUrl: null, qrAmount: 0 }));
test("sales receipt prints entered customer fields and delivery address without credit terms", () => {
  const html = render({ fulfillmentType: "DELIVERY" });
  assert.ok(html.includes("ชื่อที่กรอก"));
  assert.ok(html.includes("0811111111"));
  assert.ok(html.includes("ที่อยู่จัดส่งที่กรอก"));
  assert.ok(!html.includes("ชื่อทะเบียน"));
  assert.ok(!html.includes("0899999999"));
  assert.ok(!html.includes("เงื่อนไขชำระ"));
  assert.ok(!html.includes("วันครบกำหนด"));
});
test("pickup retains customer master address, or hides the address when missing", () => {
  assert.ok(render({ fulfillmentType: "PICKUP" }).includes("ที่อยู่ทะเบียน"));
  const html = render({ fulfillmentType: "PICKUP", customer: null });
  assert.ok(!html.includes("ที่อยู่จัดส่งที่กรอก"));
  assert.ok(!html.includes("ที่อยู่: "));
});
test("credit delivery keeps its terms and prints the entered address only once", () => {
  const html = render({ fulfillmentType: "DELIVERY", paymentType: "CREDIT_SALE" });
  assert.ok(html.includes("เงื่อนไขชำระ"));
  assert.ok(html.includes("วันครบกำหนด"));
  assert.equal(html.split("ที่อยู่จัดส่งที่กรอก").length - 1, 1);
});
test("sales prints tax ID and the referenced revision only when present", () => {
  const html = render({ quotation: { quotationNo: "SQ26090001", revision: 3 }, quotationRevision: 1, customer: { taxId: "0105559999999" } });
  assert.ok(html.includes("อ้างอิงใบเสนอราคา"));
  assert.ok(html.includes("SQ26090001 Rev.01"));
  assert.ok(!html.includes("Rev.03"));
  assert.ok(html.includes("0105559999999"));
  const without = render({ quotation: null, customer: { taxId: "  " } });
  assert.ok(!without.includes("อ้างอิงใบเสนอราคา"));
  assert.ok(!without.includes("เลขผู้เสียภาษี"));
});
