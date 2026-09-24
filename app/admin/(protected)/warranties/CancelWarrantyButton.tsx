"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { WARRANTY_CANCEL_NOTE_MAX_LENGTH } from "@/lib/warranty-claim-policy";
import { cancelWarranty } from "./actions";

const CancelWarrantyButton = ({
  warrantyId,
  warrantyLabel,
}: {
  warrantyId: string;
  warrantyLabel: string;
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
        <>
          ประกันหน้างาน <span className="font-semibold text-gray-700 dark:text-slate-200">{warrantyLabel}</span> จะถูกเปลี่ยนสถานะเป็นยกเลิก
          (ยังแสดงในรายการพร้อมป้าย &quot;ยกเลิก&quot;) และจะเปิดเคลมรายการนี้ไม่ได้อีก
        </>
      }
      onSuccess={() => router.refresh()}
    />
  );
};

export default CancelWarrantyButton;
