import test from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_PURCHASE_OCR_RESULT,
  parsePurchaseInvoiceOcr,
} from "../../../../../lib/purchase-invoice-ocr-types";

test("parsePurchaseInvoiceOcr parses a clean invoice JSON", () => {
  const raw = JSON.stringify({
    supplierName: "บริษัท อะไหล่ดี จำกัด",
    referenceNo: "INV-2026-001",
    invoiceDate: "2026-06-10",
    lines: [
      { rawText: "ผ้าเบรคหน้า VIGO", partCode: "BP-1234", qty: 2, unitCost: 350 },
      { rawText: "คอมแอร์ Denso", partCode: null, qty: 1, unitCost: 4500 },
    ],
  });

  const result = parsePurchaseInvoiceOcr(raw);

  assert.equal(result.supplierName, "บริษัท อะไหล่ดี จำกัด");
  assert.equal(result.referenceNo, "INV-2026-001");
  assert.equal(result.invoiceDate, "2026-06-10");
  assert.equal(result.lines.length, 2);
  assert.equal(result.lines[0].partCode, "BP-1234");
  assert.equal(result.lines[0].qty, 2);
  assert.equal(result.lines[1].partCode, null);
});

test("parsePurchaseInvoiceOcr coerces numeric strings and strips thousands separators", () => {
  const raw = JSON.stringify({
    supplierName: null,
    referenceNo: null,
    invoiceDate: null,
    lines: [{ rawText: "ไส้กรองแอร์", partCode: "AF-9", qty: "3", unitCost: "1,250.50" }],
  });

  const [line] = parsePurchaseInvoiceOcr(raw).lines;

  assert.equal(line.qty, 3);
  assert.equal(line.unitCost, 1250.5);
});

test("parsePurchaseInvoiceOcr normalizes a Buddhist-era invoice date to C.E.", () => {
  const raw = JSON.stringify({
    supplierName: null,
    referenceNo: null,
    invoiceDate: "2569-06-10",
    lines: [{ rawText: "x", partCode: null, qty: null, unitCost: null }],
  });

  assert.equal(parsePurchaseInvoiceOcr(raw).invoiceDate, "2026-06-10");
});

test("parsePurchaseInvoiceOcr drops lines without rawText and keeps null qty/cost", () => {
  const raw = JSON.stringify({
    supplierName: null,
    referenceNo: null,
    invoiceDate: null,
    lines: [
      { rawText: "", partCode: "A", qty: 1, unitCost: 1 },
      { partCode: "B", qty: 1, unitCost: 1 },
      { rawText: "ของจริง", partCode: null, qty: null, unitCost: null },
    ],
  });

  const result = parsePurchaseInvoiceOcr(raw);

  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].rawText, "ของจริง");
  assert.equal(result.lines[0].qty, null);
  assert.equal(result.lines[0].unitCost, null);
});

test("parsePurchaseInvoiceOcr extracts JSON wrapped in markdown fences", () => {
  const raw = [
    "```json",
    JSON.stringify({
      supplierName: "S",
      referenceNo: null,
      invoiceDate: null,
      lines: [{ rawText: "item", partCode: null, qty: 1, unitCost: 10 }],
    }),
    "```",
  ].join("\n");

  const result = parsePurchaseInvoiceOcr(raw);

  assert.equal(result.supplierName, "S");
  assert.equal(result.lines.length, 1);
});

test("parsePurchaseInvoiceOcr returns empty on non-JSON / garbage", () => {
  assert.deepEqual(parsePurchaseInvoiceOcr("not json at all"), EMPTY_PURCHASE_OCR_RESULT);
  assert.deepEqual(parsePurchaseInvoiceOcr(""), EMPTY_PURCHASE_OCR_RESULT);
});

test("parsePurchaseInvoiceOcr ignores negative numbers (treats as null)", () => {
  const raw = JSON.stringify({
    supplierName: null,
    referenceNo: null,
    invoiceDate: null,
    lines: [{ rawText: "x", partCode: null, qty: -5, unitCost: -1 }],
  });

  const [line] = parsePurchaseInvoiceOcr(raw).lines;
  assert.equal(line.qty, null);
  assert.equal(line.unitCost, null);
});
