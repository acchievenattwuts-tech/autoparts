export const dynamic = "force-dynamic";

import NavLink from "@/components/shared/NavLink";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import AdminTableSection from "@/components/shared/AdminTableSection";
import CreateFilingRow from "./CreateFilingRow";

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

const FORM_LABELS: Record<string, string> = {
  PND3: "ภ.ง.ด.3 (ผู้รับเป็นบุคคลธรรมดา)",
  PND53: "ภ.ง.ด.53 (ผู้รับเป็นนิติบุคคล)",
};

const formatBaht = (value: number) => value.toLocaleString("th-TH", { minimumFractionDigits: 2 });

const NewWhtFilingPage = async () => {
  await requirePermission("wht_filings.manage");

  // จัดกลุ่มหนังสือรับรองที่ยังไม่ได้ยื่นตามแบบและเดือนภาษี — 1 กลุ่ม = 1 รอบยื่นที่สร้างได้
  const groups = await db.whtCertificate.groupBy({
    by: ["formType", "taxYear", "taxMonth"],
    where: { status: "ACTIVE", filingId: null },
    _count: { _all: true },
    _sum: { totalBaseAmount: true, totalTaxAmount: true },
    orderBy: [{ taxYear: "desc" }, { taxMonth: "desc" }, { formType: "asc" }],
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <NavLink
          href="/admin/wht/filings"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> รอบยื่นแบบ ภ.ง.ด.
        </NavLink>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">สร้างรอบยื่นใหม่</span>
      </div>

      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">สร้างรอบยื่นแบบ ภ.ง.ด.</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          ระบบจัดกลุ่มหนังสือรับรองที่ยังไม่ได้ยื่นตามแบบและเดือนภาษีให้แล้ว — เลือกกลุ่มที่ต้องการแล้วกดสร้างรอบยื่น
          หนังสือรับรองทุกใบในกลุ่มจะถูกดึงเข้ารอบและล็อกไม่ให้แก้ยอด
        </p>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400 dark:border-white/10 dark:bg-slate-950/40 dark:text-slate-500">
          ไม่มีหนังสือรับรองที่ยังไม่ได้ยื่น
        </div>
      ) : (
        <AdminTableSection>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300">
              <tr>
                <th className="px-4 py-3 text-left font-medium">แบบยื่น</th>
                <th className="px-4 py-3 text-left font-medium">เดือนภาษี</th>
                <th className="px-4 py-3 text-right font-medium">จำนวนราย</th>
                <th className="px-4 py-3 text-right font-medium">รวมเงินได้</th>
                <th className="px-4 py-3 text-right font-medium">รวมภาษีที่หัก</th>
                <th className="px-4 py-3 text-right font-medium">สร้างรอบยื่น</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr
                  key={`${group.formType}-${group.taxYear}-${group.taxMonth}`}
                  className="border-t border-slate-100 align-middle dark:border-white/5"
                >
                  <td className="px-4 py-3 text-slate-800 dark:text-slate-100">
                    {FORM_LABELS[group.formType] ?? group.formType}
                  </td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                    {THAI_MONTHS[group.taxMonth - 1]} {group.taxYear}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-700 dark:text-slate-200">
                    {group._count._all}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600 dark:text-slate-300">
                    {formatBaht(Number(group._sum.totalBaseAmount ?? 0))}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-[#1e3a5f] dark:text-sky-300">
                    {formatBaht(Number(group._sum.totalTaxAmount ?? 0))}
                  </td>
                  <td className="px-4 py-3">
                    <CreateFilingRow
                      formType={group.formType as "PND3" | "PND53"}
                      taxMonth={group.taxMonth}
                      taxYear={group.taxYear}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AdminTableSection>
      )}
    </div>
  );
};

export default NewWhtFilingPage;
