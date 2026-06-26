import test from "node:test";
import assert from "node:assert/strict";
import {
  STOREFRONT_LINE_COMPACT_BUTTON_CLASS,
  STOREFRONT_LINE_ICON_BUTTON_CLASS,
  STOREFRONT_LINE_PRIMARY_BUTTON_CLASS,
} from "@/lib/storefront-line-theme";

const LINE_BASE = "[#06C755]";
const LINE_HOVER = "[#05a847]";

test("primary LINE button keeps the LINE green theme", () => {
  assert.ok(STOREFRONT_LINE_PRIMARY_BUTTON_CLASS.includes(`bg-${LINE_BASE}`));
  assert.ok(STOREFRONT_LINE_PRIMARY_BUTTON_CLASS.includes(`hover:bg-${LINE_HOVER}`));
});

test("compact LINE button keeps the LINE green theme", () => {
  assert.ok(STOREFRONT_LINE_COMPACT_BUTTON_CLASS.includes(`bg-${LINE_BASE}`));
  assert.ok(STOREFRONT_LINE_COMPACT_BUTTON_CLASS.includes(`hover:bg-${LINE_HOVER}`));
});

test("icon LINE button keeps the LINE green theme", () => {
  assert.ok(STOREFRONT_LINE_ICON_BUTTON_CLASS.includes(`bg-${LINE_BASE}`));
  assert.ok(STOREFRONT_LINE_ICON_BUTTON_CLASS.includes(`hover:bg-${LINE_HOVER}`));
});
