import Link from "next/link";
import type { JSX } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { formatDateOnlyForInput, getThailandDateKey } from "@/lib/th-date";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { PERIOD_LOCK_OVERRIDE_PERMISSION } from "@/lib/period-lock";
import AdjustDebitForm, { type AdjustParentView } from "../../AdjustDebitForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "ปรับยอดใบเพิ่มหนี้ซัพพลายเออร์" };

const loadAdjustDebit = async ({ params }: { params: Promise<{ id: string }> }) => {
  try {
    // An adjustment is a new supplier DN document, so it needs the DN create permission.
    const session = await requirePermission("supplier_debit_notes.create");
    const canOverride = (session.user.permissions ?? []).includes(PERIOD_LOCK_OVERRIDE_PERMISSION);
    const { id } = await params;
    const debit = await db.supplierDebitNote.findUnique({ where: { id }, select: {
      id: true, debitNo: true, status: true, adjustsDebitNoteId: true, netAmount: true, amountRemain: true, dueDate: true,
      vatType: true, vatRate: true, vatRecoverable: true, supplier: { select: { name: true } }, purchase: { select: { purchaseNo: true } },
      items: { orderBy: { lineNo: "asc" }, select: { purchaseItemId: true, affectedQuantity: true, amountMode: true,
        increaseAmount: true, netAmount: true, showUnitName: true, product: { select: { code: true, name: true } } } },
      adjustments: { where: { status: "ACTIVE" }, select: { netAmount: true, items: { select: { purchaseItemId: true, netAmount: true } } } },
    } });
    if (!debit) notFound();
    const adjustedByLine = new Map<string, number>();
    for (const adjustment of debit.adjustments) {
      for (const item of adjustment.items) {
        if (item.purchaseItemId) adjustedByLine.set(item.purchaseItemId, (adjustedByLine.get(item.purchaseItemId) ?? 0) + Number(item.netAmount));
      }
    }
    const today = getThailandDateKey();
    const dueDate = formatDateOnlyForInput(debit.dueDate);
    const parent: AdjustParentView = {
      id: debit.id, debitNo: debit.debitNo, purchaseNo: debit.purchase.purchaseNo, supplierName: debit.supplier.name,
      netAmount: Number(debit.netAmount),
      adjustedNet: debit.adjustments.reduce((sum, row) => sum + Number(row.netAmount), Number(debit.netAmount)),
      amountRemain: Number(debit.amountRemain), dueDate: dueDate > today ? dueDate : today,
      vatType: debit.vatType, vatRate: Number(debit.vatRate), vatRecoverable: debit.vatRecoverable,
      lines: debit.items.flatMap((item) => item.purchaseItemId ? [{ purchaseItemId: item.purchaseItemId,
        productName: item.product.name, productCode: item.product.code, unitName: item.showUnitName,
        affectedQuantity: Number(item.affectedQuantity), amountMode: item.amountMode, increaseAmount: Number(item.increaseAmount),
        chargedNet: Number(item.netAmount) + (adjustedByLine.get(item.purchaseItemId) ?? 0) }] : []),
    };
    const blocked = debit.status !== "ACTIVE" ? "ใบเพิ่มหนี้นี้ถูกยกเลิกแล้ว ปรับยอดไม่ได้"
      : debit.adjustsDebitNoteId ? "เอกสารนี้เป็นเอกสารปรับยอด DN แล้ว ให้ปรับยอดจากใบเพิ่มหนี้ต้นฉบับแทน" : null;
    const cashBankAccounts = blocked ? [] : await getActiveCashBankAccountOptions();
    return { parent, blocked, cashBankAccounts, canOverride };
  } catch (error) { console.error("[supplier-DN adjust page]", error); throw error; }
};

const AdjustDebitPage = async ({ params }: { params: Promise<{ id: string }> }): Promise<JSX.Element> => {
  const { parent, blocked, cashBankAccounts, canOverride } = await loadAdjustDebit({ params });
  return (
    <div className="space-y-6">
      <Link href={`/admin/supplier-debit-notes/${parent.id}`} className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300">
        <ArrowLeft size={16} /> กลับไปดูใบเพิ่มหนี้ {parent.debitNo}
      </Link>
      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">ปรับยอด DN <span className="font-mono">{parent.debitNo}</span></h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">
          ใช้เมื่อแก้ยอด DN เดิมไม่ได้ (เดือนที่ลงต้นทุนประกาศปันผลแล้ว หรือยอดใหม่ต่ำกว่าที่จ่ายไปแล้ว) · บันทึกเป็นเอกสารใหม่ลงวันที่วันนี้ DN เดิมไม่เปลี่ยน ·
          ยอดเพิ่มเป็นเจ้าหนี้แยกใบ · ยอดลดหักยอดค้างของ DN เดิมก่อน ส่วนที่เกินเลือกเก็บเป็นเครดิตหรือรับเงินคืน
        </p>
      </div>
      {blocked ? (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-8 text-center text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
          {blocked}
        </div>
      ) : <AdjustDebitForm parent={parent} cashBankAccounts={cashBankAccounts} canOverride={canOverride} />}
    </div>
  );
};
export default AdjustDebitPage;
