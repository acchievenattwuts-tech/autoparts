/**
 * Outcome of the public QR verification page (/verify/[type]/[docNo]/[token]).
 * A cancelled document was really issued by the system, so the token still
 * verifies, but it must never be shown as a valid document.
 */
export type VerifyDocumentState = "valid" | "cancelled" | "invalid";

export type VerifyDocumentStatusInput = {
  tokenValid: boolean;
  document: { status: string } | null;
};

const ACTIVE_DOCUMENT_STATUS = "ACTIVE";

export const getVerifyDocumentState = ({ tokenValid, document }: VerifyDocumentStatusInput): VerifyDocumentState => {
  if (!tokenValid || !document) return "invalid";
  return document.status === ACTIVE_DOCUMENT_STATUS ? "valid" : "cancelled";
};
