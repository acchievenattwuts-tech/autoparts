import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findItemQuantityInputError,
  formatItemQuantity,
  ITEM_QUANTITY_DECIMALS_ERROR,
  ITEM_QUANTITY_INPUT_STEP,
  itemQuantityInputStep,
  itemQuantityLineKey,
  resolveItemBaseQuantity,
} from "@/lib/item-quantity";
import { formatSaleQuantity, toSaleBaseQuantity } from "@/lib/sale-quantity";

// Neutral helpers shared by sales (E7) and purchases (ก5).

test("the sale names are aliases of the neutral helpers", () => {
  assert.equal(formatSaleQuantity, formatItemQuantity);
  assert.equal(formatItemQuantity(20.5), "20.50");
  assert.equal(formatItemQuantity(24), "24");
  assert.equal(toSaleBaseQuantity(20.5, 1), 20.5);
});

test("only lines not reported as unchanged are checked for 2 decimals", () => {
  const lines = [{ qty: 0.125 }, { qty: 20.5 }];
  assert.equal(findItemQuantityInputError(lines), ITEM_QUANTITY_DECIMALS_ERROR);
  assert.equal(findItemQuantityInputError(lines, (index) => index === 0), null);
  assert.equal(findItemQuantityInputError([{ qty: 1 }, { qty: 1.25 }]), null);
});

test("the input step never lets the browser block a value the form decides on", () => {
  assert.equal(itemQuantityInputStep(1), ITEM_QUANTITY_INPUT_STEP);
  assert.equal(itemQuantityInputStep(20.5), ITEM_QUANTITY_INPUT_STEP);
  assert.equal(itemQuantityInputStep(0.125), "any");
});

test("an unchanged saved line is never refused when it is only rewritten", () => {
  assert.equal(resolveItemBaseQuantity(0.25, 0.125, false), null);
  assert.equal(resolveItemBaseQuantity(0.25, 0.125, true), 0.0313);
  assert.equal(resolveItemBaseQuantity(20.5, 1, false), 20.5);
  assert.equal(resolveItemBaseQuantity(2, 12, true), 24);
});

test("a saved line key ignores everything but product, unit and quantity", () => {
  assert.equal(itemQuantityLineKey({ productId: "p", unitName: "ลิตร", qty: 0.125 }), "p|ลิตร|0.125");
});
