export const dynamic = "force-dynamic";

import { ShieldCheck } from "lucide-react";

import { requirePermission } from "@/lib/require-auth";

const AuditLogPage = async () => {
  await requirePermission("audit_log.view");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
          Audit Log
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          ประวัติการกระทำในระบบ — ติดตามว่าใครทำอะไร เมื่อไหร่ และค่าก่อน/หลังคืออะไร
        </p>
      </div>

      <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
          <ShieldCheck size={28} />
        </div>
        <h2 className="mt-4 font-kanit text-xl font-semibold text-gray-900 dark:text-slate-100">
          กำลังพัฒนา
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-600 dark:text-slate-400">
          หน้านี้จะรวม audit log ทั้งระบบ: การสร้าง/แก้ไข/ยกเลิกเอกสาร, login/logout,
          เปลี่ยนรหัสผ่าน, แก้ไขสิทธิ์ พร้อม before/after diff และ filter ตามผู้ใช้, action, entity
        </p>
        <p className="mx-auto mt-3 max-w-md text-xs text-gray-500 dark:text-slate-500">
          งานนี้รออยู่ใน roadmap (ดู PLAN.md หัวข้อ Audit Log / Activity Trail)
        </p>
      </div>
    </div>
  );
};

export default AuditLogPage;
