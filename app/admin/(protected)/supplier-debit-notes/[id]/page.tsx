import Link from "next/link";
import type { JSX, ReactNode } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Info, Pencil, SlidersHorizontal } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission, getSessionPermissionContext } from "@/lib/require-auth";
import { hasPermissionAccess } from "@/lib/access-control";
import { formatDateThai, formatDateTimeThai } from "@/lib/th-date";
import { createDocumentMutationGuard, buildMutationBlockMessage, buildMutationBlockReferenceLinks, type GuardDb } from "@/lib/document-mutation-guard";
import { getDocumentActivityTimeline } from "@/lib/document-activity";
import { previewSupplierDebitCancel, SUPPLIER_DEBIT_UNLINKED_LINE_NOTE } from "@/lib/supplier-debit-note";
import { PERIOD_LOCK_OVERRIDE_PERMISSION } from "@/lib/period-lock";
import { formatSupplierDebitAdjustmentLabel } from "@/lib/supplier-debit-balance";
import DocumentActivityTimeline from "@/components/admin/DocumentActivityTimeline";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import CancelDebitButton from "../CancelDebitButton";
import { DebitAdjustmentList, DebitAdjustmentSettlement, type DebitAdjustmentRow } from "../DebitAdjustmentPanels";

export const dynamic = "force-dynamic";
export const metadata = { title: "ใบเพิ่มหนี้ซัพพลายเออร์" };
const VAT_LABEL = { NO_VAT: "ไม่มี VAT", EXCLUDING_VAT: "ไม่รวม VAT", INCLUDING_VAT: "รวม VAT" } as const;
const money = (value: unknown): string => Number(value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const linkCls = "font-mono text-[#1e3a5f] hover:underline dark:text-sky-300";
const thCls = "px-4 py-3 font-medium";

const loadDebitDetail = async ({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; updated?: string }> }) => {
  try {
    await requirePermission("supplier_debit_notes.view");
    const { id } = await params;
    const { created, updated } = await searchParams;
    const { role, permissions } = await getSessionPermissionContext();
    const debit = await db.supplierDebitNote.findUnique({ where: { id }, include: {
      supplier: { select: { name: true } }, purchase: { select: { id: true, purchaseNo: true } }, user: { select: { name: true } },
      items: { orderBy: { lineNo: "asc" }, include: { product: { select: { code: true, name: true } } } },
      supplierPaymentItems: { where: { payment: { status: "ACTIVE" } }, include: { payment: { select: { id: true, paymentNo: true, paymentDate: true } } } },
      adjustsDebitNote: { select: { id: true, debitNo: true } }, cashBankAccount: { select: { name: true } },
      adjustments: { orderBy: [{ postingDate: "asc" }, { createdAt: "asc" }],
        select: { id: true, debitNo: true, status: true, postingDate: true, netAmount: true, amountRemain: true } },
    } });
    if (!debit) notFound();
    // A negative ปรับยอด DN whose excess the supplier paid back in cash (CASH_REFUND).
    const refunded = debit.adjustsDebitNote && debit.excessSettlementType === "CASH_REFUND"
      ? (await db.documentPayment.findMany({ where: { docType: "SUPPLIER_DEBIT_REFUND", docId: id }, select: { amount: true } }))
        .reduce((sum, row) => sum + Number(row.amount), 0) : 0;
    const block = debit.status === "ACTIVE" ? await createDocumentMutationGuard(db as unknown as GuardDb).check("SupplierDebitNote", id, "cancel") : null;
    const reason = block ? buildMutationBlockMessage(block) : null;
    const blockLinks = block ? buildMutationBlockReferenceLinks(block) : [];
    const activity = await getDocumentActivityTimeline("SupplierDebitNote", id);
    const canCancel = hasPermissionAccess(role, permissions, "supplier_debit_notes.cancel");
    // A cancel restates later sales; when that touches a distributed month the dialog asks an owner for the reason.
    const cancelPreview = debit.status === "ACTIVE" && canCancel && !reason ? await previewSupplierDebitCancel(id) : null;
    return { created, updated, debit, reason, blockLinks, activity, cancelPreview, canCancel, refunded,
      canCreate: hasPermissionAccess(role, permissions, "supplier_debit_notes.create"),
      canUpdate: hasPermissionAccess(role, permissions, "supplier_debit_notes.update"),
      canOverride: (permissions as readonly string[]).includes(PERIOD_LOCK_OVERRIDE_PERMISSION) };
  } catch (error) { console.error("[supplier-DN detail]", error); throw error; }
};

const InfoItem = ({ label, children }: { label: string; children: ReactNode }) => (
  <div>
    <p className="text-sm text-gray-500 dark:text-slate-400">{label}</p>
    <div className="mt-0.5 font-medium text-gray-900 dark:text-slate-100">{children}</div>
  </div>
);

const AmountCard = ({ label, value, tone }: { label: string; value: unknown; tone: "navy" | "blue" | "emerald" | "amber" }) => {
  const toneCls = {
    navy: "border-gray-100 bg-white text-[#1e3a5f] dark:border-white/10 dark:bg-white/5 dark:text-sky-300",
    blue: "border-blue-100 bg-blue-50 text-blue-700 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-400",
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-400",
    amber: "border-amber-100 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-400",
  }[tone];
  return (
    <div className={`rounded-lg border p-4 ${toneCls}`}>
      <p className="text-sm opacity-90">{label}</p>
      <p className="mt-2 font-kanit text-2xl font-bold tabular-nums">{money(value)}</p>
    </div>
  );
};

const DebitDetailPage = async ({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; updated?: string }> }): Promise<JSX.Element> => {
  const { created, updated, debit, reason, blockLinks, activity, cancelPreview, canCreate, canUpdate, canCancel, canOverride, refunded } =
    await loadDebitDetail({ params, searchParams });
  const active = debit.status === "ACTIVE";
  const parent = debit.adjustsDebitNote ?? null;
  const adjustments: DebitAdjustmentRow[] = (debit.adjustments ?? []).map((row) => ({ id: row.id, debitNo: row.debitNo,
    status: row.status, postingDate: row.postingDate, netAmount: Number(row.netAmount), amountRemain: Number(row.amountRemain) }));
  const netAmount = Number(debit.netAmount);
  const docLabel = parent ? "ปรับยอด DN" : "ใบเพิ่มหนี้";
  const flash = active && created === "1" ? `บันทึก${docLabel} ${debit.debitNo} สำเร็จ`
    : active && updated === "1" ? `บันทึกการแก้ไข${docLabel} ${debit.debitNo} สำเร็จ` : null;
  return (
    <div className="space-y-6">
      <Link href="/admin/supplier-debit-notes" className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300">
        <ArrowLeft size={16} /> กลับไปรายการใบเพิ่มหนี้
      </Link>

      {flash ? (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          <CheckCircle2 size={16} /> {flash}
        </p>
      ) : null}

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <div className="mb-5 flex flex-col gap-3 border-b border-gray-100 pb-4 sm:flex-row sm:items-center sm:justify-between dark:border-white/10">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <h1 className="font-mono text-2xl font-bold text-gray-900 dark:text-slate-100">{debit.debitNo}</h1>
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
                {parent ? <>เอกสารปรับยอด DN · <Link href={`/admin/supplier-debit-notes/${parent.id}`} className={linkCls}>{formatSupplierDebitAdjustmentLabel(parent.debitNo)}</Link></> : "ใบเพิ่มหนี้ซัพพลายเออร์"}
                {" "}· เลขของซัพพลายเออร์ {debit.supplierReferenceNo}
              </p>
            </div>
            {active ? <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge> : <AdminStatusBadge tone="danger">ยกเลิกแล้ว</AdminStatusBadge>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {active && !parent && canCreate ? (
              <Link href={`/admin/supplier-debit-notes/${debit.id}/adjust`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e3a5f]/30 px-3 py-1.5 text-sm text-[#1e3a5f] transition-colors hover:border-[#1e3a5f] hover:bg-sky-50 dark:border-sky-400/30 dark:text-sky-300 dark:hover:border-sky-400 dark:hover:bg-sky-500/10">
                <SlidersHorizontal size={14} /> ปรับยอด DN
              </Link>
            ) : null}
            {active && !parent && canUpdate ? (
              <Link href={`/admin/supplier-debit-notes/${debit.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/20 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300">
                <Pencil size={14} /> แก้ไข
              </Link>
            ) : null}
            {active && canCancel && !reason ? <CancelDebitButton id={debit.id} docNo={debit.debitNo} canOverride={canOverride}
              adjustmentOf={parent?.debitNo}
              lockedPeriods={cancelPreview?.lockedPeriods ?? []} restatement={cancelPreview?.restatement ?? null} /> : null}
          </div>
        </div>

        {active && canCancel && reason ? (
          <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
            <p><span className="font-medium">ยกเลิกไม่ได้:</span> {reason}</p>
            {blockLinks.length > 0 ? (
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                {blockLinks.map((link) => <Link key={link.href} href={link.href} className="font-medium underline underline-offset-2">{link.label}</Link>)}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="grid gap-4 rounded-lg bg-gray-50 p-4 sm:grid-cols-2 lg:grid-cols-4 dark:bg-white/5">
          <InfoItem label="ซัพพลายเออร์">{debit.supplier.name}</InfoItem>
          <InfoItem label="ใบซื้ออ้างอิง"><Link href={`/admin/purchases/${debit.purchase.id}`} className={linkCls}>{debit.purchase.purchaseNo}</Link></InfoItem>
          <InfoItem label="วันที่ออก / ได้รับ">{formatDateThai(debit.debitDate)} / {formatDateThai(debit.receivedDate)}</InfoItem>
          <InfoItem label="วันที่ลงต้นทุน / ครบกำหนด">{formatDateThai(debit.postingDate)} / {formatDateThai(debit.dueDate)}</InfoItem>
          <InfoItem label="ภาษีมูลค่าเพิ่ม">{VAT_LABEL[debit.vatType]}{debit.vatType !== "NO_VAT" ? ` ${Number(debit.vatRate)}%` : ""} · {debit.vatRecoverable ? "ใช้เป็นภาษีซื้อ" : "รวมในต้นทุน"}</InfoItem>
          <InfoItem label="ผู้บันทึก">{debit.user?.name ?? "-"}<span className="block text-xs font-normal text-gray-500 dark:text-slate-400">{formatDateTimeThai(debit.createdAt)}</span></InfoItem>
          <div className="sm:col-span-2"><InfoItem label={parent ? "เหตุผลปรับยอด" : "เหตุผลเพิ่มหนี้"}>{debit.reason}</InfoItem></div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <AmountCard label={`${netAmount < 0 ? "เจ้าหนี้ลด" : "เจ้าหนี้เพิ่ม"} (VAT ${money(debit.vatAmount)})`} value={debit.netAmount} tone="navy" />
          <AmountCard label={netAmount < 0 ? "เครดิตคงเหลือ" : "ยอดค้างจ่าย"} value={netAmount < 0 ? -Number(debit.amountRemain) : debit.amountRemain} tone="blue" />
          <AmountCard label={netAmount < 0 ? "ลดมูลค่าสต็อก" : "เพิ่มมูลค่าสต็อก"} value={debit.inventoryAmount} tone="emerald" />
          <AmountCard label="ส่วนต่างต้นทุนงวด DN" value={debit.varianceAmount} tone="amber" />
        </div>

        {parent && netAmount < 0 ? (
          <DebitAdjustmentSettlement parentDebitNo={parent.debitNo} netAmount={netAmount} active={active}
            creditRemain={-Number(debit.amountRemain)} refunded={refunded}
            consumed={debit.supplierPaymentItems.reduce((sum, item) => sum + Number(item.paidAmount), 0)}
            settlementType={debit.excessSettlementType} accountName={debit.cashBankAccount?.name ?? null} />
        ) : null}

        <p className="mt-4 flex items-start gap-2 text-xs text-gray-500 dark:text-slate-400">
          <Info size={14} className="mt-0.5 shrink-0" /> ใช้ stock coverage รวมของ SKU ณ วันที่ลงต้นทุน · จำนวนสินค้าไม่เปลี่ยน · การลง DN ไม่ปรับต้นทุนใบขายก่อนหน้า แต่การแก้รายการหรือยกเลิก DN จะปรับต้นทุนใบขายที่อยู่หลัง DN ย้อนหลัง
          {parent ? " · ยอดลดที่เกินมูลค่าสต็อกคงเหลือจะตัดเป็นผลต่างมูลค่าสต็อก (มูลค่าสต็อกไม่ติดลบ)" : ""}
        </p>

        {debit.note ? (
          <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-white/10 dark:bg-white/5">
            <p className="text-sm font-medium text-gray-700 dark:text-slate-300">หมายเหตุ</p>
            <p className="mt-1 whitespace-pre-line text-sm text-gray-600 dark:text-slate-400">{debit.note}</p>
          </div>
        ) : null}
        {!active && debit.cancelNote ? (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-rose-400/20 dark:bg-rose-500/10">
            <p className="text-sm font-medium text-red-700 dark:text-rose-400">เหตุผลที่ยกเลิก{debit.cancelledAt ? ` · ${formatDateTimeThai(debit.cancelledAt)}` : ""}</p>
            <p className="mt-1 text-sm text-red-600 dark:text-rose-300">{debit.cancelNote}</p>
          </div>
        ) : null}
      </div>

      <section className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="border-b border-gray-100 px-6 py-4 font-kanit text-lg font-semibold text-[#1e3a5f] dark:border-white/10 dark:text-sky-300">รายการปรับราคา</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300"><tr>
              <th className={`${thCls} w-10 text-center`}>#</th><th className={`${thCls} text-left`}>สินค้า</th>
              <th className={`${thCls} text-right`}>จำนวนปรับ</th><th className={`${thCls} text-right`}>ราคาเดิม</th>
              <th className={`${thCls} text-right`}>ส่วนต่างที่กรอก</th><th className={`${thCls} text-right`}>เข้าสต็อก</th>
              <th className={`${thCls} text-right`}>ส่วนต่างงวดนี้</th><th className={`${thCls} text-right`}>MAVG ก่อน → หลัง</th>
            </tr></thead>
            <tbody>{debit.items.map((item) => (
              <tr key={item.id} className="border-t border-slate-100 dark:border-white/5">
                <td className="px-4 py-3 text-center text-xs tabular-nums text-slate-400">{item.lineNo}</td>
                <td className="px-4 py-3"><Link href={`/admin/stock/card?productId=${item.productId}`} className="font-medium text-gray-900 hover:text-[#1e3a5f] hover:underline dark:text-slate-100 dark:hover:text-sky-300">{item.product.name}</Link>
                  <p className="font-mono text-xs text-gray-500 dark:text-slate-400">{item.product.code}</p>
                  {item.purchaseItemId === null ? (
                    <p className="mt-1 inline-flex items-start gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
                      <Info size={12} className="mt-0.5 shrink-0" /> {SUPPLIER_DEBIT_UNLINKED_LINE_NOTE}
                    </p>
                  ) : null}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-slate-300">{Number(item.affectedQuantity)} {item.showUnitName}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-slate-300">{money(item.originalUnitPrice)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-slate-300">{money(item.increaseAmount)}
                  <span className="block text-xs text-gray-500 dark:text-slate-400">{item.amountMode === "TOTAL" ? "ยอดรวมรายการ" : `ต่อ ${item.showUnitName}`}</span></td>
                <td className="px-4 py-3 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{money(item.inventoryAmount)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-amber-700 dark:text-amber-400">{money(item.varianceAmount)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-slate-300">{money(item.avgCostBefore)} → {money(item.avgCostAfter)}
                  <span className="block text-xs text-gray-500 dark:text-slate-400">ต่อหน่วยฐาน</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      {!parent ? <DebitAdjustmentList netAmount={netAmount} adjustments={adjustments} /> : null}

      <section className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-[#101b2e]">
        <h2 className="mb-4 font-kanit text-lg font-semibold text-[#1e3a5f] dark:text-sky-300">{netAmount < 0 ? "การใช้เครดิต" : "การจ่ายชำระ"}</h2>
        {debit.supplierPaymentItems.length === 0 ? <p className="text-sm text-gray-400 dark:text-slate-500">{netAmount < 0 ? "ยังไม่มีการนำเครดิตไปหัก" : "ยังไม่มีการจ่ายชำระ"}</p> : (
          <div className="space-y-2">{debit.supplierPaymentItems.map((item) => (
            <Link key={item.id} href={`/admin/supplier-payments/${item.payment.id}`}
              className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3 text-sm transition-colors hover:border-[#1e3a5f]/30 hover:bg-gray-50 dark:border-white/10 dark:hover:border-sky-400/30 dark:hover:bg-white/5">
              <span><span className="font-mono font-medium text-[#1e3a5f] dark:text-sky-300">{item.payment.paymentNo}</span>
                <span className="ml-2 text-gray-500 dark:text-slate-400">{formatDateThai(item.payment.paymentDate)}</span></span>
              <span className="font-medium tabular-nums text-gray-900 dark:text-slate-100">{money(item.paidAmount)}</span>
            </Link>
          ))}</div>
        )}
      </section>

      <DocumentActivityTimeline events={activity} />
    </div>
  );
};
export default DebitDetailPage;
