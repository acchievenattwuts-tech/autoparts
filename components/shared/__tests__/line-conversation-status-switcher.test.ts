import test from "node:test";
import assert from "node:assert/strict";

import {
  getLineConversationContainerClassName,
  getLineConversationDropdownClassName,
  getLineConversationCurrentBadgeClassName,
  getLineConversationMenuItemClassName,
} from "../line-conversation-status-switcher-styles";

test("status dropdown uses an opaque surface and stronger separation in dark mode", () => {
  const className = getLineConversationDropdownClassName();

  assert.match(className, /\bborder-slate-200\/90\b/);
  assert.match(className, /\bbg-white\/98\b/);
  assert.match(className, /\bshadow-xl\b/);
  assert.match(className, /\bdark:bg-slate-950\b/);
  assert.match(className, /\bdark:border-slate-700\b/);
  assert.match(className, /\bdark:shadow-2xl\b/);
});

test("current status badge stacks under the menu label instead of colliding inline", () => {
  const itemClassName = getLineConversationMenuItemClassName(true);
  const badgeClassName = getLineConversationCurrentBadgeClassName();

  assert.match(itemClassName, /\bflex\b/);
  assert.match(itemClassName, /\bflex-col\b/);
  assert.match(itemClassName, /\bitems-start\b/);
  assert.match(badgeClassName, /\bmt-1\b/);
  assert.match(badgeClassName, /text-\[11px\]/);
  assert.match(badgeClassName, /\btext-sky-600\b/);
});

test("open status switcher rises above later conversation rows", () => {
  const closedClassName = getLineConversationContainerClassName(false);
  const openClassName = getLineConversationContainerClassName(true);

  assert.match(closedClassName, /\brelative\b/);
  assert.doesNotMatch(closedClassName, /\bz-50\b/);
  assert.match(openClassName, /\bz-50\b/);
});
