const COMPARE_AT_MULTIPLIER = 1.3;

/**
 * ซ่อนราคาขายบนหน้าเว็บสาธารณะ (storefront) — แสดง "สอบถามราคา" แทน
 * ตั้งเป็น false เพื่อเปิดแสดงราคากลับมาทั้งเว็บจากจุดเดียว
 */
export const HIDE_STOREFRONT_PRICE = true;

/** ข้อความแทนราคาเมื่อซ่อนราคาหน้าบ้าน */
export const STOREFRONT_PRICE_INQUIRY_LABEL = "สอบถามราคา";

/** ตัวคูณราคาขีดฆ่าหน้าเว็บ = retailPrice + 40% */
const RETAIL_STRIKE_MULTIPLIER = 1.4;
/** ปัดราคาขีดฆ่าขึ้นให้ลงท้ายด้วย 0 */
const RETAIL_STRIKE_ROUND_TO = 10;

/**
 * ราคาแสดงหน้าเว็บสาธารณะจาก Product.retailPrice (ไม่บวกเพิ่ม)
 * พร้อมราคาขีดฆ่า = retailPrice × 1.4 ปัดขึ้นลงท้าย 0
 * คืน null เมื่อ retailPrice ยังไม่ตั้ง (≤ 0) → หน้าเว็บแสดง "สอบถามราคา" แทน
 */
export function getStorefrontRetailPricing(
  retailPrice: number | { toString(): string } | null | undefined,
): { retailPrice: number; compareAtPrice: number } | null {
  const retail = Number(retailPrice ?? 0);

  if (!Number.isFinite(retail) || retail <= 0) {
    return null;
  }

  const compareAtPrice =
    Math.ceil((retail * RETAIL_STRIKE_MULTIPLIER) / RETAIL_STRIKE_ROUND_TO) *
    RETAIL_STRIKE_ROUND_TO;

  return { retailPrice: retail, compareAtPrice };
}

export function getStorefrontDisplayPrices(price: number | { toString(): string }) {
  const salePrice = Number(price);
  const compareAtPrice = Math.ceil(salePrice * COMPARE_AT_MULTIPLIER);

  return {
    salePrice,
    compareAtPrice,
  };
}
