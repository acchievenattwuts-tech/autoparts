import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LineMessageType, NotificationSeverity, NotificationType } from "@/lib/generated/prisma";
import { buildLineMirrorText, buildTelegramNotificationText } from "@/lib/telegram";

// A fixed instant so the formatted date/time assertion is deterministic.
// 2025-06-27T07:32:00Z === 14:32 in Asia/Bangkok (UTC+7).
const FIXED_AT = new Date("2025-06-27T07:32:00.000Z");

describe("buildLineMirrorText", () => {
  it("formats a text message with header, divider, name, Gregorian date/time and body", () => {
    const text = buildLineMirrorText({
      displayName: "คุณสมชาย ใจดี",
      messageType: LineMessageType.TEXT,
      text: "หม้อน้ำ Vios 2015 มีไหมครับ",
      at: FIXED_AT,
    });

    assert.match(text, /^💬 ข้อความใหม่จาก LINE OA/);
    assert.match(text, /━━━/);
    assert.match(text, /👤 คุณสมชาย ใจดี/);
    // Gregorian year (ค.ศ.) — never Buddhist Era 2568.
    assert.match(text, /🕐 27\/06\/2025 14:32 น\./);
    assert.ok(!text.includes("2568"), "must not render Buddhist Era year");
    assert.match(text, /หม้อน้ำ Vios 2015 มีไหมครับ/);
  });

  it("falls back to a name placeholder and image label", () => {
    const text = buildLineMirrorText({
      displayName: null,
      messageType: LineMessageType.IMAGE,
      text: null,
      at: FIXED_AT,
    });

    assert.match(text, /👤 ลูกค้า LINE/);
    assert.match(text, /🖼️ \[ส่งรูปภาพ\]/);
  });

  it("labels a sticker turn", () => {
    const text = buildLineMirrorText({
      displayName: "A",
      messageType: LineMessageType.STICKER,
      text: null,
      at: FIXED_AT,
    });

    assert.match(text, /😊 \[ส่งสติกเกอร์\]/);
  });
});

describe("buildTelegramNotificationText", () => {
  it("fronts the header with the type emoji and adds a WARNING tag", () => {
    const text = buildTelegramNotificationText({
      type: NotificationType.LINE_OA_HANDOFF,
      severity: NotificationSeverity.WARNING,
      title: "ลูกค้า LINE OA รอแอดมินตอบ",
      body: "คุณสมชาย ใจดี: หม้อน้ำ Vios 2015 มีไหมครับ",
      link: "/admin/line",
    }, "https://www.sriwanparts.com");

    assert.match(text, /^🙋 ลูกค้า LINE OA รอแอดมินตอบ/);
    assert.match(text, /━━━/);
    assert.match(text, /🟡 ต้องตรวจสอบ/);
    assert.match(text, /🔗 ดูรายละเอียด: https:\/\/www\.sriwanparts\.com\/admin\/line/);
    // Old format lines are gone.
    assert.ok(!text.includes("[WARNING]"));
    assert.ok(!text.includes("ประเภท:"));
  });

  it("adds a red urgency tag for ERROR severity", () => {
    const text = buildTelegramNotificationText({
      type: NotificationType.SHOPEE_ORDER_FAILED,
      severity: NotificationSeverity.ERROR,
      title: "นำเข้าออเดอร์ Shopee ล้มเหลว",
      body: "ดึงข้อมูลจาก API ไม่สำเร็จ",
    });

    assert.match(text, /^❌ นำเข้าออเดอร์ Shopee ล้มเหลว/);
    assert.match(text, /🔴 ด่วน/);
  });

  it("omits the urgency tag for routine INFO notifications", () => {
    const text = buildTelegramNotificationText({
      type: NotificationType.LINE_NEW_CUSTOMER,
      severity: NotificationSeverity.INFO,
      title: "ลูกค้าใหม่จาก LINE",
      body: "คุณสมชาย ใจดี",
    });

    assert.match(text, /^🆕 ลูกค้าใหม่จาก LINE/);
    assert.ok(!text.includes("🟡"));
    assert.ok(!text.includes("🔴"));
  });
});
