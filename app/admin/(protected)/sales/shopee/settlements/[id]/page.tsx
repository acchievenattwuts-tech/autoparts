import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { formatDateThai } from "@/lib/th-date";

export default async function ShopeeSettlementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("marketplace.manage");
  const { id } = await params;
  const settlement = await db.shopeeSettlement.findUnique({ where: { id }, include: { sourceAccount: { select: { name: true } }, destinationAccount: { select: { name: true } }, sales: { include: { sale: { select: { id: true, saleNo: true, channelRefNo: true } } }, orderBy: { createdAt: "asc" } }, fees: { orderBy: { lineNo: "asc" } } } });
  if (!settlement) notFound();
  const money = (value: unknown) => Number(value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <div className="space-y-6"><Link href="/admin/sales/shopee/settlements" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-orange-600 dark:text-slate-400"><ChevronLeft size={16}/> กระทบยอดรับเงิน</Link><div><h1 className="font-kanit text-2xl font-bold dark:text-slate-100">{settlement.settlementNo}</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">อ้างอิง {settlement.payoutRef} · {formatDateThai(settlement.settlementDate)} · {settlement.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิก"}</p></div><div className="grid gap-4 sm:grid-cols-3">{[["ยอดขาย", settlement.salesAmount], ["ค่าธรรมเนียม", settlement.feeAmount], ["รับเข้าธนาคาร", settlement.payoutAmount]].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101b2e]"><p className="text-sm text-slate-500">{String(label)}</p><p className="mt-2 text-xl font-bold dark:text-slate-100">฿{money(value)}</p></div>)}</div><div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101b2e]"><p className="text-sm dark:text-slate-200">จาก <strong>{settlement.sourceAccount.name}</strong> ไป <strong>{settlement.destinationAccount.name}</strong></p><h2 className="mb-3 mt-5 font-medium dark:text-slate-100">ใบขายที่จับคู่</h2><ul className="space-y-2">{settlement.sales.map((item) => <li key={item.id} className="flex justify-between border-t border-slate-100 py-2 text-sm dark:border-white/5"><Link href={`/admin/sales/${item.sale.id}`} className="text-sky-700 dark:text-sky-300">{item.sale.saleNo} · {item.sale.channelRefNo}</Link><span>฿{money(item.saleAmount)}</span></li>)}</ul><h2 className="mb-3 mt-5 font-medium dark:text-slate-100">ค่าธรรมเนียม</h2><ul className="space-y-2">{settlement.fees.map((fee) => <li key={fee.id} className="flex justify-between border-t border-slate-100 py-2 text-sm dark:border-white/5"><span>{fee.label}</span><span>฿{money(fee.amount)}</span></li>)}</ul></div></div>;
}
