import Link from "next/link";
import type { JSX } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { formatDateOnlyForInput, formatDateThai } from "@/lib/th-date";
import { createDocumentMutationGuard, buildMutationBlockMessage, buildMutationBlockReferenceLinks, type GuardDb } from "@/lib/document-mutation-guard";
import { getVatRegisteredFrom } from "@/lib/input-vat";
import { PERIOD_LOCK_OVERRIDE_PERMISSION } from "@/lib/period-lock";
import {
  getSupplierDebitEditLocks, isLinkedSupplierDebitLine, SUPPLIER_DEBIT_ADJUSTMENT_EDIT_MESSAGE, SUPPLIER_DEBIT_UNLINKED_EDIT_MESSAGE,
} from "@/lib/supplier-debit-note";
import DebitForm, { type DebitFormInitial, type DebitLineLock, type DebitPeriodLock } from "../../DebitForm";
import { debitPurchaseSelect, toDebitPurchase } from "../../debit-purchase";

export const dynamic = "force-dynamic";
export const metadata = { title: "แก้ไขใบเพิ่มหนี้ซัพพลายเออร์" };

const loadEditDebit = async ({ params }: { params: Promise<{ id: string }> }) => {
  try {
    const session = await requirePermission("supplier_debit_notes.update");
    const canOverride = (session.user.permissions ?? []).includes(PERIOD_LOCK_OVERRIDE_PERMISSION);
    const { id } = await params;
    const debit = await db.supplierDebitNote.findUnique({ where: { id }, include: {
      items: { orderBy: { lineNo: "asc" }, select: { purchaseItemId: true, affectedQuantity: true, increaseAmount: true, amountMode: true } },
      purchase: { select: debitPurchaseSelect },
    } });
    if (!debit) notFound();
    // R1: only a CANCELLED DN can lose a source-line link; an ACTIVE one that did gets a reason instead of the form.
    const linkedItems = debit.items.filter(isLinkedSupplierDebitLine);
    const unlinked = linkedItems.length !== debit.items.length;
    // A ปรับยอด DN is never edited in place (cancel and key a new one); the server rejects it too.
    const adjustment = Boolean(debit.adjustsDebitNoteId);
    // V1: the registration date lets the form explain the DN's VAT treatment; the server decides it again on save.
    const [block, editLocks, registeredFrom] = debit.status === "ACTIVE" && !unlinked && !adjustment ? await Promise.all([
      createDocumentMutationGuard(db as unknown as GuardDb).check("SupplierDebitNote", id, "update"),
      getSupplierDebitEditLocks(debit, canOverride), getVatRegisteredFrom(db),
    ]) : [null, null, null];
    const reason = block ? buildMutationBlockMessage(block) : null;
    const lineLock: DebitLineLock | null = block && reason ? { reason, links: buildMutationBlockReferenceLinks(block) } : null;
    const headerLocks = editLocks?.headerLocks ?? null;
    const periodLock: DebitPeriodLock = { canOverride, headerPeriods: editLocks?.headerPeriods ?? [] };
    const initial: DebitFormInitial = { id: debit.id, debitNo: debit.debitNo, postingDate: formatDateThai(debit.postingDate),
      supplierReferenceNo: debit.supplierReferenceNo, debitDate: formatDateOnlyForInput(debit.debitDate),
      receivedDate: formatDateOnlyForInput(debit.receivedDate), dueDate: formatDateOnlyForInput(debit.dueDate),
      reason: debit.reason, note: debit.note ?? "", vatType: debit.vatType, vatRate: Number(debit.vatRate),
      vatRecoverable: debit.vatRecoverable, updatedAt: debit.updatedAt.toISOString(),
      items: linkedItems.map((item) => ({ purchaseItemId: item.purchaseItemId, affectedQuantity: Number(item.affectedQuantity),
        increaseAmount: Number(item.increaseAmount), amountMode: item.amountMode })) };
    return { debit, initial, lineLock, headerLocks, periodLock, unlinked, adjustment, purchase: toDebitPurchase(debit.purchase),
      vatRegisteredFrom: registeredFrom ? formatDateOnlyForInput(registeredFrom) : null };
  } catch (error) { console.error("[supplier-DN edit]", error); throw error; }
};

const EditDebitPage = async ({ params }: { params: Promise<{ id: string }> }): Promise<JSX.Element> => {
  const { debit, initial, lineLock, headerLocks, periodLock, unlinked, adjustment, purchase, vatRegisteredFrom } = await loadEditDebit({ params });
  return (
    <div className="space-y-6">
      <Link href={`/admin/supplier-debit-notes/${debit.id}`} className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300">
        <ArrowLeft size={16} /> กลับไปดูรายละเอียดเอกสาร
      </Link>
      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">แก้ไขใบเพิ่มหนี้ <span className="font-mono">{debit.debitNo}</span></h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">เลข DN ของซัพพลายเออร์ เหตุผล และหมายเหตุแก้ได้ตลอดขณะใช้งาน · วันครบกำหนดแก้ได้เมื่อยังมียอดค้างจ่าย · วันที่ออกและวันที่ได้รับแก้ได้เมื่อยังมียอดค้างจ่ายและงวดที่ลงต้นทุนยังไม่ประกาศแบ่งกำไร · รายการ ยอด และ VAT แก้ได้ขณะใช้งาน โดยยอดใหม่ต้องไม่ต่ำกว่ายอดที่จ่ายชำระแล้ว · ระบบลงต้นทุนใหม่ที่วันที่ลงต้นทุนเดิมและปรับต้นทุนใบขายหลัง DN ย้อนหลัง · เดือนที่ประกาศปันผลแล้วแก้ได้เฉพาะผู้มีสิทธิ์ปลดล็อกโดยระบุเหตุผล</p>
      </div>
      {debit.status !== "ACTIVE" ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center text-sm text-red-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300">
          เอกสารนี้ถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้
        </div>
      ) : adjustment ? (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-8 text-center text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
          {SUPPLIER_DEBIT_ADJUSTMENT_EDIT_MESSAGE}
        </div>
      ) : unlinked ? (
        <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-6 py-8 text-center text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
          {SUPPLIER_DEBIT_UNLINKED_EDIT_MESSAGE}
        </div>
      ) : <DebitForm purchase={purchase} initial={initial} lineLock={lineLock} headerLocks={headerLocks} periodLock={periodLock} vatRegisteredFrom={vatRegisteredFrom} />}
    </div>
  );
};
export default EditDebitPage;
