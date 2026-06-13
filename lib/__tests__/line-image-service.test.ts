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

test("parses slip OCR fields from the same classification response", async () => {
  const { parseLineImageClassification } = await import("@/lib/line-image-service");
  const result = parseLineImageClassification(
    '{"kind":"payment_slip","searchHints":[],"confidence":"HIGH","reason":"สลิป","ocr":{"amount":1500,"bank":"กสิกรไทย","referenceNo":"REF123","transferDatetime":null,"senderName":null,"receiverName":null,"rawText":null}}',
  );

  assert.equal(result.kind, "payment_slip");
  assert.equal(result.ocr?.amount, 1500);
  assert.equal(result.ocr?.bank, "กสิกรไทย");
  assert.equal(result.ocr?.referenceNo, "REF123");
});

test("part image has null ocr", async () => {
  const { parseLineImageClassification } = await import("@/lib/line-image-service");
  const result = parseLineImageClassification(
    '{"kind":"part_image","searchHints":["คอมแอร์"],"confidence":"MEDIUM","reason":"x"}',
  );
  assert.equal(result.ocr, null);
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

test("registration-plate chassis/engine codes are kept OUT of search hints", async () => {
  const { parseLineImageClassification } = await import("@/lib/line-image-service");
  const result = parseLineImageClassification(
    JSON.stringify({
      kind: "part_image",
      // vision may still leak chassis codes into raw hints — they must be filtered
      searchHints: ["ISUZU", "TFS86HPM7B", "4JK1", "GU3115", "MR1TFS86HAT100061", "D-Max"],
      partType: "หม้อน้ำ",
      carBrand: "Isuzu",
      carModel: "D-Max",
      year: 2015,
      partNumber: "422176-1870",
      chassisNumber: "MR1TFS86HAT100061",
      partKind: "fitment",
      confidence: "HIGH",
      reason: "plate",
    }),
  );
  const hints = result.searchHints.join(" ");
  assert.ok(hints.includes("หม้อน้ำ") && hints.includes("Isuzu") && hints.includes("D-Max"), "keeps part + car");
  assert.ok(hints.includes("422176-1870"), "keeps printed part number");
  assert.ok(!hints.includes("TFS86HPM7B"), "drops engine code");
  assert.ok(!hints.includes("MR1TFS86HAT100061"), "drops chassis/VIN");
  assert.equal(result.partNumber, "422176-1870");
  assert.equal(result.chassisNumber, "MR1TFS86HAT100061");
});
