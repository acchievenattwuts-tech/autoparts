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
    // Deactivation also releases the LINE link (toggleCustomer); reactivation never restores it.
    const lineNotice = isActive
      ? "\n\nหากลูกค้าผูก LINE ไว้ การผูก LINE จะถูกยกเลิกด้วย และจะไม่กลับมาเมื่อเปิดใช้งานอีกครั้ง (ลูกค้าต้องผูก LINE ใหม่)"
      : "";
    if (!confirm(`ยืนยันการ${action}ลูกค้า "${name}" ?${lineNotice}`)) return;
    startTransition(async () => {
      const result = await toggleCustomer(id, !isActive);
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

export default ToggleCustomerButton;
