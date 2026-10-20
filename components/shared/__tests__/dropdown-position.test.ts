import assert from "node:assert/strict";
import test from "node:test";
import { fitDropdownToViewport } from "../dropdown-position";

const PHONE_WIDTH = 375;
const DESKTOP_WIDTH = 1280;

test("a list that already fits keeps its position and width", () => {
  assert.deepEqual(fitDropdownToViewport(16, 240, PHONE_WIDTH), { left: 16, width: 240 });
  assert.deepEqual(fitDropdownToViewport(0, 240, PHONE_WIDTH), { left: 0, width: 240 });
  assert.deepEqual(fitDropdownToViewport(900, 300, DESKTOP_WIDTH), { left: 900, width: 300 });
});

test("a right-column list on a phone shifts back inside the right edge", () => {
  // The storefront category filter: trigger at 193px, list min-width 240px.
  assert.deepEqual(fitDropdownToViewport(193, 240, PHONE_WIDTH), { left: 127, width: 240 });
});

test("a list wider than the screen is narrowed to the screen", () => {
  assert.deepEqual(fitDropdownToViewport(0, 400, PHONE_WIDTH), { left: 0, width: 359 });
  assert.deepEqual(fitDropdownToViewport(100, 400, PHONE_WIDTH), { left: 8, width: 359 });
});
