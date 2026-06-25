import assert from "node:assert/strict";
import test from "node:test";

import { getThailandDateKey } from "@/lib/th-date";

test("getThailandDateKey accepts serialized Date strings from cached data", () => {
  assert.equal(getThailandDateKey("2026-06-25T02:30:00.000Z"), "2026-06-25");
});
