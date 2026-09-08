import { ReceiptText } from "lucide-react";
import Link from "next/link";

import {
  buildInvoiceHref,
  buildProfitDashboardHref,
  formatMoney,
  formatPercent,
  getBasisLabel,
  SectionPagination,
  type ProfitSectionContext,
} from "@/app/admin/(protected)/ProfitSectionShared";
import { ProfitSourceType } from "@/lib/generated/prisma";
import { getProfitInvoiceSection, getRevenueAmountByBasis } from "@/lib/profit-dashboard";
import { formatDateThai } from "@/lib/th-date";

const ProfitInvoiceSection = async ({ context }: { context: ProfitSectionContext }) => {
  const section = await getProfitInvoiceSection({
    from: context.from,
    to: context.to,
    page: context.invoicePage,
  });
  const basis = context.basis;
  const basisLabel = getBasisLabel(basis);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-kanit text-xl font-semibold text-gray-900 dark:text-slate-100">Profit by Invoice</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Drill down กลับไปดูเอกสารที่ทำเงิน หรือเอกสารที่ทำให้กำไรหายได้โดยตรง
          </p>
        </div>
        <ReceiptText className="text-gray-400" size={18} />
      </div>
      <div className="mb-3 rounded-2xl bg-gray-50 p-4 text-xs text-gray-600 dark:bg-white/5 dark:text-slate-300">
        ยอดขายในตารางนี้สลับตาม dropdown ส่วนกำไรและ % Margin ยังใช้ฐานก่อน VAT เสมอ
      </div>
      <div className="mb-3 text-xs text-gray-500 dark:text-slate-400">
        ตารางนี้แบ่งหน้าเมื่อจำนวนเอกสารมากขึ้น เพื่อให้เลือกดูบิลต้นเหตุได้เร็วและไม่ต้องดึงทั้งช่วงมาทีเดียว
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs text-gray-500 dark:text-slate-400">
            <tr className="border-b border-gray-100 dark:border-white/10">
              <th className="pb-3">เลขที่เอกสาร</th>
              <th className="pb-3">วันที่</th>
              <th className="pb-3">ลูกค้า</th>
              <th className="pb-3 text-right">ยอดขาย ({basisLabel})</th>
              <th className="pb-3 text-right">ต้นทุน</th>
              <th className="pb-3 text-right">กำไร</th>
              <th className="pb-3 text-right">% Margin</th>
            </tr>
          </thead>
          <tbody>
            {section.items.map((row) => (
              <tr key={`${row.sourceType}-${row.sourceId}`} className="border-b border-gray-50 dark:border-white/5">
                <td className="py-3">
                  <Link
                    href={buildInvoiceHref(row.sourceType, row.sourceId)}
                    className="font-medium text-sky-700 underline-offset-2 hover:underline"
                  >
                    {row.sourceDocNo}
                  </Link>
                  <p className="text-xs text-gray-400">
                    {row.sourceType === ProfitSourceType.SALE ? "Sale" : "Credit Note Return"}
                  </p>
                </td>
                <td className="py-3 text-gray-500">{formatDateThai(row.businessDate)}</td>
                <td className="py-3 text-gray-500">{row.customerName ?? "-"}</td>
                <td className="py-3 text-right">
                  {formatMoney(
                    getRevenueAmountByBasis(
                      {
                        exVat: row.salesAmountExVat,
                        incVat: row.salesAmountIncVat,
                      },
                      basis,
                    ),
                  )}
                </td>
                <td className="py-3 text-right">{formatMoney(row.costAmount)}</td>
                <td
                  className={`py-3 text-right font-medium ${
                    row.grossProfit >= 0 ? "text-emerald-600" : "text-rose-600"
                  }`}
                >
                  {formatMoney(row.grossProfit)}
                </td>
                <td className="py-3 text-right">{formatPercent(row.marginPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SectionPagination
        currentPage={section.pagination.page}
        totalPages={section.pagination.totalPages}
        buildHref={(page) => buildProfitDashboardHref(context, { invoicePage: page })}
      />
    </section>
  );
};

export default ProfitInvoiceSection;
