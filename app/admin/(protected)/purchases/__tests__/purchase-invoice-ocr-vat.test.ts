import assert from "node:assert/strict";
import test from "node:test";

import {
  describePurchaseOcrVat,
  mapPurchaseOcrVatToForm,
  parsePurchaseInvoiceOcr,
  PURCHASE_OCR_FALLBACK_VAT_RATE,
} from "@/lib/purchase-invoice-ocr-types";
import { calcVat } from "@/lib/vat";

// Owner decision V6: the OCR import reads whether the invoice prices include VAT, the VAT rate and
// amount, and the tax invoice number/date, and sets the form's VAT type/rate and tax-invoice fields
// so the printed line prices are saved under the VAT type they were printed with. Before V6 the
// prompt asked for pre-VAT unit prices while the form stayed NO_VAT — the VAT vanished from the
// payable and from cost.

/** OCR JSON → the values the purchase form ends up with (VAT fields + line prices + net amount). */
const toFormValues = (raw: string) => {
  const ocr = parsePurchaseInvoiceOcr(raw);
  const vat = mapPurchaseOcrVatToForm(ocr, ocr.lines);
  const lines = ocr.lines.map((line) => ({ qty: line.qty ?? 0, costPrice: line.unitCost ?? 0 }));
  const total = lines.reduce((sum, line) => sum + line.qty * line.costPrice, 0);
  return { vat, lines, netAmount: calcVat(total, vat.vatType, vat.vatRate).netAmount };
};

const invoice = (fields: Record<string, unknown>, lines: Array<Record<string, unknown>>) =>
  JSON.stringify({ supplierName: "บริษัท อะไหล่ดี จำกัด", referenceNo: "IV-001", invoiceDate: "2026-09-30", ...fields, lines });

test("parse: reads the tax data, normalizing a Buddhist-era date and string values", () => {
  const ocr = parsePurchaseInvoiceOcr(invoice(
    { taxInvoiceNo: " IV6909-0123 ", taxInvoiceDate: "2569-09-30", vatIncluded: "false", vatRate: "7", vatAmount: "1,070.00" },
    [{ rawText: "ผ้าเบรค", partCode: "BP-1", qty: 2, unitCost: 500 }],
  ));
  assert.equal(ocr.taxInvoiceNo, "IV6909-0123");
  assert.equal(ocr.taxInvoiceDate, "2026-09-30");
  assert.equal(ocr.vatIncluded, false);
  assert.equal(ocr.vatRate, 7);
  assert.equal(ocr.vatAmount, 1070);
});

test("parse: an invoice JSON without the new fields still parses (all tax data null)", () => {
  const ocr = parsePurchaseInvoiceOcr(invoice({}, [{ rawText: "x", partCode: null, qty: 1, unitCost: 10 }]));
  assert.deepEqual(
    [ocr.taxInvoiceNo, ocr.taxInvoiceDate, ocr.vatIncluded, ocr.vatRate, ocr.vatAmount],
    [null, null, null, null, null],
  );
  assert.equal(ocr.lines.length, 1);
});

test("map: prices before VAT with VAT added at the bottom → EXCLUDING_VAT, printed prices kept, net = invoice total", () => {
  const values = toFormValues(invoice(
    { taxInvoiceNo: "IV-9", taxInvoiceDate: "2026-09-30", vatIncluded: false, vatRate: 7, vatAmount: 70 },
    [{ rawText: "ไส้กรอง", partCode: "F-1", qty: 10, unitCost: 100 }],
  ));
  assert.deepEqual(values.vat, { vatType: "EXCLUDING_VAT", vatRate: 7, taxInvoiceNo: "IV-9", taxInvoiceDate: "2026-09-30", notes: [] });
  assert.deepEqual(values.lines, [{ qty: 10, costPrice: 100 }]);
  // The payable (and, while not VAT-registered, the cost) includes the invoice's VAT — the pre-V6
  // import saved 1,000.00 under NO_VAT.
  assert.equal(values.netAmount, 1070);
});

test("map: prices that already include VAT → INCLUDING_VAT at the printed prices", () => {
  const values = toFormValues(invoice(
    { taxInvoiceNo: "IV-10", taxInvoiceDate: "2026-09-29", vatIncluded: true, vatRate: 7, vatAmount: 70 },
    [{ rawText: "คอมแอร์", partCode: null, qty: 10, unitCost: 107 }],
  ));
  assert.deepEqual(values.vat, { vatType: "INCLUDING_VAT", vatRate: 7, taxInvoiceNo: "IV-10", taxInvoiceDate: "2026-09-29", notes: [] });
  assert.deepEqual(values.lines, [{ qty: 10, costPrice: 107 }]);
  assert.equal(values.netAmount, 1070);
  assert.equal(describePurchaseOcrVat(values.vat), "ราคารวม VAT 7%");
});

test("map: a document without VAT → NO_VAT, with a note to change it if the invoice does have VAT", () => {
  const values = toFormValues(invoice({}, [{ rawText: "น็อต", partCode: null, qty: 5, unitCost: 20 }]));
  assert.equal(values.vat.vatType, "NO_VAT");
  assert.equal(values.vat.vatRate, 0);
  assert.equal(values.vat.notes.length, 1);
  assert.match(values.vat.notes[0], /ไม่พบ VAT/);
  assert.equal(values.netAmount, 100);
  assert.equal(describePurchaseOcrVat(values.vat), "ไม่มีภาษี");
});

test("map: VAT shown but the rate and price basis unreadable → EXCLUDING_VAT at the fallback rate, each assumption noted", () => {
  const values = toFormValues(invoice(
    { taxInvoiceNo: null, taxInvoiceDate: null, vatIncluded: null, vatRate: null, vatAmount: 70 },
    [{ rawText: "ไส้กรอง", partCode: null, qty: 10, unitCost: 100 }],
  ));
  assert.equal(values.vat.vatType, "EXCLUDING_VAT");
  assert.equal(values.vat.vatRate, PURCHASE_OCR_FALLBACK_VAT_RATE);
  assert.deepEqual(values.vat.notes, [
    `อ่านอัตรา VAT จากเอกสารไม่ได้ จึงตั้งไว้ ${PURCHASE_OCR_FALLBACK_VAT_RATE}% กรุณาตรวจสอบ`,
    "อ่านไม่ได้ว่าราคาต่อหน่วยรวม VAT แล้วหรือยัง จึงตั้งเป็น \"ราคาไม่รวม VAT\" กรุณาตรวจสอบ",
    "ไม่พบเลขที่ใบกำกับภาษี กรุณากรอกเอง",
    "ไม่พบวันที่ใบกำกับภาษี กรุณากรอกเอง",
  ]);
});

test("map: flags a VAT amount that does not match the lines (e.g. a bottom discount) for review", () => {
  const values = toFormValues(invoice(
    { taxInvoiceNo: "IV-11", taxInvoiceDate: "2026-09-30", vatIncluded: false, vatRate: 7, vatAmount: 63 },
    [{ rawText: "ไส้กรอง", partCode: null, qty: 10, unitCost: 100 }],
  ));
  assert.equal(values.vat.vatType, "EXCLUDING_VAT");
  assert.equal(values.vat.notes.length, 1);
  assert.match(values.vat.notes[0], /70\.00 บาท.*63\.00 บาท/);
});
