import assert from "node:assert/strict";
import test from "node:test";

import {
  PURCHASE_OCR_MAX_FILE_BYTES,
  PURCHASE_OCR_MAX_FILES,
  validatePurchaseOcrUploadRequest,
} from "@/lib/purchase-invoice-ocr-types";

import { getPurchasePaymentDisplayStatus } from "../purchase-payment-status";
import { getPurchaseUserErrorMessage, PurchaseUserError } from "../purchase-user-error";

test("purchase payment status mirrors the stored amountRemain", () => {
  assert.equal(getPurchasePaymentDisplayStatus("CASH_PURCHASE", 1000, 0), "PAID");
  assert.equal(getPurchasePaymentDisplayStatus("CREDIT_PURCHASE", 1000, 1000), "UNPAID");
  assert.equal(getPurchasePaymentDisplayStatus("CREDIT_PURCHASE", 1000, 400), "PARTIALLY_PAID");
  assert.equal(getPurchasePaymentDisplayStatus("CREDIT_PURCHASE", 1000, 0), "PAID");
});

test("only PurchaseUserError messages are surfaced to the user", () => {
  assert.equal(getPurchaseUserErrorMessage(new PurchaseUserError("Lot A คงเหลือไม่พอ")), "Lot A คงเหลือไม่พอ");
  assert.equal(getPurchaseUserErrorMessage(new Error("relation does not exist")), null);
  assert.equal(getPurchaseUserErrorMessage("boom"), null);
});

test("OCR upload request keeps the existing messages for valid and invalid lists", () => {
  assert.equal(validatePurchaseOcrUploadRequest([{ mimeType: "image/jpeg", size: 1024 }]), null);
  assert.equal(validatePurchaseOcrUploadRequest([{ mimeType: "application/pdf", size: PURCHASE_OCR_MAX_FILE_BYTES }]), null);
  assert.equal(validatePurchaseOcrUploadRequest([]), "กรุณาแนบไฟล์อย่างน้อย 1 ไฟล์");
  assert.equal(validatePurchaseOcrUploadRequest(null), "กรุณาแนบไฟล์อย่างน้อย 1 ไฟล์");
  assert.equal(
    validatePurchaseOcrUploadRequest(
      Array.from({ length: PURCHASE_OCR_MAX_FILES + 1 }, () => ({ mimeType: "image/png", size: 10 })),
    ),
    `แนบไฟล์ได้ไม่เกิน ${PURCHASE_OCR_MAX_FILES} ไฟล์ต่อครั้ง`,
  );
  assert.equal(validatePurchaseOcrUploadRequest([{ mimeType: "text/html", size: 10 }]), "รองรับเฉพาะไฟล์รูปภาพหรือ PDF เท่านั้น");
  assert.equal(
    validatePurchaseOcrUploadRequest([{ mimeType: "image/png", size: PURCHASE_OCR_MAX_FILE_BYTES + 1 }]),
    "ขนาดไฟล์ต้องไม่เกิน 15MB ต่อไฟล์",
  );
  assert.equal(
    validatePurchaseOcrUploadRequest([
      { mimeType: "image/png", size: 12 * 1024 * 1024 },
      { mimeType: "image/png", size: 12 * 1024 * 1024 },
    ]),
    "ขนาดไฟล์รวมต้องไม่เกิน 20MB",
  );
});

test("OCR upload request rejects client-supplied sizes that are not real numbers", () => {
  // Previously a string / NaN size slipped past `size <= 0 || size > MAX`.
  for (const size of ["999999999", Number.NaN, Number.POSITIVE_INFINITY, 0, -5, 1.5, undefined]) {
    assert.equal(
      validatePurchaseOcrUploadRequest([{ mimeType: "image/png", size }]),
      "ขนาดไฟล์ต้องไม่เกิน 15MB ต่อไฟล์",
      `size ${String(size)}`,
    );
  }
  assert.equal(validatePurchaseOcrUploadRequest([{ mimeType: 42, size: 10 }]), "รองรับเฉพาะไฟล์รูปภาพหรือ PDF เท่านั้น");
  assert.equal(validatePurchaseOcrUploadRequest(["not-an-object"]), "รองรับเฉพาะไฟล์รูปภาพหรือ PDF เท่านั้น");
});
