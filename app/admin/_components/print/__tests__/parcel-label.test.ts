import assert from "node:assert/strict";
import test from "node:test";

import {
  PARCEL_LABEL_DEFAULT_SIZE,
  PARCEL_LABEL_SIZE_CONFIG,
  countWrappedLines,
  parseParcelLabelSize,
  resolveRecipientTextScale,
} from "../parcel-label";

test("parseParcelLabelSize รับเฉพาะ A4 นอกนั้นตกกลับเป็นค่าเริ่มต้น", () => {
  assert.equal(parseParcelLabelSize("A4"), "A4");
  assert.equal(parseParcelLabelSize("A5"), "A5");
  assert.equal(parseParcelLabelSize("a4"), PARCEL_LABEL_DEFAULT_SIZE);
  assert.equal(parseParcelLabelSize("A3"), PARCEL_LABEL_DEFAULT_SIZE);
  assert.equal(parseParcelLabelSize(null), PARCEL_LABEL_DEFAULT_SIZE);
  assert.equal(parseParcelLabelSize(undefined), PARCEL_LABEL_DEFAULT_SIZE);
});

test("A5 กับ A4 แนวนอนมีสัดส่วนเท่ากัน เลย์เอาต์เดียวจึงใช้ได้ทั้งสองขนาด", () => {
  const a5 = PARCEL_LABEL_SIZE_CONFIG.A5;
  const a4 = PARCEL_LABEL_SIZE_CONFIG.A4;

  const a5Ratio = a5.widthMm / a5.heightMm;
  const a4Ratio = a4.widthMm / a4.heightMm;
  assert.ok(Math.abs(a5Ratio - a4Ratio) < 0.01, `สัดส่วนต่างกันเกินไป: ${a5Ratio} vs ${a4Ratio}`);

  // ตัวอักษรต้องโตตามกระดาษ ไม่งั้นใบ A4 จะดูโล่งผิดสัดส่วน
  const fontRatio = a4.baseFontMm / a5.baseFontMm;
  const widthRatio = a4.widthMm / a5.widthMm;
  assert.ok(Math.abs(fontRatio - widthRatio) < 0.02, `ตัวอักษรไม่ได้โตตามกระดาษ: ${fontRatio}`);
});

test("countWrappedLines นับบรรทัดที่ตัดเอง รวมบรรทัดที่จะถูกตัดคำ", () => {
  assert.equal(countWrappedLines("", 10), 0);
  assert.equal(countWrappedLines("   \n  \n", 10), 0);
  assert.equal(countWrappedLines("สั้น", 10), 1);
  assert.equal(countWrappedLines("บรรทัดหนึ่ง\nบรรทัดสอง", 20), 2);
  // 25 ตัวอักษรบนบรรทัดละ 10 → 3 บรรทัด
  assert.equal(countWrappedLines("x".repeat(25), 10), 3);
});

test("ที่อยู่สั้นไม่ถูกย่อ", () => {
  const scale = resolveRecipientTextScale({
    name: "อู่ช่างเอ ยนตรกิจ (คุณสมชาย)",
    address: "88/12 หมู่ 4 ถ.เพชรเกษม ต.อ้อมน้อย\nอ.กระทุ่มแบน จ.สมุทรสาคร 74130",
  });

  assert.equal(scale, 1);
});

test("ที่อยู่ยาวขึ้นถูกย่อลงทีละขั้น และยาวเท่าไรก็ไม่ต่ำกว่าขั้นสุดท้าย", () => {
  const name = "ร้านทดสอบ";
  const scales = [40, 400, 800, 1600, 4000].map((length) =>
    resolveRecipientTextScale({ name, address: "x".repeat(length) }),
  );

  // ยาวขึ้นต้องไม่เคยย่อน้อยลง
  for (let index = 1; index < scales.length; index += 1) {
    assert.ok(
      scales[index] <= scales[index - 1],
      `ขั้นที่ ${index} ย่อน้อยลงแทนที่จะมากขึ้น: ${scales.join(", ")}`,
    );
  }

  assert.equal(scales[0], 1);
  assert.ok(scales[scales.length - 1] > 0, "อัตราย่อต้องเป็นบวกเสมอ");
  assert.ok(scales[scales.length - 1] >= 0.6, "ห้ามย่อจนเล็กกว่าขั้นต่ำที่ยังอ่านออก");
});

test("ชื่อผู้รับยาวมากก็ทำให้ย่อได้ ไม่ใช่นับแค่ที่อยู่", () => {
  const address = "88/12 หมู่ 4 ถ.เพชรเกษม";
  const shortName = resolveRecipientTextScale({ name: "ร้าน ก", address });
  const longName = resolveRecipientTextScale({ name: "บ".repeat(600), address });

  assert.equal(shortName, 1);
  assert.ok(longName < shortName, "ชื่อยาวต้องทำให้ย่อลง");
});
