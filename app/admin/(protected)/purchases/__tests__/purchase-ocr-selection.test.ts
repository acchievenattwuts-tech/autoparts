import assert from "node:assert/strict";
import test from "node:test";

import { choosePurchaseOcrAutoSelectedProductId } from "../purchase-form-data";

test("purchase OCR auto selection skips inactive product candidates", () => {
  assert.equal(
    choosePurchaseOcrAutoSelectedProductId([
      { id: "inactive", isActive: false },
      { id: "active", isActive: true },
    ]),
    "active",
  );
});

test("purchase OCR auto selection leaves line unselected when every candidate is inactive", () => {
  assert.equal(
    choosePurchaseOcrAutoSelectedProductId([{ id: "inactive", isActive: false }]),
    null,
  );
});
