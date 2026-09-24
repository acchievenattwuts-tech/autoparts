import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { getVerifyDocumentState } from "@/lib/verify-document-status";

// Review item #16: the public QR page must not call a cancelled document valid.

test("an ACTIVE document with a valid token is valid", () => {
  assert.equal(getVerifyDocumentState({ tokenValid: true, document: { status: "ACTIVE" } }), "valid");
});

test("a CANCELLED document with a valid token is shown as cancelled, not valid", () => {
  assert.equal(getVerifyDocumentState({ tokenValid: true, document: { status: "CANCELLED" } }), "cancelled");
});

test("a bad token or a missing document stays invalid", () => {
  assert.equal(getVerifyDocumentState({ tokenValid: false, document: { status: "ACTIVE" } }), "invalid");
  assert.equal(getVerifyDocumentState({ tokenValid: false, document: { status: "CANCELLED" } }), "invalid");
  assert.equal(getVerifyDocumentState({ tokenValid: true, document: null }), "invalid");
});

test("both supported document types (sale, receipt) load status and cancelledAt", () => {
  const page = readFileSync(path.join(process.cwd(), "app/verify/[type]/[docNo]/[token]/page.tsx"), "utf8");
  assert.equal(page.match(/status: true,/g)?.length, 2);
  assert.equal(page.match(/cancelledAt: true,/g)?.length, 2);
  assert.match(page, /ออกจากระบบจริง แต่ถูกยกเลิกแล้ว/);
  assert.doesNotMatch(page, /isValid/);
});
