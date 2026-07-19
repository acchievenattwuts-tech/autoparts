/**
 * สูตรคำนวณราคาขายอัตโนมัติจาก "ราคาขายส่ง" (Product.salePrice)
 *
 * ใช้ที่ฟอร์มสินค้าหลังบ้านเท่านั้น — ระบบเติมราคาให้อัตโนมัติเมื่อผู้ใช้กรอกราคาขายส่ง
 * แต่ผู้ใช้ยังพิมพ์แก้ทับได้เสมอ (ค่าที่บันทึกจริงคือค่าในช่องกรอก ไม่ใช่ค่าที่คำนวณ)
 *
 * ลำดับราคา: ขายส่ง < สมาชิก < ขายปลีก
 */

/** ราคาขายปลีก = ราคาขายส่ง + 70% */
const RETAIL_MARKUP = 1.7;
/** ราคาสมาชิก = ราคาขายส่ง + 40% */
const MEMBER_MARKUP = 1.4;
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
    retailPrice: roundUpToTen(wholesalePrice * RETAIL_MARKUP),
    memberPrice: roundUpToTen(wholesalePrice * MEMBER_MARKUP),
  };
}
