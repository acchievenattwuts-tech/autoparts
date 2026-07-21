import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { NotificationSeverity, NotificationType } from "@/lib/generated/prisma";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

test(
  "handoff keeps one unread bell row but still sends each new LINE and Messenger occurrence to Telegram",
  { skip: moduleMocksUnavailable },
  async () => {
    const telegramCalls: Array<{ type: NotificationType; body?: string | null }> = [];
    let adminIds = [{ id: "admin-1" }];
    let telegramFailure: Error | null = null;
    await mock.module("@/lib/db", {
      namedExports: {
        db: {
          user: { findMany: async () => adminIds },
          notification: {
            findFirst: async () => ({ id: "existing-unread" }),
            findMany: async () => {
              throw new Error("deduped handoff must return before a second lookup");
            },
            createMany: async () => {
              throw new Error("deduped handoff must not create another bell row");
            },
          },
        },
      },
    });
    await mock.module("@/lib/telegram", {
      namedExports: {
        shouldSendTelegramForNotification: () => true,
        sendTelegramNotification: async (input: { type: NotificationType; body?: string | null }) => {
          if (telegramFailure) throw telegramFailure;
          telegramCalls.push(input);
          return { sentCount: 1 };
        },
      },
    });

    const { createNotification, notifyLineOaNeedsAdmin, notifyMessengerNeedsAdmin } =
      await import("@/lib/notifications");

    assert.equal(
      await createNotification({
        type: NotificationType.LINE_OA_HANDOFF,
        severity: NotificationSeverity.WARNING,
        title: "regular dedupe",
        dedupeKey: "regular-key",
      }),
      0,
    );
    assert.equal(telegramCalls.length, 0, "existing notification behavior stays unchanged unless explicitly opted in");

    assert.equal(
      await notifyLineOaNeedsAdmin({
        conversationId: "line-conversation",
        displayName: "sunantha",
        text: "วาล์ว/ไดรเออร์มิตซูไททันปี13",
        messageType: "TEXT",
      }),
      0,
    );
    assert.equal(
      await notifyMessengerNeedsAdmin({
        conversationId: "messenger-conversation",
        displayName: "customer",
        text: "วาล์ว/ไดรเออร์มิตซูไททันปี13",
        messageType: "TEXT",
      }),
      0,
    );

    assert.deepEqual(
      telegramCalls.map((call) => call.type),
      [NotificationType.LINE_OA_HANDOFF, NotificationType.MESSENGER_HANDOFF],
    );
    assert.match(telegramCalls[0]?.body ?? "", /ไดรเออร์/);

    adminIds = [];
    assert.equal(
      await createNotification({
        type: NotificationType.LINE_OA_HANDOFF,
        severity: NotificationSeverity.WARNING,
        title: "no active bell admin",
      }),
      0,
    );
    assert.equal(telegramCalls.length, 3, "Telegram still alerts when no active ADMIN bell recipient exists");

    adminIds = [{ id: "admin-1" }];
    telegramFailure = new Error("Telegram unavailable after retries");
    await assert.rejects(
      notifyLineOaNeedsAdmin({ conversationId: "line-failure", text: "ทดสอบส่งไม่สำเร็จ" }),
      /Telegram unavailable after retries/,
    );

    adminIds = [];
    assert.equal(
      await createNotification({
        type: NotificationType.SHOPEE_ORDER_FAILED,
        severity: NotificationSeverity.ERROR,
        title: "business flow remains non-fatal",
      }),
      0,
      "non-handoff notification callers remain isolated from Telegram failures",
    );
  },
);
