import assert from "node:assert/strict";
import test from "node:test";
import {
  describeInputVatTreatment, isInputVatRecoverable, parseVatRegisteredFrom,
} from "@/lib/input-vat";
import { parseDateOnlyToDate } from "@/lib/th-date";

const day = (value: string): Date => parseDateOnlyToDate(value);
const registered = day("2026-11-01");

test("NO_VAT or a zero rate is never recoverable", () => {
  assert.equal(isInputVatRecoverable({ vatType: "NO_VAT", vatRate: 7, taxDocumentDate: day("2026-12-01"), registeredFrom: registered }), false);
  assert.equal(isInputVatRecoverable({ vatType: "EXCLUDING_VAT", vatRate: 0, taxDocumentDate: day("2026-12-01"), registeredFrom: registered }), false);
});

test("VAT types are cost while the shop is not registered", () => {
  for (const vatType of ["EXCLUDING_VAT", "INCLUDING_VAT"]) {
    assert.equal(isInputVatRecoverable({ vatType, vatRate: 7, taxDocumentDate: day("2026-12-01"), registeredFrom: null }), false);
  }
});

test("recoverable from the registration date (Thailand calendar, inclusive)", () => {
  assert.equal(isInputVatRecoverable({ vatType: "INCLUDING_VAT", vatRate: 7, taxDocumentDate: day("2026-10-31"), registeredFrom: registered }), false);
  assert.equal(isInputVatRecoverable({ vatType: "INCLUDING_VAT", vatRate: 7, taxDocumentDate: day("2026-11-01"), registeredFrom: registered }), true);
  // 2026-10-31 17:30 UTC is already 1 November in Thailand.
  assert.equal(isInputVatRecoverable({ vatType: "EXCLUDING_VAT", vatRate: 7, taxDocumentDate: new Date("2026-10-31T17:30:00.000Z"), registeredFrom: registered }), true);
  assert.equal(isInputVatRecoverable({ vatType: "EXCLUDING_VAT", vatRate: 7, taxDocumentDate: null, registeredFrom: registered }), false);
});

test("registration setting parsing", () => {
  assert.equal(parseVatRegisteredFrom(""), null);
  assert.equal(parseVatRegisteredFrom("  "), null);
  assert.equal(parseVatRegisteredFrom("not-a-date"), null);
  assert.equal(parseVatRegisteredFrom(undefined), null);
  assert.ok(parseVatRegisteredFrom("2026-11-01") instanceof Date);
});

test("Thai explanation for each case", () => {
  assert.ok(describeInputVatTreatment({ vatType: "NO_VAT", vatRate: 0, taxDocumentDate: null, registeredFrom: null }).includes("ต้นทุน"));
  assert.ok(describeInputVatTreatment({ vatType: "INCLUDING_VAT", vatRate: 7, taxDocumentDate: day("2026-12-01"), registeredFrom: null }).includes("ยังไม่ได้จดทะเบียน"));
  assert.ok(describeInputVatTreatment({ vatType: "INCLUDING_VAT", vatRate: 7, taxDocumentDate: day("2026-12-01"), registeredFrom: registered }).includes("ภาษีซื้อ"));
  assert.ok(describeInputVatTreatment({ vatType: "EXCLUDING_VAT", vatRate: 7, taxDocumentDate: day("2026-10-01"), registeredFrom: registered }).includes("ก่อนวันจดทะเบียน"));
});
