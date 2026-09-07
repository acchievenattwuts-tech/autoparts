export const dynamic = "force-dynamic";

import NavLink from "@/components/shared/NavLink";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { getWhtIssuedIncomeTypeOptions } from "@/lib/wht-income-types";
import StandaloneCertificateForm from "./StandaloneCertificateForm";

const NewWhtCertificatePage = async () => {
  await requirePermission("wht.create");

  const [payees, incomeTypes] = await Promise.all([
    db.supplier.findMany({
      where: { isActive: true, whtPayeeProfile: { isActive: true } },
      orderBy: [{ code: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true },
    }),
    getWhtIssuedIncomeTypeOptions(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <NavLink
          href="/admin/wht/certificates"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> หนังสือรับรอง 50 ทวิ
        </NavLink>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">ออกใบใหม่</span>
      </div>

      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
          ออกหนังสือรับรองหัก ณ ที่จ่าย (แบบเดี่ยว)
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          ใช้เมื่อจ่ายเงินโดยไม่ได้คีย์ใบค่าใช้จ่ายหรือใบจ่ายชำระหนี้ — ถ้ามีเอกสารต้นทางอยู่แล้ว
          ให้ติ๊กหักภาษีที่เอกสารนั้นแทน ระบบจะออกใบให้อัตโนมัติและผูกเลขที่กับเอกสารต้นทางให้
        </p>
      </div>

      {payees.length === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/5 dark:text-amber-300">
          ยังไม่มีผู้รับเงินที่กรอกข้อมูลภาษีไว้ — กรอกที่เมนู &ldquo;ข้อมูลภาษีผู้ถูกหัก&rdquo; ก่อน
        </div>
      ) : (
        <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
          <StandaloneCertificateForm payees={payees} incomeTypes={incomeTypes} />
        </div>
      )}
    </div>
  );
};

export default NewWhtCertificatePage;
