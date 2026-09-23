export type PromotionStatus = "DRAFT" | "PUBLISHED" | "CANCELLED";

/** Thai label + AdminStatusBadge tone for each promotion status (was the raw enum). */
export const PROMOTION_STATUS_PRESENTATION: Record<PromotionStatus, { label: string; tone: "pending" | "success" | "danger" }> = {
  DRAFT: { label: "ร่าง", tone: "pending" },
  PUBLISHED: { label: "เผยแพร่แล้ว", tone: "success" },
  CANCELLED: { label: "ยกเลิก", tone: "danger" },
};

/**
 * Cancelling cannot be undone (there is no reopen) and a published promotion's
 * price leaves every new bill immediately, so the row button asks first — the
 * same confirm-before-cancel pattern as the master pages.
 */
export const getPromotionCancelConfirmMessage = (name: string, status: PromotionStatus): string =>
  status === "PUBLISHED"
    ? `ยืนยันยกเลิกโปรโมชั่น "${name}" หรือไม่?\nราคาโปรโมชั่นจะหยุดใช้ในบิลขายทันที และย้อนกลับไม่ได้`
    : `ยืนยันยกเลิก Draft โปรโมชั่น "${name}" หรือไม่?\nยกเลิกแล้วย้อนกลับไม่ได้`;

/**
 * The product and price-list pickers are SearchableSelects, which have no native
 * `required`, so the empty-selection check the browser used to do happens here —
 * in Thai — before the Server Action is called.
 */
export const getPromotionDraftSelectionError = (
  priceListId: string,
  items: Array<{ productId: string }>,
): string | null => {
  if (!priceListId) return "กรุณาเลือกระดับราคา";
  if (items.some((item) => !item.productId)) return "กรุณาเลือกสินค้าให้ครบทุกแถว";
  return null;
};
