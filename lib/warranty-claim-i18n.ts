import type { ClaimOutcome, ClaimType, WarrantyClaimStatus } from "@/lib/generated/prisma";

export const WARRANTY_CLAIM_STATUS_LABEL: Record<WarrantyClaimStatus, string> = {
  DRAFT: "รอดำเนินการ",
  SENT_TO_SUPPLIER: "ส่งซัพพลายเออร์แล้ว",
  CLOSED: "จบเคลม",
  RETURNED_TO_CUSTOMER: "ส่งคืนลูกค้าแล้ว",
  CANCELLED: "ยกเลิก",
};

export const WARRANTY_CLAIM_STATUS_BADGE_CLASS: Record<WarrantyClaimStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  SENT_TO_SUPPLIER: "bg-blue-100 text-blue-700",
  CLOSED: "bg-emerald-100 text-emerald-700",
  RETURNED_TO_CUSTOMER: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-rose-100 text-rose-700",
};

export const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  REPLACE_NOW: "เปลี่ยนสินค้าทันที",
  CUSTOMER_WAIT: "ลูกค้ารอ",
};

export const CLAIM_OUTCOME_LABEL: Record<ClaimOutcome, string> = {
  RECEIVED: "ได้รับสินค้าคืน",
  NO_RESOLUTION: "ซัพพลายเออร์ไม่รับเคลม",
};

export function getClaimOutcomeLabel(outcome: ClaimOutcome | null | undefined) {
  return outcome ? CLAIM_OUTCOME_LABEL[outcome] : "-";
}

export function getCustomerClaimStatusLabel({
  claimType,
  outcome,
  status,
}: {
  claimType: ClaimType;
  outcome?: ClaimOutcome | null;
  status: WarrantyClaimStatus;
}) {
  if (status === "CANCELLED") return WARRANTY_CLAIM_STATUS_LABEL.CANCELLED;
  if (claimType === "REPLACE_NOW") return "เปลี่ยนสินค้าแล้ว";
  if (status === "CLOSED" && outcome === "NO_RESOLUTION") return CLAIM_OUTCOME_LABEL.NO_RESOLUTION;

  return WARRANTY_CLAIM_STATUS_LABEL[status];
}

export function getCustomerClaimStatusBadgeClass({
  claimType,
  outcome,
  status,
}: {
  claimType: ClaimType;
  outcome?: ClaimOutcome | null;
  status: WarrantyClaimStatus;
}) {
  if (status === "CANCELLED") return WARRANTY_CLAIM_STATUS_BADGE_CLASS.CANCELLED;
  if (claimType === "REPLACE_NOW") return "bg-emerald-100 text-emerald-700";
  if (status === "CLOSED" && outcome === "NO_RESOLUTION") return "bg-amber-100 text-amber-800";

  return WARRANTY_CLAIM_STATUS_BADGE_CLASS[status];
}
