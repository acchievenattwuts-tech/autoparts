"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteExpense } from "./actions";
import { useRouter } from "next/navigation";

const DeleteExpenseButton = ({ id }: { id: string }) => {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      const res = await deleteExpense(id);
      if (res.error) { setError(res.error); return; }
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
        title="ลบรายการ"
      >
        <Trash2 size={15} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="font-semibold text-gray-900 mb-2">ยืนยันการลบ</h3>
            <p className="text-sm text-gray-500 mb-4">รายการค่าใช้จ่ายนี้จะถูกลบถาวร ไม่สามารถกู้คืนได้</p>
            {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
            <div className="flex gap-3">
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {isPending ? "กำลังลบ..." : "ยืนยันลบ"}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default DeleteExpenseButton;
