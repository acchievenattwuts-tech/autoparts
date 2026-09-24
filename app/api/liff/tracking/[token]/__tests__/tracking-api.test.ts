import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// Public tracking API (token-only): links expire (7 days without an explicit
// expiry, immediately when the shipment is CANCELLED) and the phone returned is
// the shop's central phone from site config — never the driver's own number.

const TOKEN = "3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c";
const DAY_MS = 24 * 60 * 60 * 1000;

type SaleRow = {
  id: string;
  saleNo: string;
  shippingStatus: string;
  shippingAddress: string | null;
  trackingExpiry: Date | null;
  updatedAt: Date;
  deliveryTracking: null;
  deliveryStaff: { name: string } | null;
};

let sale: SaleRow;
let shopPhone = "02-123-4567";
let staffSelect: unknown = null;

before(async () => {
  await mock.module("@/lib/rate-limit", {
    namedExports: {
      checkRateLimit: async () => ({ ok: true, remaining: 9, resetAt: Date.now() + 60_000 }),
    },
  });
  await mock.module("@/lib/site-config", {
    namedExports: { getPublicSiteConfig: async () => ({ shopPhone }) },
  });
  await mock.module("@/lib/db", {
    namedExports: {
      db: {
        sale: {
          findUnique: async (args: { select: { deliveryStaff: unknown } }) => {
            staffSelect = args.select.deliveryStaff;
            return sale;
          },
        },
      },
    },
  });
});

beforeEach(() => {
  shopPhone = "02-123-4567";
  staffSelect = null;
  sale = {
    id: "s1",
    saleNo: "SA2609240001",
    shippingStatus: "OUT_FOR_DELIVERY",
    shippingAddress: "123 ถนนทดสอบ",
    trackingExpiry: null,
    updatedAt: new Date(Date.now() - DAY_MS),
    deliveryTracking: null,
    deliveryStaff: { name: "สมชาย" },
  };
});

const callApi = async () => {
  const { GET } = await import("../route");
  const response = await GET(new Request(`https://shop.test/api/liff/tracking/${TOKEN}`), {
    params: Promise.resolve({ token: TOKEN }),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

test("an active link returns the driver name and the shop's central phone, not the driver's", async () => {
  const result = await callApi();

  assert.equal(result.status, 200);
  assert.equal(result.body.driverName, "สมชาย");
  assert.equal(result.body.contactPhone, "02-123-4567");
  assert.equal("driverPhone" in result.body, false);
  // The driver's phone is not even read from the database.
  assert.deepEqual(staffSelect, { select: { name: true } });
});

test("with no shop phone configured the phone is hidden (null), never the driver's", async () => {
  shopPhone = "";
  const result = await callApi();

  assert.equal(result.status, 200);
  assert.equal(result.body.contactPhone, null);
});

test("a link with no explicit expiry expires 7 days after the sale's last update", async () => {
  sale.updatedAt = new Date(Date.now() - 8 * DAY_MS);
  const result = await callApi();

  assert.equal(result.status, 410);
});

test("a CANCELLED shipment's link is expired immediately", async () => {
  sale.shippingStatus = "CANCELLED";
  sale.updatedAt = new Date();
  const result = await callApi();

  assert.equal(result.status, 410);
});
