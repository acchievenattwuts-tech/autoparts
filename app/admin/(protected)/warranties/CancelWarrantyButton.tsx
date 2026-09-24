"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { WARRANTY_CANCEL_NOTE_MAX_LENGTH } from "@/lib/warranty-claim-policy";
import { cancelWarranty } from "./actions";

const CancelWarrantyButton = ({
  warrantyId,
  warrantyLabel,
  onSite,
}: {
  warrantyId: string;
  warrantyLabel: string;
  /** From isOnSiteWarranty(): on-site = cancelled in place; sale-linked = deleted. */
  onSite: boolean;
}) => {
  const router = useRouter();
  return (
    <CancelDocButton
      docId={warrantyId}
      docNo={warrantyLabel}
      idFieldName="warrantyId"
      cancelAction={cancelWarranty}
      noteMaxLength={WARRANTY_CANCEL_NOTE_MAX_LENGTH}
      description={
        onSite ? (
          <>
            ประกันหน้างาน <span className="font-semibold text-gray-700 dark:text-slate-200">{warrantyLabel}</span> จะถูกเปลี่ยนสถานะเป็นยกเลิก
            (ยังแสดงในรายการพร้อมป้าย &quot;ยกเลิก&quot;) และจะเปิดเคลมรายการนี้ไม่ได้อีก
          </>
        ) : (
          <>
            ประกันที่อ้างอิงใบขาย <span className="font-semibold text-gray-700 dark:text-slate-200">{warrantyLabel}</span> จะถูก
            <strong className="text-red-600 dark:text-rose-300">ลบออกจากระบบ</strong> (บันทึกรายละเอียดไว้ในประวัติการใช้งาน)
            หลังจากนั้นบันทึกประกันให้รายการขายนี้ใหม่ได้
          </>
        )
      }
      onSuccess={() => router.refresh()}
    />
  );
};

export default CancelWarrantyButton;
