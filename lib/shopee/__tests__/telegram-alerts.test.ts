import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotificationSeverity, NotificationType } from "@/lib/generated/prisma";
import {
  buildTelegramNotificationText,
  shouldSendTelegramForNotification,
} from "@/lib/telegram";

describe("Shopee Telegram alerts", () => {
  it("only sends Telegram alerts for Shopee notifications", () => {
    assert.equal(shouldSendTelegramForNotification(NotificationType.SHOPEE_ORDER_IMPORTED), true);
    assert.equal(shouldSendTelegramForNotification(NotificationType.SHOPEE_STOCK_SYNC_FAILED), true);
    assert.equal(shouldSendTelegramForNotification(NotificationType.GENERAL), false);
  });

  it("formats Telegram text with absolute app links when a base URL is configured", () => {
    const text = buildTelegramNotificationText(
      {
        type: NotificationType.SHOPEE_RETURN_REVIEW,
        severity: NotificationSeverity.WARNING,
        title: "Shopee return ต้อง review",
        body: "มี 2 รายการ",
        link: "/admin/marketplace/shopee/orders?status=CANCELLED_REVIEW",
      },
      "https://www.sriwanparts.com/",
    );

    assert.match(text, /^\[WARNING\] Shopee return ต้อง review/);
    assert.match(text, /type: SHOPEE_RETURN_REVIEW/);
    assert.match(text, /link: https:\/\/www\.sriwanparts\.com\/admin\/marketplace\/shopee\/orders\?status=CANCELLED_REVIEW/);
  });
});

