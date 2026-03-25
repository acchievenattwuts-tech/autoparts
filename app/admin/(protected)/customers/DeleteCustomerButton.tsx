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
      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-60"
    >
      <Trash2 size={12} />
      {isPending ? "กำลังลบ..." : "ลบ"}
    </button>
  );
};

export default DeleteCustomerButton;
