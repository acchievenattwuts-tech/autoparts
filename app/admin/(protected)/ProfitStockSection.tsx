import { Package } from "lucide-react";
import Link from "next/link";

import {
  buildCreditNoteDrilldownHref,
  buildProfitDashboardHref,
  buildSalesDrilldownHref,
  formatMoney,
  formatPercent,
  getBasisLabel,
  SectionPagination,
  type ProfitSectionContext,
} from "@/app/admin/(protected)/ProfitSectionShared";
import { getProfitStockSection, getRevenueAmountByBasis } from "@/lib/profit-dashboard";

const ProfitStockSection = async ({ context }: { context: ProfitSectionContext }) => {
  const section = await getProfitStockSection({
    from: context.from,
    to: context.to,
    page: context.stockPage,
  });
  const basis = context.basis;
  const basisLabel = getBasisLabel(basis);

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-kanit text-xl font-semibold text-gray-900 dark:text-slate-100">Profit by Stock</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            มุมมองกำไรรวมแยกตามสินค้า จากยอดขายและคืนขายที่เกิดขึ้นจริงในช่วงวิเคราะห์
          </p>
        </div>
        <Package className="text-gray-400" size={18} />
      </div>
      <div className="mb-3 rounded-2xl bg-sky-50 p-4 text-xs text-sky-900">
        นิยามรอบนี้: `Profit by Stock` หมายถึงกำไรรวมแยกตามสินค้า ไม่ใช่กำไรระดับ lot หรือ stock movement
      </div>
      <div className="mb-3 text-xs text-gray-500 dark:text-slate-400">
        ตารางนี้เหมาะกับการวิเคราะห์ทั้งชุด ถ้ารายการยาวจะเปิดเป็นหลายหน้าเพื่อลดภาระการดึงข้อมูลและการอ่านบนหน้าเดียว
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs text-gray-500 dark:text-slate-400">
            <tr className="border-b border-gray-100 dark:border-white/10">
              <th className="pb-3">สินค้า</th>
              <th className="pb-3 text-right">จำนวนขายสุทธิ</th>
              <th className="pb-3 text-right">ยอดขาย ({basisLabel})</th>
              <th className="pb-3 text-right">ต้นทุน</th>
              <th className="pb-3 text-right">กำไร</th>
              <th className="pb-3 text-right">กำไร/หน่วย</th>
              <th className="pb-3 text-right">% Margin</th>
            </tr>
          </thead>
          <tbody>
            {section.items.map((row) => (
              <tr key={`stock-${row.productId}`} className="border-b border-gray-50 dark:border-white/5">
                <td className="py-3">
                  <p className="font-medium text-gray-900 dark:text-slate-100">{row.productName}</p>
                  <p className="text-xs text-gray-400 dark:text-slate-500">{row.productCode ?? "-"}</p>
                  <div className="mt-1 flex gap-3 text-xs">
                    <Link
                      href={buildSalesDrilldownHref({
                        from: context.from,
                        to: context.to,
                        productId: row.productId,
                      })}
                      className="text-sky-700 underline-offset-2 hover:underline"
                    >
                      เปิดหน้าขาย
                    </Link>
                    <Link
                      href={buildCreditNoteDrilldownHref({
                        from: context.from,
                        to: context.to,
                        productId: row.productId,
                      })}
                      className="text-sky-700 underline-offset-2 hover:underline"
                    >
                      เปิดหน้าคืนสินค้า
                    </Link>
                  </div>
                </td>
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
                <td className="py-3 text-right">{formatMoney(row.unitProfit)}</td>
                <td className="py-3 text-right">{formatPercent(row.marginPct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SectionPagination
        currentPage={section.pagination.page}
        totalPages={section.pagination.totalPages}
        buildHref={(page) => buildProfitDashboardHref(context, { stockPage: page })}
      />
    </section>
  );
};

export default ProfitStockSection;
