"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { CLAIM_CANCEL_NOTE_MAX_LENGTH, CLAIM_DELETED_SEARCH_PARAM } from "@/lib/warranty-claim-policy";
import { cancelClaimAction } from "./actions";

const CancelClaimButton = ({
  claimId,
  claimNo,
  disabledReason,
  deletesClaim,
}: {
  claimId: string;
  claimNo: string;
  disabledReason?: string | null;
  /** True for a claim on a sale warranty: cancelling deletes it (on-site claims are kept). */
  deletesClaim: boolean;
}) => {
  const router = useRouter();
  const deletedRef = useRef(false);

  const cancelAction = async (formData: FormData) => {
    const result = await cancelClaimAction(formData);
    deletedRef.current = result.deleted === true;
    return result;
  };

  return (
    <CancelDocButton
      docId={claimId}
      docNo={claimNo}
      idFieldName="claimId"
      cancelAction={cancelAction}
      noteRequired
      noteMaxLength={CLAIM_CANCEL_NOTE_MAX_LENGTH}
      description={
        deletesClaim ? (
          <>
            ใบเคลม <span className="font-mono font-semibold text-gray-700 dark:text-slate-200">{claimNo}</span> ของประกันจากใบขาย
            จะถูก<strong className="text-red-600 dark:text-rose-300">ลบออกจากระบบ</strong> ระบบจะคืนสต็อก/คำนวณ MAVG ใหม่
            และบันทึกรายละเอียดพร้อมหมายเหตุไว้ที่ &quot;ประวัติยกเลิกเคลม&quot; ของใบขาย หลังจากนั้นเปิดเคลมรายการนี้ใหม่ได้
          </>
        ) : (
          <>
            ใบเคลม <span className="font-mono font-semibold text-gray-700 dark:text-slate-200">{claimNo}</span> ของประกันหน้างาน
            จะถูกเปลี่ยนสถานะเป็นยกเลิก (ยังแสดงในรายการ) ระบบจะคืนสต็อก/คำนวณ MAVG ใหม่ และไม่สามารถกู้คืนได้
          </>
        )
      }
      onSuccess={() => {
        if (deletedRef.current) {
          router.push(`/admin/warranty-claims?${CLAIM_DELETED_SEARCH_PARAM}=1`);
          return;
        }
        router.refresh();
      }}
      disabledReason={disabledReason}
    />
  );
};

export default CancelClaimButton;
