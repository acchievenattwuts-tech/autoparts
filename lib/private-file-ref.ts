import { toPublicStorageCdnPath } from "@/lib/product-image-url";

/**
 * Stored references for PII evidence files (expense attachments, delivery-proof
 * signatures/photos, WHT certificate attachments). Client-safe: no `@vercel/blob` import.
 *
 * Two shapes live in the same DB columns:
 *  - legacy rows hold a full public URL (`https://…public.blob.vercel-storage.com/…`)
 *    from before these files moved to the private store — rendered as before;
 *  - new rows hold a private-store object pathname (`expense-attachments/<id>/…`,
 *    `delivery-proofs/<saleId>/…`, `wht-attachments/<whtReceivedId>/…`) that
 *    is only viewable through a session-checked `/api/admin/...` route.
 */

export const DELIVERY_PROOF_ROOT = "delivery-proofs";

export type DeliveryProofImageKind = "signature" | "photo";

export interface StoredFileViewSource {
  /** What `<img src>` / `<a href>` should point at. */
  src: string;
  /**
   * True when `src` is an auth-protected same-origin route. next/image must use
   * `unoptimized` for it — the optimizer fetches without the admin's cookies.
   */
  isPrivate: boolean;
}

/** A value starting with http(s):// is a legacy public URL. */
export const isLegacyPublicFileUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/**
 * True only for a private-store pathname under `root/` — never a URL, never a
 * path that could climb out of the root. Gates both reading and deletion so a
 * stored value can never reach another prefix of the private store (e.g. slips).
 */
export const isPrivateObjectPathUnderRoot = (value: string, root: string): boolean =>
  !isLegacyPublicFileUrl(value) &&
  value.startsWith(`${root}/`) &&
  !value.split("/").some((segment) => segment === ".." || segment === ".");

export const buildExpenseAttachmentViewRoute = (attachmentId: string): string =>
  `/api/admin/expense-attachments/${encodeURIComponent(attachmentId)}`;

export const buildDeliveryProofImageRoute = (proofId: string, kind: DeliveryProofImageKind): string =>
  `/api/admin/delivery-proofs/${encodeURIComponent(proofId)}/${kind}`;

export const buildWhtAttachmentViewRoute = (attachmentId: string): string =>
  `/api/admin/wht-attachments/${encodeURIComponent(attachmentId)}`;

/** View source for an expense attachment (legacy URLs are rendered unchanged). */
export const resolveExpenseAttachmentViewSource = (attachment: {
  id: string;
  url: string;
}): StoredFileViewSource =>
  isLegacyPublicFileUrl(attachment.url)
    ? { src: attachment.url, isPrivate: false }
    : { src: buildExpenseAttachmentViewRoute(attachment.id), isPrivate: true };

/** View source for a WHT certificate (50 ทวิ) attachment (legacy URLs are rendered unchanged). */
export const resolveWhtAttachmentViewSource = (attachment: {
  id: string;
  url: string;
}): StoredFileViewSource =>
  isLegacyPublicFileUrl(attachment.url)
    ? { src: attachment.url, isPrivate: false }
    : { src: buildWhtAttachmentViewRoute(attachment.id), isPrivate: true };

/**
 * View source for a delivery-proof image, or null when the proof has none.
 * Legacy URLs keep going through `toPublicStorageCdnPath` exactly as before.
 */
export const resolveDeliveryProofImageSource = (
  proofId: string,
  kind: DeliveryProofImageKind,
  storedValue: string | null | undefined,
): StoredFileViewSource | null => {
  if (!storedValue) return null;
  if (isLegacyPublicFileUrl(storedValue)) {
    return { src: toPublicStorageCdnPath(storedValue) ?? storedValue, isPrivate: false };
  }
  return { src: buildDeliveryProofImageRoute(proofId, kind), isPrivate: true };
};
