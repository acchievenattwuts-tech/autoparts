import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const newPageSource = readFileSync(
  path.join(repoRoot, "app", "admin", "(protected)", "profit-distributions", "new", "page.tsx"),
  "utf8",
);
const declareFormSource = readFileSync(
  path.join(repoRoot, "app", "admin", "(protected)", "profit-distributions", "DeclareForm.tsx"),
  "utf8",
);

test("profit distribution warning shows unsettled bill counts and amounts by channel", () => {
  assert.match(newPageSource, /pendingChannelFees\.pendingSaleCount/);
  assert.match(newPageSource, /getMarketplaceChannelConfig/);
  assert.match(newPageSource, /ยังไม่ได้กระทบยอด/);
  assert.doesNotMatch(newPageSource, /estimatedPendingFee/);
});

test("unsettled profit distribution requires an explicit second confirmation", () => {
  assert.match(declareFormSource, /<AlertDialog/);
  assert.match(declareFormSource, /handleSubmitRequest/);
  assert.match(declareFormSource, /ยืนยันปันผลทั้งที่ยังกระทบยอดไม่ครบ/);
  assert.match(declareFormSource, /ยืนยันทำรายการต่อ/);
});
