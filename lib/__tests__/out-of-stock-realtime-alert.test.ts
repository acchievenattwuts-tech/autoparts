import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

import { NotificationType } from "@/lib/generated/prisma";

// Real-time out-of-stock alert: the body names the sale's document number and
// customer, the customer name follows the sales pages' display rule, and the
// dispatcher reads the sale only when a product is actually out of stock.

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

// 2026-09-18T07:05:00Z === 14:05 in Asia/Bangkok (UTC+7).
const FIXED_AT = new Date("2026-09-18T07:05:00.000Z");

type SaleRow = { saleNo: string; channel: string; customerName: string | null; customer: { name: string } | null };
type OutProduct = { id: string; code: string; name: string; category: { name: string } };

let outProducts: OutProduct[] = [];
let saleRow: SaleRow | null = null;
const saleLookups: unknown[] = [];
const telegramBodies: Array<string | null | undefined> = [];

before(async () => {
  if (moduleMocksUnavailable) return;
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        user: { findMany: async () => [{ id: "admin-1" }] },
        notification: {
          findFirst: async () => null,
          findMany: async () => [],
          createMany: async (args: { data: unknown[] }) => ({ count: args.data.length }),
        },
        product: { findMany: async () => outProducts },
        sale: {
          findUnique: async (args: unknown) => {
            saleLookups.push(args);
            return saleRow;
          },
        },
      },
    },
  });
  await mock.module("@/lib/telegram", {
    namedExports: {
      shouldSendTelegramForNotification: () => true,
      sendTelegramNotification: async (input: { type: NotificationType; body?: string | null }) => {
        if (input.type === NotificationType.STOCK_OUT_REALTIME) telegramBodies.push(input.body);
        return { sentCount: 1 };
      },
    },
  });
});

beforeEach(() => {
  outProducts = [{ id: "prod-1", code: "P0001", name: "ไส้กรองน้ำมันเครื่อง", category: { name: "ไส้กรอง" } }];
  saleRow = { saleNo: "SA2609180001", channel: "STORE", customerName: null, customer: { name: "อู่ช่างเอ" } };
  saleLookups.length = 0;
  telegramBodies.length = 0;
});

test("the alert body names the document number and the customer", { skip: moduleMocksUnavailable }, async () => {
  const { buildOutOfStockRealtimeBody } = await import("@/lib/notifications");

  const body = buildOutOfStockRealtimeBody(
    { id: "prod-1", code: "P0001", name: "ไส้กรองน้ำมันเครื่อง", categoryName: "ไส้กรอง" },
    { docNo: "SA2609180001", customerName: "อู่ช่างเอ" },
    FIXED_AT,
  );

  assert.equal(
    body,
    [
      "📦 ไส้กรองน้ำมันเครื่อง (P0001)",
      "หมวด: ไส้กรอง",
      "คงเหลือ: 0 ชิ้น",
      "เลขที่เอกสาร: SA2609180001",
      "ลูกค้า: อู่ช่างเอ",
      "⏰ 18/09/2026 14:05 น. · จากการขาย",
    ].join("\n"),
  );
});

test("the customer name follows the sales pages' display rule", { skip: moduleMocksUnavailable }, async () => {
  const { resolveSaleCustomerDisplayName } = await import("@/lib/notifications");

  // Store sales prefer the linked customer record, then the typed name.
  assert.equal(resolveSaleCustomerDisplayName({ channel: "STORE", customerName: "พิมพ์เอง", customer: { name: "อู่ช่างเอ" } }), "อู่ช่างเอ");
  assert.equal(resolveSaleCustomerDisplayName({ channel: "STORE", customerName: "ลูกค้าหน้าร้าน", customer: null }), "ลูกค้าหน้าร้าน");
  // Marketplace sales keep the buyer name typed on the sale.
  assert.equal(resolveSaleCustomerDisplayName({ channel: "SHOPEE", customerName: "buyer_01", customer: { name: "ลูกค้า Shopee" } }), "buyer_01");
  assert.equal(resolveSaleCustomerDisplayName({ channel: "LAZADA", customerName: null, customer: { name: "ลูกค้า Lazada" } }), "ลูกค้า Lazada");
  // No name at all falls back to a dash, as on the sales pages.
  assert.equal(resolveSaleCustomerDisplayName({ channel: "STORE", customerName: "  ", customer: null }), "-");
});

test("the dispatcher sends the sale's document number and customer to Telegram", { skip: moduleMocksUnavailable }, async () => {
  const { dispatchOutOfStockAlerts } = await import("@/lib/notifications");

  await dispatchOutOfStockAlerts(["prod-1", "prod-1"], "sale-1", FIXED_AT);

  assert.deepEqual(saleLookups, [
    {
      where: { id: "sale-1" },
      select: { saleNo: true, channel: true, customerName: true, customer: { select: { name: true } } },
    },
  ]);
  assert.equal(telegramBodies.length, 1);
  assert.match(telegramBodies[0] ?? "", /เลขที่เอกสาร: SA2609180001\nลูกค้า: อู่ช่างเอ\n/);
});

test("the dispatcher skips the sale read when nothing is out of stock", { skip: moduleMocksUnavailable }, async () => {
  outProducts = [];
  const { dispatchOutOfStockAlerts } = await import("@/lib/notifications");

  await dispatchOutOfStockAlerts(["prod-1"], "sale-1", FIXED_AT);

  assert.deepEqual(saleLookups, []);
  assert.deepEqual(telegramBodies, []);
});

test("a missing sale still sends the alert, with dashes for the sale fields", { skip: moduleMocksUnavailable }, async () => {
  saleRow = null;
  const { dispatchOutOfStockAlerts } = await import("@/lib/notifications");

  await dispatchOutOfStockAlerts(["prod-1"], "sale-gone", FIXED_AT);

  assert.equal(telegramBodies.length, 1);
  assert.match(telegramBodies[0] ?? "", /เลขที่เอกสาร: -\nลูกค้า: -\n/);
});
