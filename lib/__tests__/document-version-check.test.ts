import assert from "node:assert/strict";
import test from "node:test";

import { buildDocumentChangedMeanwhileMessage, isSameDocumentVersion } from "../document-version-check";

// I5: cancel/edit compare the updatedAt read before the transaction with the row they locked.

test("the same instant passes, whether the locked row returns a Date or an ISO string", () => {
  const read = new Date("2026-11-12T03:00:00.123Z");
  assert.equal(isSameDocumentVersion(new Date(read.getTime()), read), true);
  assert.equal(isSameDocumentVersion("2026-11-12T03:00:00.123Z", read), true);
});

test("a later save, or a missing value on either side, counts as changed", () => {
  const read = new Date("2026-11-12T03:00:00.123Z");
  assert.equal(isSameDocumentVersion(new Date("2026-11-12T03:00:00.124Z"), read), false);
  assert.equal(isSameDocumentVersion(undefined, read), false);
  assert.equal(isSameDocumentVersion(null, read), false);
  assert.equal(isSameDocumentVersion(read, undefined), false);
  assert.equal(isSameDocumentVersion("not a date", read), false);
});

test("the message follows the sale flow's wording, with the document number", () => {
  assert.equal(
    buildDocumentChangedMeanwhileMessage("ใบซื้อ", "RR26110001"),
    "ใบซื้อ RR26110001 ถูกแก้ไขระหว่างดำเนินการ กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง",
  );
});
