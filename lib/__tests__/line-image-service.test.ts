import test from "node:test";
import assert from "node:assert/strict";

import { LineIntent } from "@/lib/generated/prisma";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("parses a part image with search hints", async () => {
  const { parseLineImageClassification } = await import("@/lib/line-image-service");
  const result = parseLineImageClassification(
    '{"kind":"part_image","searchHints":["คอมแอร์","vios","447220-1234"],"confidence":"MEDIUM","reason":"เห็นคอมแอร์"}',
  );

  assert.equal(result.kind, "part_image");
  assert.equal(result.intent, LineIntent.PART_IMAGE_INQUIRY);
  assert.deepEqual(result.searchHints, ["คอมแอร์", "vios", "447220-1234"]);
  assert.equal(result.confidence, "MEDIUM");
});

test("parses a payment slip and forces empty search hints", async () => {
  const { parseLineImageClassification } = await import("@/lib/line-image-service");
  const result = parseLineImageClassification(
    '{"kind":"payment_slip","searchHints":["ignore-me"],"confidence":"HIGH","reason":"สลิปธนาคาร"}',
  );

  assert.equal(result.kind, "payment_slip");
  assert.equal(result.intent, LineIntent.PAYMENT_SLIP_IMAGE);
  assert.deepEqual(result.searchHints, []);
});

test("falls back to unknown for unparseable output", async () => {
  const { parseLineImageClassification } = await import("@/lib/line-image-service");
  const result = parseLineImageClassification("not json at all");

  assert.equal(result.kind, "unknown_image");
  assert.equal(result.intent, LineIntent.UNKNOWN);
  assert.deepEqual(result.searchHints, []);
});

test("tolerates markdown-wrapped json and unexpected kind", async () => {
  const { parseLineImageClassification } = await import("@/lib/line-image-service");
  const result = parseLineImageClassification('```json\n{"kind":"weird","searchHints":[]}\n```');

  assert.equal(result.kind, "unknown_image");
  assert.equal(result.intent, LineIntent.UNKNOWN);
});
