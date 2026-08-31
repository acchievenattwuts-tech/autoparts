/**
 * สูตรคำนวณราคาขายอัตโนมัติจาก "ราคาขายส่ง" (Product.salePrice)
 *
 * ใช้ที่ฟอร์มสินค้าหลังบ้านเท่านั้น — ระบบเติมราคาให้อัตโนมัติเมื่อผู้ใช้กรอกราคาขายส่ง
 * แต่ผู้ใช้ยังพิมพ์แก้ทับได้เสมอ (ค่าที่บันทึกจริงคือค่าในช่องกรอก ไม่ใช่ค่าที่คำนวณ)
 *
 * ลำดับราคา: ขายส่ง < สมาชิก < ขายปลีก
 *
 * ราคาขายปลีก ใช้สูตรเดียวกับ Lazada: (ขายส่ง + 60) ÷ 0.7218 ปัดขึ้นลงท้าย 5/0
 * ราคาสมาชิก  คงสูตรเดิม: (ขายส่ง x 1.70 ปัดขึ้นลงท้าย 0) - 30% ปัดขึ้นลงท้าย 0
 *              — ไม่ผูกกับราคาขายปลีกใหม่ เพื่อให้ระดับราคาสมาชิกเท่าเดิม
 */

/** ฐานคำนวณราคาสมาชิก (สูตรราคาปลีกเดิม = ราคาขายส่ง + 70%) */
const MEMBER_BASE_MARKUP = 1.7;
/** ราคาสมาชิก = ฐานราคาสมาชิก - 30% */
const MEMBER_DISCOUNT_FROM_RETAIL = 0.7;
/** ปัดขึ้นให้ลงท้ายด้วย 0 เสมอ และไม่มีทศนิยม */
const ROUND_UP_TO = 10;

/** ปัดราคาขึ้นให้ลงท้ายด้วย 0 (เช่น 209.1 → 210) */
export function roundUpToTen(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / ROUND_UP_TO) * ROUND_UP_TO;
}

/**
 * คำนวณราคาขายปลีก + ราคาสมาชิก จากราคาขายส่ง
 * ราคาขายส่ง ≤ 0 → คืน 0 ทั้งคู่ (ระบบจะแสดง "สอบถามราคา")
 */
export function derivePricesFromWholesale(wholesalePrice: number): {
  retailPrice: number;
  memberPrice: number;
} {
  if (!Number.isFinite(wholesalePrice) || wholesalePrice <= 0) {
    return { retailPrice: 0, memberPrice: 0 };
  }

  return {
    retailPrice: deriveRetailPriceFromWholesale(wholesalePrice),
    memberPrice: deriveMemberPriceFromRetail(roundUpToTen(wholesalePrice * MEMBER_BASE_MARKUP)),
  };
}

/**
 * ราคาสมาชิก = ฐานราคา - 30% (ปัดขึ้นให้ลงท้ายด้วย 0)
 * ฐานราคา ≤ 0 → คืน 0 (คำนวณไม่ได้)
 */
export function deriveMemberPriceFromRetail(basePrice: number): number {
  if (!Number.isFinite(basePrice) || basePrice <= 0) return 0;
  return roundUpToTen(basePrice * MEMBER_DISCOUNT_FROM_RETAIL);
}

/* ────────────────────────────────────────────────────────────────────────────
 * ราคา Marketplace (Shopee / Lazada) คิดจาก "ราคาขายส่ง"
 *
 *   Shopee = (ราคาขายส่ง + 60 + 1.07) ÷ 0.8288
 *   Lazada = (ราคาขายส่ง + 60)        ÷ 0.7218
 *
 * ทั้งสองช่องปัดขึ้นให้ลงท้ายด้วย 5 หรือ 0 แบบ "เพิ่มขึ้นเสมอ"
 * (182.19 → 185, 185 → 190, 180 → 185)
 * ────────────────────────────────────────────────────────────────────────────*/

/** ค่าส่งที่บวกเข้าไปในต้นทุนก่อนหักค่าธรรมเนียมแพลตฟอร์ม */
const MARKETPLACE_SHIPPING_COST = 60;
/** ค่าธรรมเนียมคงที่เพิ่มเติมของ Shopee (บาท) */
const SHOPEE_FIXED_FEE = 1.07;
/** สัดส่วนเงินที่ร้านได้รับจริงหลังหักค่าธรรมเนียม Shopee */
const SHOPEE_NET_RATIO = 0.8288;
/** สัดส่วนเงินที่ร้านได้รับจริงหลังหักค่าธรรมเนียม Lazada */
const LAZADA_NET_RATIO = 0.7218;
/** ขั้นการปัดราคา Marketplace */
const MARKETPLACE_ROUND_STEP = 5;

/**
 * ปัดราคาขึ้นให้ลงท้ายด้วย 5 หรือ 0 โดยเพิ่มขึ้นเสมอ
 * (เลขที่ลงท้าย 0/5 พอดี จะขยับขึ้นอีก 1 ขั้น เช่น 185 → 190)
 */
export function roundUpToNextFive(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value / MARKETPLACE_ROUND_STEP) * MARKETPLACE_ROUND_STEP + MARKETPLACE_ROUND_STEP;
}

/** ราคา Shopee = (ราคาขายส่ง + 60 + 1.07) ÷ 0.8288 ปัดขึ้นลงท้าย 5/0 */
export function deriveShopeePriceFromWholesale(wholesalePrice: number): number {
  if (!Number.isFinite(wholesalePrice) || wholesalePrice <= 0) return 0;
  return roundUpToNextFive((wholesalePrice + MARKETPLACE_SHIPPING_COST + SHOPEE_FIXED_FEE) / SHOPEE_NET_RATIO);
}

/** ราคา Lazada = (ราคาขายส่ง + 60) ÷ 0.7218 ปัดขึ้นลงท้าย 5/0 */
export function deriveLazadaPriceFromWholesale(wholesalePrice: number): number {
  if (!Number.isFinite(wholesalePrice) || wholesalePrice <= 0) return 0;
  return roundUpToNextFive((wholesalePrice + MARKETPLACE_SHIPPING_COST) / LAZADA_NET_RATIO);
}

/** ราคาขายปลีก = ใช้สูตรเดียวกับ Lazada: (ขายส่ง + 60) ÷ 0.7218 ปัดขึ้นลงท้าย 5/0 */
export function deriveRetailPriceFromWholesale(wholesalePrice: number): number {
  return deriveLazadaPriceFromWholesale(wholesalePrice);
}

/** คำนวณราคา Shopee + Lazada พร้อมกันจากราคาขายส่ง */
export function deriveMarketplacePricesFromWholesale(wholesalePrice: number): {
  shopeePrice: number;
  lazadaPrice: number;
} {
  return {
    shopeePrice: deriveShopeePriceFromWholesale(wholesalePrice),
    lazadaPrice: deriveLazadaPriceFromWholesale(wholesalePrice),
  };
}
