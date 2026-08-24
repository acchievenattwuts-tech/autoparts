export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { ProfitSourceType, SaleChannel } from "@/lib/generated/prisma";
import { getThailandDateKey, parseDateOnlyToEndOfDay, parseDateOnlyToStartOfDay } from "@/lib/th-date";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import LinkPendingIndicator from "@/components/shared/LinkPendingIndicator";

function firstDayOfMonth(dateKey: string) { return `${dateKey.slice(0, 7)}-01`; }

export default async function ShopeeReportPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  await requirePermission("reports.view");
  const params = await searchParams;
  const today = getThailandDateKey();
  const from = params.from ?? firstDayOfMonth(today);
  const to = params.to ?? today;
  const range = { gte: parseDateOnlyToStartOfDay(from), lte: parseDateOnlyToEndOfDay(to) };
  const [saleFacts, expenseFacts, saleCounts, settled, pending, feeGroups] = await Promise.all([
    db.factProfit.aggregate({ where: { channel: SaleChannel.SHOPEE, sourceType: ProfitSourceType.SALE, isActive: true, businessDate: range }, _sum: { salesAmount: true, costAmount: true, grossProfit: true }, _count: true }),
    db.factProfit.aggregate({ where: { channel: SaleChannel.SHOPEE, sourceType: ProfitSourceType.EXPENSE, isActive: true, businessDate: range }, _sum: { expenseAmount: true, netProfitAmount: true } }),
    db.sale.groupBy({ by: ["status"], where: { channel: SaleChannel.SHOPEE, saleDate: range }, _count: true, _sum: { netAmount: true } }),
    db.shopeeSettlement.aggregate({ where: { status: "ACTIVE", settlementDate: range }, _count: true, _sum: { salesAmount: true, feeAmount: true, payoutAmount: true } }),
    db.sale.aggregate({ where: { channel: SaleChannel.SHOPEE, status: "ACTIVE", saleDate: { lte: range.lte }, shopeeSettlementLines: { none: { activeSaleId: { not: null } } } }, _count: true, _sum: { netAmount: true } }),
    db.shopeeSettlementFee.groupBy({ by: ["feeCode", "label"], where: { settlement: { status: "ACTIVE", settlementDate: range } }, _sum: { amount: true }, orderBy: { _sum: { amount: "desc" } } }),
  ]);
  const money = (value: unknown) => Number(value ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const grossProfit = Number(saleFacts._sum.grossProfit ?? 0);
  const expenseAmount = Number(expenseFacts._sum.expenseAmount ?? 0);
  const netProfit = grossProfit - expenseAmount;
  const activeSales = saleCounts.find((row) => row.status === "ACTIVE");
  const cancelledSales = saleCounts.find((row) => row.status === "CANCELLED");

  return <div className="space-y-6">
    <Link href="/admin/sales?channel=SHOPEE" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-orange-600 dark:text-slate-400"><ChevronLeft size={16}/> รายการขาย Shopee<LinkPendingIndicator /></Link>
    <div><h1 className="font-kanit text-2xl font-bold text-slate-900 dark:text-slate-100">รายงานผู้บริหาร — Shopee</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">แยกผลประกอบการออกจากหน้าร้าน และอ้างอิง FactProfit ชุดเดียวกับรายงานกำไรหลัก</p></div>
    <AdminSearchForm action="/admin/reports/shopee" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#101b2e]"><label className="text-sm text-slate-600 dark:text-slate-300">จาก<input type="date" name="from" defaultValue={from} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 dark:border-white/20 dark:bg-slate-900"/></label><label className="text-sm text-slate-600 dark:text-slate-300">ถึง<input type="date" name="to" defaultValue={to} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 dark:border-white/20 dark:bg-slate-900"/></label><AdminSearchSubmitButton>แสดงรายงาน</AdminSearchSubmitButton></AdminSearchForm>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[
      ["ยอดขาย", money(saleFacts._sum.salesAmount), `${activeSales?._count ?? 0} ใบขายใช้งาน`],
      ["ต้นทุนขาย", money(saleFacts._sum.costAmount), "ต้นทุน snapshot ตอนตัดสต็อก"],
      ["กำไรขั้นต้น", money(grossProfit), "ยอดขาย − ต้นทุนขาย"],
      ["กำไรสุทธิหลังค่าธรรมเนียม", money(netProfit), `หักค่า Shopee ${money(expenseAmount)}`],
    ].map(([label, value, detail]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101b2e]"><p className="text-sm text-slate-500 dark:text-slate-400">{label}</p><p className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">฿{value}</p><p className="mt-1 text-xs text-slate-400">{detail}</p></div>)}</div>
    <div className="grid gap-4 lg:grid-cols-3"><div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101b2e]"><h2 className="font-medium dark:text-slate-100">การรับเงินจริงในช่วง</h2><dl className="mt-4 space-y-2 text-sm"><div className="flex justify-between"><dt>จำนวนรอบ</dt><dd>{settled._count}</dd></div><div className="flex justify-between"><dt>ยอดขายที่จับคู่</dt><dd>฿{money(settled._sum.salesAmount)}</dd></div><div className="flex justify-between"><dt>ค่าธรรมเนียม</dt><dd className="text-red-600">฿{money(settled._sum.feeAmount)}</dd></div><div className="flex justify-between font-semibold"><dt>เงินเข้าธนาคาร</dt><dd>฿{money(settled._sum.payoutAmount)}</dd></div></dl></div><div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-400/30 dark:bg-amber-500/10"><h2 className="font-medium text-amber-900 dark:text-amber-100">รอกระทบยอด ณ วันสิ้นงวด</h2><p className="mt-3 text-2xl font-bold text-amber-900 dark:text-amber-100">฿{money(pending._sum.netAmount)}</p><p className="mt-1 text-sm text-amber-700 dark:text-amber-200">{pending._count} ออเดอร์ (อาจรวมใบขายก่อนวันเริ่มรายงาน)</p></div><div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101b2e]"><h2 className="font-medium dark:text-slate-100">คุณภาพรายการ</h2><p className="mt-3 text-sm">ใบขายยกเลิกในช่วง: <strong>{cancelledSales?._count ?? 0}</strong></p><p className="mt-2 text-xs text-slate-500 dark:text-slate-400">การโอนเงินระหว่างบัญชีพักกับธนาคารไม่กระทบกำไร มีเฉพาะ Expense ค่าธรรมเนียมที่ลดกำไรสุทธิ</p></div></div>
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101b2e]"><h2 className="mb-4 font-kanit text-lg font-semibold dark:text-slate-100">ค่าธรรมเนียมแยกประเภท</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead className="text-slate-500 dark:text-slate-300"><tr><th className="py-2 text-left">ประเภท</th><th className="py-2 text-left">รายละเอียด</th><th className="py-2 text-right">ยอดรวม</th></tr></thead><tbody>{feeGroups.length === 0 ? <tr><td colSpan={3} className="py-8 text-center text-slate-400">ยังไม่มีค่าธรรมเนียมในช่วงนี้</td></tr> : feeGroups.map((row) => <tr key={`${row.feeCode}-${row.label}`} className="border-t border-slate-100 dark:border-white/5"><td className="py-3 font-mono">{row.feeCode}</td><td className="py-3">{row.label}</td><td className="py-3 text-right">฿{money(row._sum.amount)}</td></tr>)}</tbody></table></div></div>
  </div>;
}
