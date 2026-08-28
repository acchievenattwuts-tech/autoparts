const COMPARE_AT_MULTIPLIER = 1.3;

/**
 * ซ่อนราคาขายบนหน้าเว็บสาธารณะ (storefront) — แสดง "สอบถามราคา" แทน
 * ตั้งเป็น false เพื่อเปิดแสดงราคากลับมาทั้งเว็บจากจุดเดียว
 */
export const HIDE_STOREFRONT_PRICE = true;

/** ข้อความแทนราคาเมื่อซ่อนราคาหน้าบ้าน */
export const STOREFRONT_PRICE_INQUIRY_LABEL = "สอบถามราคา";

/**
 * ข้อความชวนลูกค้าแอดไลน์เพื่อรับราคาพิเศษ — คุมจากจุดเดียวทั้งเว็บ
 *
 * ตั้งใจไม่ระบุตัวเลขส่วนลดและไม่ระบุกลุ่มลูกค้า เพราะราคาพิเศษจริงขึ้นกับ
 * CustomerType/PriceList ที่แอดมินกำหนดให้ลูกค้าแต่ละราย
 * ข้อความจึงเป็น "คำเชิญ" ไม่ใช่ "คำสัญญา" ว่าทุกคนได้ส่วนลดเท่ากัน
 */
export const STOREFRONT_SPECIAL_PRICE_TITLE = "มีราคาพิเศษ";
export const STOREFRONT_SPECIAL_PRICE_HINT = "แอดไลน์แจ้งรหัสสินค้า";
/** ป้ายปุ่ม LINE บนการ์ดสินค้า (พื้นที่แคบ) */
export const STOREFRONT_SPECIAL_PRICE_CTA_COMPACT = "ขอราคาพิเศษ";
/** ป้ายปุ่ม LINE หลักในหน้ารายละเอียดสินค้า */
export const STOREFRONT_SPECIAL_PRICE_CTA = "ขอราคาพิเศษผ่าน LINE";

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
