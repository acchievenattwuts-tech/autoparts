import { deletePrivateBlobObjects, putPrivateBlobObject } from "@/lib/private-blob-storage";
import { DELIVERY_PROOF_ROOT, isPrivateObjectPathUnderRoot } from "@/lib/private-file-ref";

/**
 * Storage for delivery-proof images (recipient signature + delivery photo). They
 * are PII, so new images go to the PRIVATE Blob store and `DeliveryProof`
 * keeps the object pathname; admins view them through the session-checked
 * `/api/admin/delivery-proofs/[id]/[kind]` route. Rows created before that change
 * still hold a public Blob URL and keep rendering as before.
 */

/** True for a new-style private-store pathname under `delivery-proofs/`. */
export const isPrivateDeliveryProofPath = (value: string): boolean =>
  isPrivateObjectPathUnderRoot(value, DELIVERY_PROOF_ROOT);

/**
 * Uploads one delivery-proof image to the private store and returns its pathname.
 * Throws when the private store is not configured — never falls back to public.
 */
export async function uploadDeliveryProofObject(input: {
  objectPath: string;
  body: Uint8Array;
  contentType: string;
}): Promise<string> {
  return putPrivateBlobObject(input);
}

/**
 * Best-effort cleanup of private delivery-proof objects that were uploaded but
 * never saved to a `DeliveryProof` row. Legacy public URLs are left untouched —
 * there has never been a deletion path for them. Never throws.
 */
export async function deleteDeliveryProofObjects(values: string[]): Promise<void> {
  await deletePrivateBlobObjects(values.filter(isPrivateDeliveryProofPath));
}
