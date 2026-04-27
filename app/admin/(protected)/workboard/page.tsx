export const dynamic = "force-dynamic";

import Link from "next/link";
import { ClipboardList, ArrowRight } from "lucide-react";

import { requirePermission } from "@/lib/require-auth";

const WorkboardPage = async () => {
  await requirePermission("workboard.view");

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
          Today Workboard
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          งานค้างของวันนี้ — รวมทุกสิ่งที่ต้องทำในที่เดียว
        </p>
      </div>

      <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          <ClipboardList size={28} />
        </div>
        <h2 className="mt-4 font-kanit text-xl font-semibold text-gray-900 dark:text-slate-100">
          กำลังพัฒนา
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-gray-600 dark:text-slate-400">
          หน้านี้จะรวมงานค้างทั้งหมดของวันนี้: ใบขายรอจัดส่ง, COD รอรับเงิน,
          ลูกหนี้เกินเครดิต, supplier ครบกำหนดจ่าย, เคลมรอ supplier ตอบ,
          สินค้าใกล้หมดสต็อก, lot ใกล้หมดอายุ และยอดเงินสด/ธนาคารต่ำกว่าเกณฑ์
        </p>
        <p className="mx-auto mt-3 max-w-md text-xs text-gray-500 dark:text-slate-500">
          งานนี้รออยู่ใน roadmap (ดู PLAN.md หัวข้อ Today Workboard)
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/admin/dashboard"
            className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163052] dark:bg-sky-500 dark:hover:bg-sky-400"
          >
            ไป Dashboard
            <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </div>
  );
};

export default WorkboardPage;
