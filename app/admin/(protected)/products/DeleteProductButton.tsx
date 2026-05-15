"use client";

import { useTransition } from "react";
import { toggleProduct } from "./actions";

interface Props {
  id: string;
  name: string;
  isActive: boolean;
}

const ToggleProductButton = ({ id, name, isActive }: Props) => {
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    const action = isActive ? "ยกเลิก" : "เปิดใช้งาน";
    if (!confirm(`ยืนยันการ${action}สินค้า "${name}" ?`)) return;
    startTransition(async () => {
      const result = await toggleProduct(id, !isActive);
      if (result.error) alert(result.error);
    });
  };

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-60 ${
        isActive ? "bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500" : "bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-500"
      }`}
    >
      {isPending ? "..." : isActive ? "ยกเลิก" : "เปิดใช้งาน"}
    </button>
  );
};

export default ToggleProductButton;
