/** Mirrors the bounds updatePriceList validates on the server. */
export const PRICE_LIST_NAME_MAX_LENGTH = 100;
export const PRICE_LIST_SORT_ORDER_MAX = 9999;

export type PriceListEditInput = { name: string; sortOrder: number };

/**
 * Client-side check for the inline price-list editor, so a typo in "ลำดับ" is
 * reported in Thai before the request instead of surfacing Zod's English
 * "expected number, received NaN". An empty order is rejected rather than being
 * saved as 0 (what Number("") used to produce).
 */
export const parsePriceListEditInput = (
  nameText: string,
  sortOrderText: string,
): { value: PriceListEditInput } | { error: string } => {
  const name = nameText.trim();
  if (!name) return { error: "กรุณากรอกชื่อระดับราคา" };
  if (name.length > PRICE_LIST_NAME_MAX_LENGTH) return { error: `ชื่อระดับราคายาวได้ไม่เกิน ${PRICE_LIST_NAME_MAX_LENGTH} ตัวอักษร` };
  const trimmedOrder = sortOrderText.trim();
  const sortOrder = Number(trimmedOrder);
  if (!trimmedOrder || !Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > PRICE_LIST_SORT_ORDER_MAX) {
    return { error: `ลำดับต้องเป็นจำนวนเต็ม 0–${PRICE_LIST_SORT_ORDER_MAX}` };
  }
  return { value: { name, sortOrder } };
};
