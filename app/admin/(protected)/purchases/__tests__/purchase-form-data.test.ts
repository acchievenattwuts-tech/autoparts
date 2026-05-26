import test from "node:test";
import assert from "node:assert/strict";

import { sanitizePurchaseItemsForSubmit } from "../purchase-form-data";

test("sanitizePurchaseItemsForSubmit clamps negative landed cost from existing purchases", () => {
  const items = [
    {
      productId: "p1",
      unitName: "กล่อง",
      qty: 2,
      costPrice: 390,
      landedCost: -156,
      lotItems: [],
    },
  ];

  const [item] = sanitizePurchaseItemsForSubmit(items);

  assert.equal(item.landedCost, 0);
  assert.equal(item.qty, 2);
  assert.equal(item.costPrice, 390);
});
