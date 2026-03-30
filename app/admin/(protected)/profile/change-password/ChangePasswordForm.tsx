"use client";

import { useState, useTransition } from "react";
import { CheckCircle } from "lucide-react";
import { changeOwnPassword } from "./actions";

const inputCls =
  "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

const ChangePasswordForm = () => {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const result = await changeOwnPassword(formData);
      if (result.error) {
        setError(result.error);
        return;
      }

      e.currentTarget.reset();
      setSuccess("เปลี่ยนรหัสผ่านเรียบร้อยแล้ว");
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <div className="grid grid-cols-1 gap-4">
          <div>
            <label className={labelCls}>รหัสผ่านปัจจุบัน</label>
            <input type="password" name="currentPassword" required className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>รหัสผ่านใหม่</label>
            <input type="password" name="newPassword" minLength={8} required className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>ยืนยันรหัสผ่านใหม่</label>
            <input type="password" name="confirmPassword" minLength={8} required className={inputCls} />
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 flex items-center gap-2">
          <CheckCircle size={16} className="text-green-600" />
          <p className="text-sm text-green-600">{success}</p>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={isPending}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก..." : "เปลี่ยนรหัสผ่าน"}
        </button>
      </div>
    </form>
  );
};

export default ChangePasswordForm;
