import assert from "node:assert/strict";
import test from "node:test";
import {
  isRectOutOfViewport,
  resolveOpenInteraction,
  shouldFocusSearchOnOpen,
} from "../dropdown-open-interaction";

test("a touch or pen tap opens the list without focusing the search box", () => {
  assert.equal(shouldFocusSearchOnOpen("touch"), false);
  assert.equal(shouldFocusSearchOnOpen("pen"), false);
});

test("mouse and keyboard opens keep focusing the search box", () => {
  assert.equal(shouldFocusSearchOnOpen("mouse"), true);
  assert.equal(shouldFocusSearchOnOpen("keyboard"), true);
});

test("a known pointer type wins over the device's primary pointer", () => {
  assert.equal(resolveOpenInteraction("mouse", true), "mouse");
  assert.equal(resolveOpenInteraction("touch", false), "touch");
});

test("an unknown pointer type falls back to the device's primary pointer", () => {
  assert.equal(resolveOpenInteraction("", true), "touch");
  assert.equal(resolveOpenInteraction("", false), "mouse");
});

test("an anchor still on screen keeps the list following it", () => {
  const VIEWPORT_HEIGHT = 800;
  assert.equal(isRectOutOfViewport({ top: 100, bottom: 140 }, VIEWPORT_HEIGHT), false);
  assert.equal(isRectOutOfViewport({ top: -20, bottom: 20 }, VIEWPORT_HEIGHT), false);
  assert.equal(isRectOutOfViewport({ top: 780, bottom: 820 }, VIEWPORT_HEIGHT), false);
});

test("an anchor scrolled fully off screen closes the list", () => {
  const VIEWPORT_HEIGHT = 800;
  assert.equal(isRectOutOfViewport({ top: -60, bottom: -20 }, VIEWPORT_HEIGHT), true);
  assert.equal(isRectOutOfViewport({ top: 820, bottom: 860 }, VIEWPORT_HEIGHT), true);
});
