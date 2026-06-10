import test from "node:test";
import assert from "node:assert/strict";

import { getLineConversationDropdownClassName } from "../line-conversation-status-switcher-styles";

test("status dropdown uses an opaque surface and stronger separation in dark mode", () => {
  const className = getLineConversationDropdownClassName();

  assert.match(className, /\bdark:bg-slate-950\b/);
  assert.match(className, /\bdark:border-slate-700\b/);
  assert.match(className, /\bdark:shadow-2xl\b/);
  assert.doesNotMatch(className, /\bdark:bg-slate-900\b/);
});
