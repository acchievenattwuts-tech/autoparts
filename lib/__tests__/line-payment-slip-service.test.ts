import test from "node:test";
import assert from "node:assert/strict";

import { PaymentSlipVerificationStatus } from "@/lib/generated/prisma";
import {
  canConfirmPaymentSlip,
  getInitialPaymentSlipStatus,
  parsePaymentSlipOcr,
} from "@/lib/line-payment-slip-service";
import { formatDateTimeThai } from "@/lib/th-date";

test("payment slip submissions start as admin review only", () => {
  assert.equal(getInitialPaymentSlipStatus(), PaymentSlipVerificationStatus.PENDING_REVIEW);
});

test("payment slip cannot be confirmed from a raw image alone", () => {
  assert.equal(canConfirmPaymentSlip(PaymentSlipVerificationStatus.PENDING_REVIEW), false);
  assert.equal(canConfirmPaymentSlip(PaymentSlipVerificationStatus.NEEDS_MORE_INFO), false);
  assert.equal(canConfirmPaymentSlip(PaymentSlipVerificationStatus.REJECTED), false);
});

test("payment slip can be confirmed only after advisory match is ready for admin confirmation", () => {
  assert.equal(
    canConfirmPaymentSlip(PaymentSlipVerificationStatus.MATCHED_PENDING_ADMIN_CONFIRM),
    true,
  );
});

test("parses payment-slip OCR fields and normalizes the amount", () => {
  const ocr = parsePaymentSlipOcr(
    '{"amount":"1,250.50","transferDatetime":"2026-06-08T14:30:00+07:00","bank":"ธนาคารกสิกรไทย","senderName":"สมชาย","receiverName":"ร้านศรีวรรณ","referenceNo":"0123456789","rawText":"โอนเงินสำเร็จ"}',
  );

  assert.equal(ocr.amount, 1250.5);
  assert.equal(ocr.bank, "ธนาคารกสิกรไทย");
  assert.equal(ocr.senderName, "สมชาย");
  assert.equal(ocr.referenceNo, "0123456789");
  assert.ok(ocr.transferDatetimeIso?.startsWith("2026-06-08T"));
});

test("payment-slip OCR treats slip transfer time as Bangkok wall-clock time", () => {
  const ocr = parsePaymentSlipOcr(
    '{"amount":"4,180.00","transferDatetime":"2026-06-10T18:26:00Z","bank":"Krungthai"}',
  );

  assert.equal(
    formatDateTimeThai(ocr.transferDatetimeIso as string, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    "10 มิ.ย. 2026 18:26",
  );
});

test("payment-slip OCR normalizes Buddhist years in transfer datetime", () => {
  const ocr = parsePaymentSlipOcr(
    '{"amount":"4,180.00","transferDatetime":"2569-06-10T18:26:00","bank":"Krungthai"}',
  );

  assert.equal(
    formatDateTimeThai(ocr.transferDatetimeIso as string, {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }),
    "10 มิ.ย. 2026 18:26",
  );
});

test("payment-slip OCR returns empty fields for unparseable output", () => {
  const ocr = parsePaymentSlipOcr("ขอโทษครับ อ่านไม่ออก");

  assert.equal(ocr.amount, null);
  assert.equal(ocr.bank, null);
  assert.equal(ocr.transferDatetimeIso, null);
});

test("payment-slip OCR rejects an invalid amount and date", () => {
  const ocr = parsePaymentSlipOcr('{"amount":"N/A","transferDatetime":"ไม่ทราบ","bank":null}');

  assert.equal(ocr.amount, null);
  assert.equal(ocr.transferDatetimeIso, null);
  assert.equal(ocr.bank, null);
});
