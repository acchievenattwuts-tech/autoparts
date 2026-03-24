"use client";

import { useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteProduct } from "./actions";

interface DeleteProductButtonProps {
  id: string;
  name: string;
}

const DeleteProductButton = ({ id, name }: DeleteProductButtonProps) => {
  const [isPending, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirm(`ยืนยันการลบสินค้า "${name}" ?\nการลบนี้ไม่สามารถย้อนกลับได้`)) return;

    startTransition(async () => {
      const result = await deleteProduct(id);
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

export default DeleteProductButton;
