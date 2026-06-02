import { ShippingMethod, ShippingStatus } from "@/lib/generated/prisma";

type JsonObject = Record<string, unknown>;

const TRACKING_KEYS = new Set([
  "tracking_number",
  "tracking_no",
  "trackingNo",
  "tracking",
  "awb",
  "airway_bill",
  "waybill_no",
]);

const CARRIER_KEYS = new Set([
  "shipping_carrier",
  "logistics_channel_name",
  "logistics_channel",
  "logistics_service",
  "carrier",
  "courier",
]);

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function findFirstByKeys(value: unknown, keys: Set<string>): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findFirstByKeys(item, keys);
      if (match) return match;
    }
    return null;
  }

  if (!isObject(value)) return null;

  for (const [key, child] of Object.entries(value)) {
    if (keys.has(key)) {
      const text = cleanText(child);
      if (text) return text;
    }
  }

  for (const child of Object.values(value)) {
    const match = findFirstByKeys(child, keys);
    if (match) return match;
  }

  return null;
}

export function extractShopeeTrackingNo(rawPayload: unknown): string | null {
  return findFirstByKeys(rawPayload, TRACKING_KEYS);
}

export function extractShopeeCarrier(rawPayload: unknown): string | null {
  return findFirstByKeys(rawPayload, CARRIER_KEYS);
}

export function mapShopeeCarrierToShippingMethod(carrier: string | null | undefined): ShippingMethod {
  const text = carrier?.toLowerCase() ?? "";
  if (!text) return ShippingMethod.NONE;
  if (text.includes("kerry") || text.includes("kex")) return ShippingMethod.KERRY;
  if (text.includes("flash")) return ShippingMethod.FLASH;
  if (text.includes("j&t") || text.includes("jnt") || text.includes("jt express")) return ShippingMethod.JT;
  if (text.includes("thailand post") || text.includes("thaipost") || text.includes("ems")) {
    return ShippingMethod.THAILAND_POST;
  }
  return ShippingMethod.OTHER;
}

export function mapShopeeOrderStatusToShippingStatus(status: string | null | undefined, trackingNo?: string | null): ShippingStatus {
  const text = status?.toUpperCase() ?? "";
  if (["COMPLETED", "DELIVERED"].includes(text)) return ShippingStatus.DELIVERED;
  if (["SHIPPED", "TO_CONFIRM_RECEIVE"].includes(text)) return ShippingStatus.OUT_FOR_DELIVERY;
  if (trackingNo) return ShippingStatus.OUT_FOR_DELIVERY;
  return ShippingStatus.PENDING;
}

