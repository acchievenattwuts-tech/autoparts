import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { NotificationSeverity, NotificationType } from "@/lib/generated/prisma";

// LINE_DELIVERY_FAILED alert: bell + Telegram through createNotification(),
// throttled to one alert per error code per hour through the shared rate limit
// (the lib/error-reporting.ts mechanism), carrying no LINE user id.

type NotificationRow = { type: NotificationType; dedupeKey: string | null; createdAt: Date; readAt: Date | null; title: string; body: string | null };
type DispatchRow = { state: string; lastErrorCode: string | null; saleId: string; sale: { saleNo: string } };
type NotificationWhere = { dedupeKey?: string; readAt?: null };
type RateLimitOptions = { key: string; limit: number; windowMs: number };

const NOW = new Date("2026-09-30T05:00:00.000Z");
const HOUR_MS = 60 * 60 * 1000;

let dispatches = new Map<string, DispatchRow>();
let notificationRows: NotificationRow[] = [];
let telegramCalls: Array<{ type: NotificationType; severity: NotificationSeverity; title: string; body?: string | null; link?: string | null }> = [];
let dispatchLookupError: Error | null = null;
let activeAdminIds: string[] = [];
// In-memory stand-in for the ApiThrottle buckets behind checkRateLimit().
let clockMs = NOW.getTime();
let rateLimitBuckets = new Map<string, { count: number; windowEnd: number }>();
let rateLimitCalls: RateLimitOptions[] = [];
let rateLimitError: Error | null = null;

const matchesWhere = (row: NotificationRow, where: NotificationWhere): boolean => {
  if (typeof where.dedupeKey === "string" && row.dedupeKey !== where.dedupeKey) return false;
  if (where.readAt === null && row.readAt !== null) return false;
  return true;
};

let notifications: typeof import("@/lib/notifications");

before(async () => {
  mock.module("@/lib/db", {
    namedExports: {
      db: {
        user: { findMany: async () => activeAdminIds.map((id) => ({ id })) },
        saleLineDeliveryDispatch: {
          findUnique: async ({ where }: { where: { id: string } }) => {
            if (dispatchLookupError) throw dispatchLookupError;
            return dispatches.get(where.id) ?? null;
          },
        },
        notification: {
          findFirst: async ({ where }: { where: NotificationWhere }) =>
            notificationRows.find((row) => matchesWhere(row, where)) ? { id: "existing" } : null,
          findMany: async ({ where }: { where: NotificationWhere }) =>
            notificationRows.filter((row) => matchesWhere(row, where)).map(() => ({ userId: "admin-1" })),
          createMany: async ({ data }: { data: Array<Omit<NotificationRow, "createdAt" | "readAt">> }) => {
            for (const row of data) notificationRows.push({ ...row, createdAt: NOW, readAt: null });
            return { count: data.length };
          },
        },
      },
    },
  });
  mock.module("@/lib/rate-limit", {
    namedExports: {
      checkRateLimit: async (options: RateLimitOptions) => {
        rateLimitCalls.push(options);
        if (rateLimitError) throw rateLimitError;
        const bucket = rateLimitBuckets.get(options.key);
        const next = !bucket || bucket.windowEnd <= clockMs
          ? { count: 1, windowEnd: clockMs + options.windowMs }
          : { count: bucket.count + 1, windowEnd: bucket.windowEnd };
        rateLimitBuckets.set(options.key, next);
        return { ok: next.count <= options.limit, remaining: Math.max(0, options.limit - next.count), resetAt: next.windowEnd };
      },
    },
  });
  mock.module("@/lib/telegram", {
    namedExports: {
      shouldSendTelegramForNotification: () => true,
      sendTelegramNotification: async (payload: (typeof telegramCalls)[number]) => {
        telegramCalls.push(payload);
        return { sentCount: 1 };
      },
    },
  });
  notifications = await import("@/lib/notifications");
});

beforeEach(() => {
  dispatches = new Map([
    ["dispatch-1", { state: "FAILED", lastErrorCode: "LINE_NETWORK_ERROR", saleId: "sale-1", sale: { saleNo: "SL202609300001" } }],
    ["dispatch-2", { state: "FAILED", lastErrorCode: "LINE_NETWORK_ERROR", saleId: "sale-2", sale: { saleNo: "SL202609300002" } }],
    ["dispatch-3", { state: "FAILED", lastErrorCode: "INVALID_APP_URL", saleId: "sale-3", sale: { saleNo: "SL202609300003" } }],
    ["dispatch-sent", { state: "ACCEPTED", lastErrorCode: null, saleId: "sale-4", sale: { saleNo: "SL202609300004" } }],
  ]);
  notificationRows = [];
  telegramCalls = [];
  dispatchLookupError = null;
  activeAdminIds = ["admin-1"];
  clockMs = NOW.getTime();
  rateLimitBuckets = new Map();
  rateLimitCalls = [];
  rateLimitError = null;
});

test("a FAILED dispatch sends one bell row and one Telegram message with the bill number and Thai reason", async () => {
  assert.equal(await notifications.notifyLineDeliveryFailed("dispatch-1"), 1);
  assert.equal(notificationRows.length, 1);
  const [row] = notificationRows;
  assert.equal(row.type, NotificationType.LINE_DELIVERY_FAILED);
  assert.equal(row.dedupeKey, "line-delivery-failed:LINE_NETWORK_ERROR:dispatch-1");
  assert.ok(row.body?.includes("SL202609300001"));
  assert.ok(row.body?.includes("เชื่อมต่อ LINE ไม่ได้"));
  // Owner decision P7b: the alert ends by telling admins the card is never re-sent.
  assert.equal(row.body?.split("\n").at(-1), "ระบบจะไม่ส่งซ้ำ กรุณาแจ้งลูกค้าเองถ้าจำเป็น");
  assert.equal(telegramCalls.length, 1);
  assert.equal(telegramCalls[0].body?.split("\n").at(-1), "ระบบจะไม่ส่งซ้ำ กรุณาแจ้งลูกค้าเองถ้าจำเป็น");
  assert.equal(telegramCalls[0].type, NotificationType.LINE_DELIVERY_FAILED);
  assert.equal(telegramCalls[0].severity, NotificationSeverity.WARNING);
  assert.equal(telegramCalls[0].link, "/admin/sales/sale-1");
  assert.deepEqual(rateLimitCalls, [{ key: "line-delivery-failed-alert:LINE_NETWORK_ERROR", limit: 1, windowMs: HOUR_MS }]);
});

test("a second failure with the same code inside one hour is throttled; another code still alerts", async () => {
  await notifications.notifyLineDeliveryFailed("dispatch-1");
  clockMs = NOW.getTime() + HOUR_MS - 1;
  assert.equal(await notifications.notifyLineDeliveryFailed("dispatch-2"), 0);
  assert.equal(await notifications.notifyLineDeliveryFailed("dispatch-3"), 1);
  assert.deepEqual(telegramCalls.map((call) => call.body?.split("\n")[0]), ["บิล SL202609300001", "บิล SL202609300003"]);
});

test("the same code alerts again once the hour has passed, even while the previous alert is unread", async () => {
  await notifications.notifyLineDeliveryFailed("dispatch-1");
  clockMs = NOW.getTime() + HOUR_MS + 1;
  assert.equal(await notifications.notifyLineDeliveryFailed("dispatch-2"), 1);
  assert.equal(telegramCalls.length, 2);
});

test("with no active ADMIN the throttle still holds: Telegram alerts once per code per hour", async () => {
  activeAdminIds = [];
  await notifications.notifyLineDeliveryFailed("dispatch-1");
  await notifications.notifyLineDeliveryFailed("dispatch-2");
  assert.equal(notificationRows.length, 0, "no bell recipient");
  assert.deepEqual(telegramCalls.map((call) => call.body?.split("\n")[0]), ["บิล SL202609300001"]);
  clockMs = NOW.getTime() + HOUR_MS + 1;
  await notifications.notifyLineDeliveryFailed("dispatch-2");
  assert.equal(telegramCalls.length, 2);
});

test("a throttle-store failure still sends the alert (fails open like error-reporting)", async () => {
  rateLimitError = Object.assign(new Error("ApiThrottle unavailable"), { code: "P1001" });
  assert.equal(await notifications.notifyLineDeliveryFailed("dispatch-1"), 1);
  assert.equal(telegramCalls.length, 1);
});

test("a missing or non-FAILED dispatch (for example a rolled-back status change) sends nothing", async () => {
  assert.equal(await notifications.notifyLineDeliveryFailed("dispatch-sent"), 0);
  assert.equal(await notifications.notifyLineDeliveryFailed("rolled-back"), 0);
  assert.deepEqual([notificationRows, telegramCalls], [[], []]);
  assert.deepEqual(rateLimitCalls, [], "never consumes the code's hourly slot");
});

test("the alert never carries the recipient LINE user id or the customer name", async () => {
  await notifications.notifyLineDeliveryFailed("dispatch-3");
  const sent = JSON.stringify([notificationRows, telegramCalls]);
  assert.ok(!sent.includes("recipientLineUserId"));
  assert.ok(!/U[0-9a-f]{32}/.test(sent));
});

test("safeNotifyLineDeliveryFailed swallows errors and logs only the code and dispatch id", async () => {
  dispatchLookupError = Object.assign(new Error("connection to customer U0123456789abcdef0123456789abcdef failed"), { code: "P1001" });
  const warnings: unknown[][] = [];
  const warnMock = mock.method(console, "warn", (...args: unknown[]) => { warnings.push(args); });
  try {
    await notifications.safeNotifyLineDeliveryFailed("dispatch-1");
  } finally { warnMock.mock.restore(); }
  assert.deepEqual(warnings, [["[line-delivery] failure alert skipped", { code: "P1001", dispatchId: "dispatch-1" }]]);
});

test("status badges and reasons read the dispatch outcome for admins", async () => {
  const { buildLineDeliveryBadges, getLineDeliveryReasonLabel } = await import("@/lib/line-delivery-status");
  assert.deepEqual(buildLineDeliveryBadges([
    { eventStatus: "DELIVERED", state: "FAILED", lastErrorCode: "LINE_HTTP_400" },
    { eventStatus: "OUT_FOR_DELIVERY", state: "SKIPPED", lastErrorCode: "SALE_TOO_OLD" },
  ]), [
    { eventLabel: "แจ้งออกส่ง", statusLabel: "ข้าม (บิลเก่าเกิน 30 วัน)", tone: "muted" },
    { eventLabel: "แจ้งส่งสำเร็จ", statusLabel: "ส่งไม่สำเร็จ (LINE ตอบกลับข้อผิดพลาด (HTTP 400))", tone: "danger" },
  ]);
  assert.deepEqual(buildLineDeliveryBadges([{ eventStatus: "OUT_FOR_DELIVERY", state: "ACCEPTED", lastErrorCode: null }]), [
    { eventLabel: "แจ้งออกส่ง", statusLabel: "ส่งแล้ว", tone: "success" },
  ]);
  assert.equal(buildLineDeliveryBadges([{ eventStatus: "DELIVERED", state: "PENDING", lastErrorCode: "LINE_HTTP_503" }])[0].statusLabel, "กำลังส่ง");
  assert.equal(getLineDeliveryReasonLabel("SOMETHING_NEW"), "รหัส SOMETHING_NEW");
  assert.deepEqual(buildLineDeliveryBadges([{ eventStatus: "DELIVERED", state: "FAILED", lastErrorCode: "LEASE_EXPIRED" }]), [
    { eventLabel: "แจ้งส่งสำเร็จ", statusLabel: "ส่งไม่สำเร็จ (ระบบหยุดระหว่างส่ง ไม่ทราบผลการส่ง)", tone: "danger" },
  ]);
});
