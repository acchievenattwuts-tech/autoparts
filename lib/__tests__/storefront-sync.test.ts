import assert from "node:assert/strict";
import test from "node:test";
import {
  auditThenRepairStorefrontCache,
  buildStorefrontSyncFailureTelegramText,
  getStorefrontMismatchReason,
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

test("audit leaves a current cache untouched", async () => {
  let readCount = 0;
  let expireCount = 0;
  const result = await auditThenRepairStorefrontCache({
    expected: { shouldBeVisible: true, updatedAt: "2026-08-20T08:00:00.000Z", stock: 3 },
    readCache: async () => {
      readCount += 1;
      return { updatedAt: "2026-08-20T08:00:00.000Z", stock: 3 };
    },
    expireCache: async () => { expireCount += 1; },
  });

  assert.equal(result.outcome, "current");
  assert.equal(readCount, 1);
  assert.equal(expireCount, 0);
});

test("audit expires only a stale revision and verifies the repaired cache", async () => {
  let readCount = 0;
  let expireCount = 0;
  const result = await auditThenRepairStorefrontCache({
    expected: { shouldBeVisible: true, updatedAt: "2026-08-20T08:00:00.000Z", stock: 3 },
    readCache: async () => {
      readCount += 1;
      return readCount === 1
        ? { updatedAt: "2026-08-19T08:00:00.000Z", stock: 3 }
        : { updatedAt: "2026-08-20T08:00:00.000Z", stock: 3 };
    },
    expireCache: async () => { expireCount += 1; },
    now: () => new Date("2026-08-20T08:01:00.000Z"),
  });

  assert.equal(result.outcome, "repaired");
  assert.equal(result.initialMismatchReason, "CACHED_REVISION_BEHIND");
  assert.equal(result.mismatchDetectedAt?.toISOString(), "2026-08-20T08:01:00.000Z");
  assert.equal(readCount, 2);
  assert.equal(expireCount, 1);
});

test("audit detects stock drift even when the cached revision is current", () => {
  assert.equal(getStorefrontMismatchReason(
    { shouldBeVisible: true, updatedAt: "2026-08-20T08:00:00.000Z", stock: 4 },
    { updatedAt: "2026-08-20T08:00:00.000Z", stock: 3 },
  ), "CACHED_STOCK_MISMATCH");
});

test("audit repairs an active cache entry that should now be hidden", async () => {
  let readCount = 0;
  const result = await auditThenRepairStorefrontCache({
    expected: { shouldBeVisible: false, updatedAt: "2026-08-20T08:00:00.000Z", stock: 0 },
    readCache: async () => {
      readCount += 1;
      return readCount === 1 ? { updatedAt: "2026-08-19T08:00:00.000Z", stock: 1 } : null;
    },
    expireCache: async () => undefined,
  });

  assert.equal(result.outcome, "repaired");
  assert.equal(result.initialMismatchReason, "EXPECTED_HIDDEN_CACHE_PRESENT");
});

test("an initial cache read error never invalidates the existing cache", async () => {
  let expireCount = 0;
  const result = await auditThenRepairStorefrontCache({
    expected: { shouldBeVisible: true, updatedAt: "2026-08-20T08:00:00.000Z", stock: 1 },
    readCache: async () => { throw new Error("cache unavailable"); },
    expireCache: async () => { expireCount += 1; },
  });

  assert.equal(result.outcome, "error");
  assert.equal(result.errorPhase, "INITIAL_READ");
  assert.equal(result.didExpire, false);
  assert.equal(expireCount, 0);
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
