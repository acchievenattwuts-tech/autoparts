"use client";

import { useState, useTransition } from "react";
import { cancelExpense } from "./actions";
import { XCircle } from "lucide-react";

const CancelExpenseButton = ({ id, expenseNo }: { id: string; expenseNo: string }) => {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");

  const handleCancel = () => {
    const note = prompt(`ยืนยันการยกเลิกเอกสาร ${expenseNo}\nระบุเหตุผล (ไม่บังคับ):`);
    if (note === null) return; // user cancelled prompt
    setError("");
    const fd = new FormData();
    fd.set("expenseId", id);
    fd.set("cancelNote", note);
    startTransition(async () => {
      const res = await cancelExpense(fd);
      if (res.error) setError(res.error);
    });
  };

  return (
    <div>
      <button
        onClick={handleCancel}
        disabled={isPending}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 text-red-500 hover:bg-red-50 rounded-lg text-xs transition-colors disabled:opacity-40"
      >
        <XCircle size={13} /> {isPending ? "..." : "ยกเลิก"}
      </button>
      {error && <p className="text-red-500 text-xs mt-0.5 text-right">{error}</p>}
    </div>
  );
};

export default CancelExpenseButton;
