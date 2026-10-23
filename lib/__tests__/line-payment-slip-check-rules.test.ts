import test from "node:test";
import assert from "node:assert/strict";

import {
  buildPaymentSlipWarnings,
  checkPaymentSlipReceiver,
  getPaymentSlipDuplicateKind,
  getPaymentSlipTransferMinuteRange,
  normalizePaymentSlipReceiverName,
  normalizePaymentSlipReferenceKey,
  type PaymentSlipDuplicateFields,
} from "@/lib/line-payment-slip-check-rules";

const SHOP_ACCOUNTS = ["ศรีวรรณอะไหล่แอร์", "พักเงิน Lazada", "พักเงิน Shopee"];

const slip = (overrides: Partial<PaymentSlipDuplicateFields> & { id: string }): PaymentSlipDuplicateFields => ({
  referenceNoKey: null,
  amount: null,
  transferDatetime: null,
  ...overrides,
});

test("reference key strips spaces and symbols and ignores letter case", () => {
  assert.equal(normalizePaymentSlipReferenceKey("2026 1023-ab cd.EF"), "20261023ABCDEF");
  assert.equal(
    normalizePaymentSlipReferenceKey("016296150433COR04837"),
    normalizePaymentSlipReferenceKey("016296150433cor04837"),
  );
});

test("reference key is null when missing or too short to be a bank reference", () => {
  assert.equal(normalizePaymentSlipReferenceKey(null), null);
  assert.equal(normalizePaymentSlipReferenceKey(""), null);
  assert.equal(normalizePaymentSlipReferenceKey("12-34"), null);
});

test("receiver name normalization drops titles, spaces and masking", () => {
  assert.equal(normalizePaymentSlipReceiverName("น.ส. ทดสอบ ใจดี"), "ทดสอบใจดี");
  assert.equal(normalizePaymentSlipReceiverName("นางสาว ทดสอบ"), "ทดสอบ");
  assert.equal(normalizePaymentSlipReceiverName("MR. TEST J***"), "testj");
  assert.equal(normalizePaymentSlipReceiverName("ร้าน ศรีวรรณอะไหล่แอร์"), "ศรีวรรณอะไหล่แอร์");
});

test("receiver matches the shop's bank account name, with or without spacing", () => {
  assert.equal(checkPaymentSlipReceiver("ศรีวรรณอะไหล่แอร์", SHOP_ACCOUNTS), "MATCH");
  assert.equal(checkPaymentSlipReceiver("ศรีวรรณ อะไหล่แอร์", SHOP_ACCOUNTS), "MATCH");
  assert.equal(checkPaymentSlipReceiver("ร้านศรีวรรณอะไหล่แอร์", SHOP_ACCOUNTS), "MATCH");
});

test("receiver matches a bank-truncated or masked shop name", () => {
  assert.equal(checkPaymentSlipReceiver("ศรีวรรณอะไหล่", SHOP_ACCOUNTS), "MATCH");
  assert.equal(checkPaymentSlipReceiver("ศรีวรรณ อ***", SHOP_ACCOUNTS), "MATCH");
});

test("receiver that is another person is a mismatch", () => {
  assert.equal(checkPaymentSlipReceiver("น.ส. ทดสอบ ใจดี", SHOP_ACCOUNTS), "MISMATCH");
  // Same first name as the shop, different person.
  assert.equal(checkPaymentSlipReceiver("นางสาว ศรีวรรณ สมใจ", SHOP_ACCOUNTS), "MISMATCH");
  // A fragment shorter than the minimum never counts as a truncated match.
  assert.equal(checkPaymentSlipReceiver("ศรี", SHOP_ACCOUNTS), "MISMATCH");
});

test("receiver check reports when it cannot run instead of warning", () => {
  assert.equal(checkPaymentSlipReceiver(null, SHOP_ACCOUNTS), "UNREADABLE");
  assert.equal(checkPaymentSlipReceiver("  ", SHOP_ACCOUNTS), "UNREADABLE");
  assert.equal(checkPaymentSlipReceiver("ศรีวรรณอะไหล่แอร์", []), "NO_ACCOUNTS");
  assert.equal(checkPaymentSlipReceiver("ศรีวรรณอะไหล่แอร์", ["  "]), "NO_ACCOUNTS");
});

test("same reference key is a duplicate, the slip itself is not", () => {
  const target = slip({ id: "a", referenceNoKey: "N123456789" });
  assert.equal(getPaymentSlipDuplicateKind(target, slip({ id: "b", referenceNoKey: "N123456789" })), "REFERENCE");
  assert.equal(getPaymentSlipDuplicateKind(target, target), null);
  assert.equal(getPaymentSlipDuplicateKind(target, slip({ id: "c", referenceNoKey: "N999999999" })), null);
});

test("missing reference keys never match each other", () => {
  assert.equal(getPaymentSlipDuplicateKind(slip({ id: "a" }), slip({ id: "b" })), null);
});

test("same amount in the same transfer minute is a possible duplicate", () => {
  const target = slip({
    id: "a",
    referenceNoKey: "N111111111",
    amount: 1250.5,
    transferDatetime: new Date("2026-10-23T03:15:10.000Z"),
  });
  const sameMinute = slip({
    id: "b",
    referenceNoKey: "N222222222",
    amount: 1250.5,
    transferDatetime: new Date("2026-10-23T03:15:59.000Z"),
  });
  const nextMinute = { ...sameMinute, id: "c", transferDatetime: new Date("2026-10-23T03:16:00.000Z") };
  const otherAmount = { ...sameMinute, id: "d", amount: 1250 };
  assert.equal(getPaymentSlipDuplicateKind(target, sameMinute), "AMOUNT_TIME");
  assert.equal(getPaymentSlipDuplicateKind(target, nextMinute), null);
  assert.equal(getPaymentSlipDuplicateKind(target, otherAmount), null);
});

test("transfer minute range covers exactly one minute", () => {
  const range = getPaymentSlipTransferMinuteRange(new Date("2026-10-23T03:15:42.123Z"));
  assert.equal(range.gte.toISOString(), "2026-10-23T03:15:00.000Z");
  assert.equal(range.lt.toISOString(), "2026-10-23T03:16:00.000Z");
});

test("warnings list duplicates first, then receiver mismatch", () => {
  const warnings = buildPaymentSlipWarnings({
    duplicateKinds: ["REFERENCE", "AMOUNT_TIME", "REFERENCE"],
    receiver: "MISMATCH",
  });
  assert.deepEqual(
    warnings.map((warning) => warning.code),
    ["DUPLICATE_REFERENCE", "POSSIBLE_DUPLICATE", "RECEIVER_MISMATCH"],
  );
  assert.match(warnings[0].message, /2 ใบ/);
});

test("a clean slip or a check that could not run gives no warnings", () => {
  assert.deepEqual(buildPaymentSlipWarnings({ duplicateKinds: [], receiver: "MATCH" }), []);
  assert.deepEqual(buildPaymentSlipWarnings({ duplicateKinds: [], receiver: "UNREADABLE" }), []);
  assert.deepEqual(buildPaymentSlipWarnings({ duplicateKinds: [], receiver: "NO_ACCOUNTS" }), []);
});
