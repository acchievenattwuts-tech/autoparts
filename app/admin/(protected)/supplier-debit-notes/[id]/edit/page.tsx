import Link from "next/link";
import type { JSX } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { formatDateOnlyForInput, formatDateThai } from "@/lib/th-date";
import { createDocumentMutationGuard, buildMutationBlockMessage, buildMutationBlockReferenceLinks, type GuardDb } from "@/lib/document-mutation-guard";
import DebitForm, { type DebitFormInitial, type DebitLineLock } from "../../DebitForm";
import { debitPurchaseSelect, toDebitPurchase } from "../../debit-purchase";

export const dynamic = "force-dynamic";
export const metadata = { title: "แก้ไขใบเพิ่มหนี้ซัพพลายเออร์" };

const loadEditDebit = async ({ params }: { params: Promise<{ id: string }> }) => {
  try {
    await requirePermission("supplier_debit_notes.update");
    const { id } = await params;
    const debit = await db.supplierDebitNote.findUnique({ where: { id }, include: {
      items: { orderBy: { lineNo: "asc" }, select: { purchaseItemId: true, affectedQuantity: true, increaseAmount: true, amountMode: true } },
      purchase: { select: debitPurchaseSelect },
    } });
    if (!debit) notFound();
    const block = debit.status === "ACTIVE"
      ? await createDocumentMutationGuard(db as unknown as GuardDb).check("SupplierDebitNote", id, "update") : null;
    const reason = block ? buildMutationBlockMessage(block) : null;
    const lineLock: DebitLineLock | null = block && reason ? { reason, links: buildMutationBlockReferenceLinks(block) } : null;
    const initial: DebitFormInitial = { id: debit.id, debitNo: debit.debitNo, postingDate: formatDateThai(debit.postingDate),
      supplierReferenceNo: debit.supplierReferenceNo, debitDate: formatDateOnlyForInput(debit.debitDate),
      receivedDate: formatDateOnlyForInput(debit.receivedDate), dueDate: formatDateOnlyForInput(debit.dueDate),
      reason: debit.reason, note: debit.note ?? "", vatType: debit.vatType, vatRate: Number(debit.vatRate), vatRecoverable: debit.vatRecoverable,
      items: debit.items.map((item) => ({ purchaseItemId: item.purchaseItemId, affectedQuantity: Number(item.affectedQuantity),
        increaseAmount: Number(item.increaseAmount), amountMode: item.amountMode })) };
    return { debit, initial, lineLock, purchase: toDebitPurchase(debit.purchase) };
  } catch (error) { console.error("[supplier-DN edit]", error); throw error; }
};

const EditDebitPage = async ({ params }: { params: Promise<{ id: string }> }): Promise<JSX.Element> => {
  const { debit, initial, lineLock, purchase } = await loadEditDebit({ params });
  return (
    <div className="space-y-6">
      <Link href={`/admin/supplier-debit-notes/${debit.id}`} className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300">
        <ArrowLeft size={16} /> กลับไปดูรายละเอียดเอกสาร
      </Link>
      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">แก้ไขใบเพิ่มหนี้ <span className="font-mono">{debit.debitNo}</span></h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">หัวเอกสารแก้ได้ตลอดขณะใช้งาน · รายการ ยอด และ VAT แก้ได้เมื่อยังไม่มีการจ่ายชำระและไม่มีสต็อกเคลื่อนไหวหลัง DN</p>
      </div>
      {debit.status !== "ACTIVE" ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center text-sm text-red-700 dark:border-rose-400/30 dark:bg-rose-500/10 dark:text-rose-300">
          เอกสารนี้ถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้
        </div>
      ) : <DebitForm purchase={purchase} initial={initial} lineLock={lineLock} />}
    </div>
  );
};
export default EditDebitPage;
