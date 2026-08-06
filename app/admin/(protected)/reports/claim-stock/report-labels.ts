import { ClaimStockMovementType, WarrantyClaimStatus } from "@/lib/generated/prisma";

/** Thai labels shared by the claim-stock filter form and its results table. */

export const CLAIM_STATUS_LABEL: Record<WarrantyClaimStatus, string> = {
  DRAFT: "รอส่งเคลม",
  SENT_TO_SUPPLIER: "ส่งซัพพลายเออร์แล้ว",
  CLOSED: "ปิดเคลม",
  RETURNED_TO_CUSTOMER: "ส่งคืนลูกค้าแล้ว",
  CANCELLED: "ยกเลิก",
};

export const MOVEMENT_LABEL: Record<ClaimStockMovementType, string> = {
  CUSTOMER_RETURN_IN: "รับคืนจากลูกค้า",
  SEND_TO_SUPPLIER_OUT: "ส่งซัพพลายเออร์",
  SUPPLIER_RECEIVE_IN: "รับคืนจากซัพพลายเออร์",
  TRANSFER_TO_NORMAL_OUT: "โอนเข้าสต็อกปกติ",
  SUPPLIER_REJECT: "ซัพพลายเออร์ปฏิเสธ",
  SUPPLIER_CREDIT_SETTLE: "ผูกใบลดหนี้ซื้อ",
  SCRAP_OUT: "ตัดทิ้ง",
  CANCEL_REVERSAL: "รายการย้อนกลับ",
};
