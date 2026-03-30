"use client";

import { useTransition } from "react";
import { toggleUserActive } from "./actions";

interface ToggleUserButtonProps {
  id: string;
  name: string;
  isActive: boolean;
}

const ToggleUserButton = ({ id, name, isActive }: ToggleUserButtonProps) => {
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    const confirmed = window.confirm(
      `${isActive ? "ปิดการใช้งาน" : "เปิดการใช้งาน"}ผู้ใช้ ${name} ใช่หรือไม่`
    );
    if (!confirmed) return;

    startTransition(async () => {
      await toggleUserActive(id, !isActive);
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
        isActive
          ? "bg-red-50 text-red-600 hover:bg-red-100"
          : "bg-green-50 text-green-600 hover:bg-green-100"
      } disabled:opacity-50`}
    >
      {isPending ? "กำลังบันทึก..." : isActive ? "ปิดใช้งาน" : "เปิดใช้งาน"}
    </button>
  );
};

export default ToggleUserButton;
