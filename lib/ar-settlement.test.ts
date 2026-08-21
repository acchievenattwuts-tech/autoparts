import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  validateReceiptItemsAgainstAvailable,
  type AvailableReceiptDocumentBundle,
} from "./ar-settlement";

const available: AvailableReceiptDocumentBundle = {
  sales: [{
    id: "sale-1",
    docNo: "SAC26080001",
    docDate: new Date("2026-08-21T00:00:00.000Z"),
    totalAmount: 1000,
    usedAmount: 0,
    outstanding: 1000,
  }],
  creditNotes: [],
  advances: [{
    id: "advance-1",
    docNo: "SD26080001",
    docDate: new Date("2026-08-20T00:00:00.000Z"),
    totalAmount: 600,
    usedAmount: 200,
    outstanding: 400,
  }],
};

describe("receipt settlement with customer advances", () => {
  it("allows partial advance usage through a receipt", () => {
    assert.equal(
      validateReceiptItemsAgainstAvailable("customer-1", [
        { saleId: "sale-1", paidAmount: 1000 },
        { customerAdvanceId: "advance-1", paidAmount: 250 },
      ], available),
      null,
    );
  });

  it("rejects usage beyond amountRemain", () => {
    assert.equal(
      validateReceiptItemsAgainstAvailable("customer-1", [
        { saleId: "sale-1", paidAmount: 1000 },
        { customerAdvanceId: "advance-1", paidAmount: 401 },
      ], available),
      "ยอดที่นำมัดจำ SD26080001 มาใช้ มากกว่ายอดคงเหลือที่ใช้ได้",
    );
  });

  it("requires a credit sale and rejects an unavailable advance", () => {
    assert.equal(
      validateReceiptItemsAgainstAvailable("customer-1", [
        { customerAdvanceId: "advance-1", paidAmount: 100 },
      ], available),
      "กรุณาเลือกใบขายเชื่ออย่างน้อย 1 รายการ",
    );
    assert.equal(
      validateReceiptItemsAgainstAvailable("customer-1", [
        { saleId: "sale-1", paidAmount: 1000 },
        { customerAdvanceId: "other-customer-advance", paidAmount: 100 },
      ], available),
      "พบเงินมัดจำลูกค้าที่เลือกไม่ถูกต้อง ถูกยกเลิก หรือไม่ใช่ของลูกค้ารายนี้",
    );
  });
});
