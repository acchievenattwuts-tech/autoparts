import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStorefrontSyncFailureTelegramText,
  isStorefrontRevisionCurrent,
} from "@/lib/storefront-sync";

test("visible storefront product requires the expected or a newer cached revision", () => {
  const expectedUpdatedAt = new Date("2026-08-20T08:00:00.000Z");

  assert.equal(isStorefrontRevisionCurrent({
    shouldBeVisible: true,
    expectedUpdatedAt,
    observedUpdatedAt: new Date("2026-08-20T07:59:59.999Z"),
  }), false);
  assert.equal(isStorefrontRevisionCurrent({
    shouldBeVisible: true,
    expectedUpdatedAt,
    observedUpdatedAt: expectedUpdatedAt,
  }), true);
  assert.equal(isStorefrontRevisionCurrent({
    shouldBeVisible: true,
    expectedUpdatedAt,
    // Cached payloads may deserialize timestamps as ISO strings depending on
    // the runtime cache backend; the guard must accept both representations.
    observedUpdatedAt: "2026-08-20T08:00:01.000Z",
  }), true);
});

test("hidden or inactive product is current only when absent from the active cache", () => {
  const expectedUpdatedAt = new Date("2026-08-20T08:00:00.000Z");
  assert.equal(isStorefrontRevisionCurrent({
    shouldBeVisible: false,
    expectedUpdatedAt,
    observedUpdatedAt: null,
  }), true);
  assert.equal(isStorefrontRevisionCurrent({
    shouldBeVisible: false,
    expectedUpdatedAt,
    observedUpdatedAt: expectedUpdatedAt,
  }), false);
});

test("Telegram sync failure follows the existing compact alert style without an image", () => {
  const text = buildStorefrontSyncFailureTelegramText({
    productCode: "P0997",
    attempts: 3,
    at: new Date("2026-08-20T08:00:00.000Z"),
    adminLink: "https://example.com/admin/products/product-id/edit",
  });

  assert.match(text, /^🔄 ซิงก์ข้อมูลสินค้าหน้าร้านไม่สำเร็จ\n━━━━━━━━━━━━━━━/);
  assert.match(text, /รหัสสินค้า: P0997/);
  assert.match(text, /ลองตรวจและซ่อมแล้ว: 3 ครั้ง/);
  assert.match(text, /🟡 ต้องตรวจสอบ/);
  assert.match(text, /🔗 ดูรายละเอียด:/);
  assert.doesNotMatch(text, /sendPhoto|รูปภาพ|image/i);
});
