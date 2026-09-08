import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import {
  buildCreditNoteDrilldownHref,
  buildCustomerHref,
  buildProfitDashboardHref,
  buildSalesDrilldownHref,
  formatMoney,
  formatPercent,
  getBasisLabel,
  SectionPagination,
  type ProfitSectionContext,
} from "@/app/admin/(protected)/ProfitSectionShared";
import { getProfitCustomerSection, getRevenueAmountByBasis } from "@/lib/profit-dashboard";

const ProfitCustomerSection = async ({ context }: { context: ProfitSectionContext }) => {
  const section = await getProfitCustomerSection({
    from: context.from,
    to: context.to,
    page: context.customerPage,
  });
  const basis = context.basis;
  const basisLabel = getBasisLabel(basis);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-kanit text-xl font-semibold text-gray-900 dark:text-slate-100">Profit by Customer</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            ดูว่าลูกค้ากลุ่มไหนช่วยทำกำไรสูง และใครที่มาร์จิ้นบางจนควรทบทวนราคา ส่วนลด หรือเงื่อนไขขาย
          </p>
        </div>
        <ArrowUpRight className="text-sky-500" size={18} />
      </div>
      <div className="mb-3 rounded-2xl bg-gray-50 p-4 text-xs text-gray-600 dark:bg-white/5 dark:text-slate-300">
        ยอดขายสลับตาม dropdown ส่วนกำไรและ % Margin ใช้ฐานก่อน VAT และกดชื่อลูกค้าเพื่อ drill down ไปดูเอกสารต้นเหตุได้
      </div>
      <div className="mb-3 text-xs text-gray-500 dark:text-slate-400">
        ตารางนี้แบ่งหน้าเมื่อรายการเยอะ เพื่อให้เปิดวิเคราะห์ลูกค้าได้เร็วขึ้นและไม่ต้องโหลดข้อมูลยาวเกินจำเป็นในรอบเดียว
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs text-gray-500 dark:text-slate-400">
            <tr className="border-b border-gray-100 dark:border-white/10">
              <th className="pb-3">ลูกค้า</th>
              <th className="pb-3 text-right">จำนวนบิล</th>
              <th className="pb-3 text-right">จำนวนขายสุทธิ</th>
              <th className="pb-3 text-right">ยอดขาย ({basisLabel})</th>
              <th className="pb-3 text-right">ต้นทุน</th>
              <th className="pb-3 text-right">กำไร</th>
              <th className="pb-3 text-right">% Margin</th>
            </tr>
          </thead>
          <tbody>
            {section.items.map((row) => {
              const customerHref = buildCustomerHref(row.customerId);

              return (
                <tr key={`${row.customerId ?? row.customerName}-customer-profit`} className="border-b border-gray-50 dark:border-white/5">
                  <td className="py-3">
                    {customerHref ? (
                      <Link
                        href={customerHref}
                        className="font-medium text-sky-700 underline-offset-2 hover:underline"
                      >
                        {row.customerName}
                      </Link>
                    ) : (
                      <p className="font-medium text-gray-900">{row.customerName}</p>
                    )}
                    <p className="text-xs text-gray-400">
                      {row.customerId ? "ดูลูกค้ารายนี้ต่อได้" : "ลูกค้าที่ไม่มี master record"}
                    </p>
                    {row.customerId ? (
                      <div className="mt-1 flex gap-3 text-xs">
                        <Link
                          href={buildSalesDrilldownHref({
                            from: context.from,
                            to: context.to,
                            customerId: row.customerId,
                          })}
                          className="text-sky-700 underline-offset-2 hover:underline"
                        >
                          ดูบิลขาย
                        </Link>
                        <Link
                          href={buildCreditNoteDrilldownHref({
                            from: context.from,
                            to: context.to,
                            customerId: row.customerId,
                          })}
                          className="text-sky-700 underline-offset-2 hover:underline"
                        >
                          ดูบิลคืน
                        </Link>
                      </div>
                    ) : null}
                  </td>
                  <td className="py-3 text-right">{row.invoiceCount.toLocaleString("th-TH")}</td>
                  <td className="py-3 text-right">
                    {row.quantity.toLocaleString("th-TH", { maximumFractionDigits: 4 })}
                  </td>
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
              );
            })}
          </tbody>
        </table>
      </div>
      <SectionPagination
        currentPage={section.pagination.page}
        totalPages={section.pagination.totalPages}
        buildHref={(page) => buildProfitDashboardHref(context, { customerPage: page })}
      />
    </section>
  );
};

export default ProfitCustomerSection;
