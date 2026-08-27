export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { DocStatus, MarketplaceSettlementDocType } from "@/lib/generated/prisma";
import { formatDateThai, formatDateTimeThai } from "@/lib/th-date";
import {
  getMarketplaceChannelConfig,
  isManualMarketplaceChannel,
} from "@/lib/marketplace/config";
import LinkPendingIndicator from "@/components/shared/LinkPendingIndicator";

const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function MarketplaceSettlementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePermission("marketplace.manage");
  const { id } = await params;

  const settlement = await db.marketplaceSettlement.findUnique({
    where: { id },
    select: {
      id: true,
      settlementNo: true,
      channel: true,
      payoutRef: true,
      settlementDate: true,
      salesAmount: true,
      returnAmount: true,
      feeAmount: true,
      incomeAmount: true,
      payoutAmount: true,
      status: true,
      note: true,
      cancelNote: true,
      cancelledAt: true,
      createdAt: true,
      sourceAccount: { select: { code: true, name: true } },
      destinationAccount: { select: { code: true, name: true } },
      expense: { select: { id: true, expenseNo: true, status: true } },
      cashBankTransfer: { select: { id: true, transferNo: true, status: true } },
      cashBankAdjustment: { select: { id: true, adjustNo: true, status: true } },
      user: { select: { name: true } },
      lines: {
        orderBy: [{ docType: "asc" }, { docDate: "asc" }, { docNo: "asc" }],
        select: {
          id: true,
          docType: true,
          docNo: true,
          docDate: true,
          amount: true,
          saleId: true,
          creditNoteId: true,
        },
      },
      fees: {
        orderBy: { lineNo: "asc" },
        select: { id: true, lineNo: true, kind: true, feeCode: true, label: true, amount: true },
      },
    },
  });

  if (!settlement) notFound();
  const config = isManualMarketplaceChannel(settlement.channel)
    ? getMarketplaceChannelConfig(settlement.channel)
    : null;
  const isActive = settlement.status === DocStatus.ACTIVE;

  const summary: Array<[string, string, string]> = [
    ["ยอดขายที่กระทบยอด", money(settlement.salesAmount), "รวมทุกใบขายในรอบนี้"],
    ["หักยอดคืนสินค้า", `-${money(settlement.returnAmount)}`, "ใบลดหนี้ที่ถูกหักในรอบนี้"],
    ["หักค่าธรรมเนียม", `-${money(settlement.feeAmount)}`, "บันทึกเป็นค่าใช้จ่ายของช่องทาง"],
    ["บวกรายรับพิเศษ", `+${money(settlement.incomeAmount)}`, "เงินที่แพลตฟอร์มจ่ายเพิ่ม"],
  ];

  return (
    <div className="space-y-6">
      <Link
        href={config ? `/admin/sales/${config.slug}/settlements` : "/admin/sales"}
        className="inline-flex items-center gap-1 text-sm text-slate-500 transition-colors hover:text-sky-600 dark:text-slate-400"
      >
        <ChevronLeft size={16} /> กระทบยอดรับเงิน {config?.label ?? ""}
        <LinkPendingIndicator />
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-kanit text-2xl font-bold text-slate-900 dark:text-slate-100">
            รอบรับเงิน {settlement.settlementNo}
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {config?.label ?? settlement.channel} · อ้างอิง {settlement.payoutRef} ·{" "}
            {formatDateThai(settlement.settlementDate)} · บันทึกโดย {settlement.user.name}
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${
            isActive
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
              : "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
          }`}
        >
          {isActive ? "ใช้งาน" : "ยกเลิกแล้ว"}
        </span>
      </div>

      {!isActive && settlement.cancelNote ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-200">
          ยกเลิกเมื่อ{" "}
          {settlement.cancelledAt ? formatDateTimeThai(settlement.cancelledAt) : "-"} — เหตุผล:{" "}
          {settlement.cancelNote}
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {summary.map(([label, value, detail]) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101b2e]"
          >
            <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
            <p className="mt-2 text-xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
              ฿{value}
            </p>
            <p className="mt-1 text-xs text-slate-400">{detail}</p>
          </div>
        ))}
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-5 dark:border-sky-400/30 dark:bg-sky-500/10">
          <p className="text-sm text-sky-700 dark:text-sky-200">เงินเข้าธนาคารจริง</p>
          <p className="mt-2 text-xl font-bold tabular-nums text-sky-900 dark:text-sky-100">
            ฿{money(settlement.payoutAmount)}
          </p>
          <p className="mt-1 text-xs text-sky-600 dark:text-sky-300">
            {settlement.sourceAccount.code} → {settlement.destinationAccount.code}
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="mb-4 font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">
          เอกสารการเงินที่ระบบสร้างให้
        </h2>
        <ul className="grid gap-3 text-sm sm:grid-cols-3">
          <li className="rounded-lg border border-slate-200 p-3 dark:border-white/10">
            <p className="text-slate-500 dark:text-slate-400">ใบโอนเงิน</p>
            <p className="mt-1 font-mono font-medium text-slate-900 dark:text-slate-100">
              {settlement.cashBankTransfer.transferNo}
            </p>
          </li>
          <li className="rounded-lg border border-slate-200 p-3 dark:border-white/10">
            <p className="text-slate-500 dark:text-slate-400">ใบค่าธรรมเนียม</p>
            <p className="mt-1 font-mono font-medium text-slate-900 dark:text-slate-100">
              {settlement.expense?.expenseNo ?? "— ไม่มีค่าธรรมเนียมในรอบนี้"}
            </p>
          </li>
          <li className="rounded-lg border border-slate-200 p-3 dark:border-white/10">
            <p className="text-slate-500 dark:text-slate-400">ใบปรับยอดรายรับพิเศษ</p>
            <p className="mt-1 font-mono font-medium text-slate-900 dark:text-slate-100">
              {settlement.cashBankAdjustment?.adjustNo ?? "— ไม่มีรายรับพิเศษในรอบนี้"}
            </p>
          </li>
        </ul>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          เอกสารทั้งสามใบถูกล็อกไว้ ยกเลิกได้เฉพาะผ่านการยกเลิกรอบรับเงินนี้เท่านั้น
          เพื่อไม่ให้ยอดกำไรและยอดบัญชีพักเงินหลุดจากกัน
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="mb-4 font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">
          เอกสารในรอบ ({settlement.lines.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-slate-500 dark:text-slate-300">
              <tr>
                <th className="p-2 text-left">ประเภท</th>
                <th className="p-2 text-left">เลขที่</th>
                <th className="p-2 text-left">วันที่เอกสาร</th>
                <th className="p-2 text-right">ยอด</th>
              </tr>
            </thead>
            <tbody>
              {settlement.lines.map((line) => {
                const isSale = line.docType === MarketplaceSettlementDocType.SALE;
                const href = isSale
                  ? `/admin/sales/${line.saleId}`
                  : `/admin/credit-notes/${line.creditNoteId}`;
                return (
                  <tr key={line.id} className="border-t border-slate-100 dark:border-white/5">
                    <td className="p-2">{isSale ? "ใบขาย" : "ใบลดหนี้"}</td>
                    <td className="p-2 font-mono">
                      <Link
                        href={href}
                        className="text-sky-700 hover:underline dark:text-sky-300"
                      >
                        {line.docNo}
                      </Link>
                    </td>
                    <td className="p-2">{formatDateThai(line.docDate)}</td>
                    <td
                      className={`p-2 text-right tabular-nums ${isSale ? "" : "text-rose-600 dark:text-rose-300"}`}
                    >
                      {money(line.amount)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="mb-4 font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">
          ค่าธรรมเนียมและรายการปรับปรุง
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-slate-500 dark:text-slate-300">
              <tr>
                <th className="p-2 text-left">ประเภท</th>
                <th className="p-2 text-left">รหัส</th>
                <th className="p-2 text-left">รายละเอียด</th>
                <th className="p-2 text-right">ยอด</th>
              </tr>
            </thead>
            <tbody>
              {settlement.fees.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-slate-400">
                    ไม่มีค่าธรรมเนียมในรอบนี้
                  </td>
                </tr>
              ) : (
                settlement.fees.map((fee) => (
                  <tr key={fee.id} className="border-t border-slate-100 dark:border-white/5">
                    <td className="p-2">{fee.kind === "FEE" ? "ค่าธรรมเนียม" : "รายการปรับปรุง"}</td>
                    <td className="p-2 font-mono">{fee.feeCode}</td>
                    <td className="p-2">{fee.label}</td>
                    <td
                      className={`p-2 text-right tabular-nums ${Number(fee.amount) < 0 ? "text-rose-600 dark:text-rose-300" : "text-emerald-600 dark:text-emerald-300"}`}
                    >
                      {money(fee.amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {settlement.note ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">หมายเหตุ: {settlement.note}</p>
      ) : null}
    </div>
  );
}
