"use server";

import {
  fetchPaymentSlipGalleryPage,
  type PaymentSlipGalleryFilters,
  type PaymentSlipGalleryPage,
} from "@/lib/line-payment-slip-gallery";
import { requirePermission } from "@/lib/require-auth";

/**
 * Loads the next page of gallery slips for infinite scroll. Re-verifies the
 * view permission on every call (never trust the client) and is view-only —
 * it performs no business mutation.
 */
export async function loadMorePaymentSlipGalleryAction(
  filters: PaymentSlipGalleryFilters,
  skip: number,
): Promise<PaymentSlipGalleryPage> {
  await requirePermission("line_payment_slips.view");
  try {
    return await fetchPaymentSlipGalleryPage(filters, skip);
  } catch {
    // Degrade gracefully — the grid simply stops loading more.
    return { items: [], hasMore: false, nextSkip: skip };
  }
}
