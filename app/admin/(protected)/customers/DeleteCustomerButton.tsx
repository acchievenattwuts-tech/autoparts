"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteCustomer } from "./actions";

interface DeleteCustomerButtonProps {
  id:   string;
  name: string;
}

const DeleteCustomerButton = ({ id, name }: DeleteCustomerButtonProps) => {
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirm(`ยืนยันการลบลูกค้า "${name}" ?\nการลบนี้ไม่สามารถย้อนกลับได้`)) return;

    startTransition(async () => {
      const result = await deleteCustomer(id);
      if (result.error) {
        alert(result.error);
      }
    });
  };

  return (
    <button
      onClick={handleDelete}
      disabled={isPending}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isPending ? (
        <>
          <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          กำลังลบ...
        </>
      ) : (
        <>
          <Trash2 size={12} />
          ลบ
        </>
      )}
    </button>
  );
};

export default DeleteCustomerButton;
