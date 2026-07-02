const COMPARE_AT_MULTIPLIER = 1.3;

/**
 * ซ่อนราคาขายบนหน้าเว็บสาธารณะ (storefront) — แสดง "สอบถามราคา" แทน
 * ตั้งเป็น false เพื่อเปิดแสดงราคากลับมาทั้งเว็บจากจุดเดียว
 */
export const HIDE_STOREFRONT_PRICE = true;

/** ข้อความแทนราคาเมื่อซ่อนราคาหน้าบ้าน */
export const STOREFRONT_PRICE_INQUIRY_LABEL = "สอบถามราคา";

export function getStorefrontDisplayPrices(price: number | { toString(): string }) {
  const salePrice = Number(price);
  const compareAtPrice = Math.ceil(salePrice * COMPARE_AT_MULTIPLIER);

  return {
    salePrice,
    compareAtPrice,
  };
}
