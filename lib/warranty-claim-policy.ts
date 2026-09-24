import type { ClaimType, WarrantyCreationSource, WarrantyStatus } from "@/lib/generated/prisma";
import { ADMIN_CLAIM_TYPE_LABEL } from "@/lib/warranty-claim-i18n";

/**
 * Two claim families, decided by the warranty the claim points to:
 * - SALE   — warranty auto-created by a sale (AUTO_FROM_SALE). Cancel = delete the
 *            claim and append a history line to Sale.claimCancelNotes. Series WC.
 * - ONSITE — warranty staff created on site (MANUAL). Cancel = status CANCELLED,
 *            row kept. Series WCM, never reused.
 */
export type WarrantyClaimKind = "SALE" | "ONSITE";

export const CLAIM_NO_PREFIX: Record<WarrantyClaimKind, string> = {
  SALE: "WC",
  ONSITE: "WCM",
};

export const CLAIM_CANCEL_NOTE_MAX_LENGTH = 500;
export const CLAIM_CANCEL_NOTE_REQUIRED_ERROR = "กรุณาระบุหมายเหตุการยกเลิกใบเคลม";
export const CLAIM_CANCEL_NOTE_TOO_LONG_ERROR = `หมายเหตุการยกเลิกต้องไม่เกิน ${CLAIM_CANCEL_NOTE_MAX_LENGTH} ตัวอักษร`;
export const CANCELLED_WARRANTY_CLAIM_ERROR = "รายการประกันนี้ถูกยกเลิกแล้ว ไม่สามารถเปิดเคลมได้";
export const WARRANTY_CANCEL_NOTE_MAX_LENGTH = 500;

/** Claims-list search param set after a sale claim was cancelled (its detail page is gone). */
export const CLAIM_DELETED_SEARCH_PARAM = "claimDeleted";
export const CLAIM_DELETED_SUCCESS_MESSAGE =
  "ยกเลิกใบเคลมเรียบร้อย — ใบเคลมของประกันจากใบขายถูกลบแล้ว และบันทึกรายละเอียดไว้ที่ \"ประวัติยกเลิกเคลม\" ของใบขาย";

/** Title of the sale timeline event written when a sale claim is cancelled (deleted). */
export const SALE_CLAIM_DELETED_ACTIVITY_TITLE = "ยกเลิกใบเคลม (ลบเอกสาร)";
/** meta.event marker of that audit row, so the timeline can tell it from a sale cancel. */
export const SALE_CLAIM_DELETED_AUDIT_EVENT = "WARRANTY_CLAIM_DELETED";

export function getWarrantyClaimKind(warranty: {
  createdVia: WarrantyCreationSource;
  saleId: string | null;
}): WarrantyClaimKind {
  return warranty.createdVia === "AUTO_FROM_SALE" && warranty.saleId ? "SALE" : "ONSITE";
}

export function isWarrantyCancelled(warranty: { status: WarrantyStatus }): boolean {
  return warranty.status === "CANCELLED";
}

export type ClaimCancelNoteResult = { note: string; error?: undefined } | { note?: undefined; error: string };

/** Cancelling any claim requires a trimmed note of at most 500 characters. */
export function normalizeClaimCancelNote(raw: unknown): ClaimCancelNoteResult {
  const note = typeof raw === "string" ? raw.trim() : "";
  if (!note) return { error: CLAIM_CANCEL_NOTE_REQUIRED_ERROR };
  if (note.length > CLAIM_CANCEL_NOTE_MAX_LENGTH) return { error: CLAIM_CANCEL_NOTE_TOO_LONG_ERROR };
  return { note };
}

/** Collapses line breaks so one cancelled claim always stays one history line. */
function toSingleLine(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

export type SaleClaimCancelHistoryInput = {
  cancelledAtText: string;
  actorName: string | null;
  productName: string;
  unitSeq: number;
  lotNo: string | null;
  claimType: ClaimType;
  symptom: string | null;
  note: string;
};

/**
 * One history line for Sale.claimCancelNotes. The claim number is deliberately
 * left out — the claim is deleted and its number may be reused.
 */
export function buildSaleClaimCancelHistoryLine(input: SaleClaimCancelHistoryInput): string {
  const unitText = `ชิ้นที่ ${input.unitSeq}${input.lotNo ? `, Lot ${input.lotNo}` : ""}`;
  const symptom = input.symptom?.trim() ? toSingleLine(input.symptom) : "-";
  return [
    input.cancelledAtText,
    input.actorName?.trim() || "-",
    `${toSingleLine(input.productName)} (${unitText})`,
    `ประเภท: ${ADMIN_CLAIM_TYPE_LABEL[input.claimType]}`,
    `อาการ: ${symptom}`,
    `หมายเหตุ: ${toSingleLine(input.note)}`,
  ].join(" • ");
}

/** Appends a line, never overwriting what is already there. */
export function appendSaleClaimCancelNote(existing: string | null | undefined, line: string): string {
  const current = existing?.replace(/\s+$/, "") ?? "";
  return current ? `${current}\n${line}` : line;
}

export function parseSaleClaimCancelNotes(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
