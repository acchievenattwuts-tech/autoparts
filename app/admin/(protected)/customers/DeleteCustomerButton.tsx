"use client";

import { useTransition } from "react";
import { toggleCustomer } from "./actions";

interface Props {
  id: string;
  name: string;
  isActive: boolean;
}

const ToggleCustomerButton = ({ id, name, isActive }: Props) => {
  const [isPending, startTransition] = useTransition();

  const handleToggle = () => {
    const action = isActive ? "ยกเลิก" : "เปิดใช้งาน";
    if (!confirm(`ยืนยันการ${action}ลูกค้า "${name}" ?`)) return;
    startTransition(async () => {
      const result = await toggleCustomer(id, !isActive);
      if (result.error) alert(result.error);
    });
  };

  return (
    <button
      onClick={handleToggle}
      disabled={isPending}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-medium rounded-lg transition-colors disabled:opacity-60 ${
        isActive ? "bg-red-500 hover:bg-red-600" : "bg-green-600 hover:bg-green-700"
      }`}
    >
      {isPending ? "..." : isActive ? "ยกเลิก" : "เปิดใช้งาน"}
    </button>
  );
};

export default ToggleCustomerButton;
