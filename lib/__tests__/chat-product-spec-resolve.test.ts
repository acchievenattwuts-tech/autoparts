import test from "node:test";
import assert from "node:assert/strict";

import {
  BLOWER_MOTOR_CATEGORY_HINT,
  buildChatProductIdentityRequiredTokenGroups,
  buildChatProductSpecRequiredTokenGroups,
  buildChatProductSpecSubject,
  CONDENSER_FAN_MOTOR_CATEGORY_HINT,
  COOLING_FAN_BLADE_CATEGORY_HINT,
  extractChatProductIdentityConstraints,
  resolveChatProductSpecs,
} from "@/lib/chat-core/product-spec-resolve";

test("พัดลมเป่า 14 นิ้ว resolves to Cooling Fan Blade with physical specs", () => {
  const specs = resolveChatProductSpecs("พัดลมเป่า 14นิ้วมีไหมคับ");

  assert.deepEqual(specs, {
    categoryHint: COOLING_FAN_BLADE_CATEGORY_HINT,
    diameterInches: 14,
    fanDirection: "push",
    voltage: null,
  });
  assert.deepEqual(buildChatProductSpecRequiredTokenGroups(specs), [
    ["14 นิ้ว", "14นิ้ว", "14 inch", "14inch", '14"'],
    ["แบบเป่า", "พัดลมเป่า", "push fan", "pusher fan"],
  ]);
  assert.equal(buildChatProductSpecSubject("พัดลมเป่า 14นิ้ว"), "พัดลม แบบเป่า 14 นิ้ว");
});

test("explicit blower and fan-motor contexts win over a generic inch/push signal", () => {
  assert.equal(
    resolveChatProductSpecs("พัดลมเป่าตู้แอร์ 14 นิ้ว").categoryHint,
    BLOWER_MOTOR_CATEGORY_HINT,
  );
  assert.equal(
    resolveChatProductSpecs("มอเตอร์พัดลมหม้อน้ำ 14 นิ้ว").categoryHint,
    CONDENSER_FAN_MOTOR_CATEGORY_HINT,
  );
  assert.equal(
    resolveChatProductSpecs("พัดลมแอร์ 14 นิ้ว").categoryHint,
    BLOWER_MOTOR_CATEGORY_HINT,
  );
});

test("nearby universal fan wording keeps size, direction, and voltage", () => {
  const pull = resolveChatProductSpecs("พัดลมดูด 10 inch 24V");
  assert.equal(pull.categoryHint, COOLING_FAN_BLADE_CATEGORY_HINT);
  assert.equal(pull.diameterInches, 10);
  assert.equal(pull.fanDirection, "pull");
  assert.equal(pull.voltage, 24);

  const quoted = resolveChatProductSpecs('ใบพัดลมแบบเป่า 12" 12 โวลต์');
  assert.equal(quoted.categoryHint, COOLING_FAN_BLADE_CATEGORY_HINT);
  assert.equal(quoted.diameterInches, 12);
  assert.equal(quoted.fanDirection, "push");
  assert.equal(quoted.voltage, 12);
});

test("bare or unrelated numbers never become an inch hard-filter", () => {
  assert.deepEqual(resolveChatProductSpecs("พัดลม"), {
    categoryHint: null,
    diameterInches: null,
    fanDirection: null,
    voltage: null,
  });
  assert.equal(resolveChatProductSpecs("พัดลมรถปี 2014").diameterInches, null);
  assert.equal(resolveChatProductSpecs("พัดลม 14 ใบ").diameterInches, null);
});

test("customer-grounded physical constraints normalize numbered features and connector shapes", () => {
  const text = "มีวาล์วแอร์ 1 หาง No 80 ธรรมดา (หัว Taper) ไหมคะ";

  assert.deepEqual(extractChatProductIdentityConstraints(text), [
    {
      key: "count:tail:1",
      evidence: "1 หาง",
      variants: ["1 หาง", "1หาง", "1 tail", "1tail", "หางเดียว", "single tail", "one tail"],
    },
    {
      key: "connector:taper",
      evidence: "หัว Taper",
      variants: ["taper", "หัว taper", "หัวtaper", "เตเปอร์", "หัวเตเปอร์", "เทเปอร์", "หัวเทเปอร์"],
    },
  ]);
  assert.deepEqual(buildChatProductIdentityRequiredTokenGroups(text), [
    ["1 หาง", "1หาง", "1 tail", "1tail", "หางเดียว", "single tail", "one tail"],
    ["taper", "หัว taper", "หัวtaper", "เตเปอร์", "หัวเตเปอร์", "เทเปอร์", "หัวเทเปอร์"],
  ]);
});

test("bare No numbers and vague adjectives never become hard product constraints", () => {
  assert.deepEqual(extractChatProductIdentityConstraints("วาล์วแอร์ No80 ธรรมดา"), []);
  assert.deepEqual(extractChatProductIdentityConstraints("วาล์วแอร์ No 80 แบบธรรมดา"), []);
});

test("numbered physical features work across product categories without category hardcoding", () => {
  assert.deepEqual(buildChatProductIdentityRequiredTokenGroups("สวิตช์แรงดัน 4 ขา ปลั๊กเดิม"), [
    ["4 ขา", "4ขา", "4 pin", "4pin"],
  ]);
  assert.deepEqual(buildChatProductIdentityRequiredTokenGroups("มอเตอร์ 3 สาย หัว Flare"), [
    ["3 สาย", "3สาย", "3 wire", "3wire"],
    ["flare", "หัว flare", "หัวflare", "แฟร์", "หัวแฟร์", "แฟลร์", "หัวแฟลร์"],
  ]);
});
