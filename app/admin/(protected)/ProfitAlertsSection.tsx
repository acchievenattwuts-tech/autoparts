import { TrendingDown } from "lucide-react";
import Link from "next/link";

import {
  buildCreditNoteDrilldownHref,
  buildProductHref,
  buildProfitDashboardHref,
  buildSalesDrilldownHref,
  getAlertSeverityLabel,
  SectionPagination,
  type ProfitSectionContext,
} from "@/app/admin/(protected)/ProfitSectionShared";
import { getProfitAlertsSection } from "@/lib/profit-dashboard";

const ProfitAlertsSection = async ({ context }: { context: ProfitSectionContext }) => {
  const alerts = await getProfitAlertsSection({
    from: context.from,
    to: context.to,
    page: context.alertPage,
  });

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-kanit text-xl font-semibold text-gray-900 dark:text-slate-100">Alert / จุดผิดปกติ</h2>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            เรียงเคสตามความรุนแรง สูง ไป กลาง ไป ต่ำ เพื่อให้ไล่แก้จากเรื่องที่กระทบกำไรที่สุดก่อน
          </p>
        </div>
        <TrendingDown className="text-gray-400" size={18} />
      </div>
      <div className="mb-3 rounded-2xl bg-gray-50 p-4 text-xs text-gray-600 dark:bg-white/5 dark:text-slate-300">
        <p>Alert ชุดนี้ scan ครบทุกสินค้าที่มีรายการในช่วงวิเคราะห์ ไม่ได้ดูเฉพาะสินค้า Top/Bottom เท่านั้น</p>
        <p className="mt-1">
          กำไรและ margin ใช้ฐานก่อน VAT เสมอ และแต่ละการ์ดกดต่อไปดูสินค้า หรือเปิดชุดบิลต้นเหตุในหน้าขายและคืนสินค้าได้ทันที
        </p>
      </div>
      <div className="space-y-3">
        {alerts.items.length === 0 ? (
          <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-200">
            ยังไม่พบสัญญาณเตือนเด่นในช่วงวิเคราะห์
          </div>
        ) : (
          alerts.items.map((alert, index) => {
            const productHref = buildProductHref(alert.productId);

            return (
              <div
                key={`${alert.kind}-${alert.productId ?? index}`}
                className={`rounded-2xl border p-4 ${
                  alert.severity === "high"
                    ? "border-rose-200 bg-rose-50/60 dark:border-rose-400/30 dark:bg-rose-500/12"
                  : alert.severity === "medium"
                      ? "border-amber-200 bg-amber-50/60 dark:border-amber-400/30 dark:bg-amber-500/12"
                      : "border-sky-200 bg-sky-50/60 dark:border-sky-400/30 dark:bg-sky-500/12"
                }`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          alert.severity === "high"
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-500/18 dark:text-rose-100"
                            : alert.severity === "medium"
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-500/18 dark:text-amber-100"
                              : "bg-sky-100 text-sky-700 dark:bg-sky-500/18 dark:text-sky-100"
                        }`}
                      >
                        ระดับ {getAlertSeverityLabel(alert.severity)}
                      </span>
                      <span className="rounded-full bg-white/80 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:bg-slate-950/70 dark:text-slate-300">
                        {alert.kind === "loss"
                          ? "สินค้าขาดทุน"
                          : alert.kind === "low_margin"
                            ? "มาร์จิ้นต่ำ"
                            : "ต้นทุนเฉลี่ยพุ่ง"}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{alert.title}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-300">{alert.detail}</p>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                      {alert.productCode ? `รหัส ${alert.productCode} · ` : ""}
                      พบผลกระทบใน {alert.invoiceCount.toLocaleString("th-TH")} บิลภายในช่วงที่เลือก
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-xs">
                    {productHref ? (
                      <Link
                        href={productHref}
                        className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
                      >
                        เปิดสินค้า
                      </Link>
                    ) : null}
                    {alert.productId ? (
                      <Link
                        href={buildSalesDrilldownHref({
                          from: context.from,
                          to: context.to,
                          productId: alert.productId,
                        })}
                        className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
                      >
                        ดูบิลขายต้นเหตุ
                      </Link>
                    ) : null}
                    {alert.productId ? (
                      <Link
                        href={buildCreditNoteDrilldownHref({
                          from: context.from,
                          to: context.to,
                          productId: alert.productId,
                        })}
                        className="text-sky-700 underline-offset-2 hover:underline dark:text-sky-300"
                      >
                        ดูบิลคืนที่เกี่ยวข้อง
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      <SectionPagination
        currentPage={alerts.pagination.page}
        totalPages={alerts.pagination.totalPages}
        buildHref={(page) => buildProfitDashboardHref(context, { alertPage: page })}
      />
    </section>
  );
};

export default ProfitAlertsSection;
