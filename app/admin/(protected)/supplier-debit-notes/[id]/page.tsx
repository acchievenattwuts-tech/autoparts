import Link from "next/link";
import type { JSX } from "react";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePermission, getSessionPermissionContext } from "@/lib/require-auth";
import { hasPermissionAccess } from "@/lib/access-control";
import { formatDateThai } from "@/lib/th-date";
import { createDocumentMutationGuard, buildMutationBlockMessage, buildMutationBlockReferenceLinks, type GuardDb } from "@/lib/document-mutation-guard";
import { getDocumentActivityTimeline } from "@/lib/document-activity";
import DocumentActivityTimeline from "@/components/admin/DocumentActivityTimeline";
import CancelDebitButton from "../CancelDebitButton";

export const dynamic = "force-dynamic";
const loadDebitDetail = async ({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) => {
  try {
  await requirePermission("supplier_debit_notes.view");
  const { id } = await params;
  const { created } = await searchParams;
  const { role, permissions } = await getSessionPermissionContext();
  const debit = await db.supplierDebitNote.findUnique({ where: { id }, include: {
    supplier: { select: { name: true } }, purchase: { select: { id: true, purchaseNo: true } },
    items: { orderBy: { lineNo: "asc" }, include: { product: { select: { code: true, name: true } } } },
    supplierPaymentItems: { where: { payment: { status: "ACTIVE" } }, include: { payment: { select: { id: true, paymentNo: true } } } },
  } });
  if (!debit) notFound();
  const cancelBlock = debit.status === "ACTIVE" ? await createDocumentMutationGuard(db as unknown as GuardDb).check("SupplierDebitNote", id, "cancel") : null;
  const reason = cancelBlock ? buildMutationBlockMessage(cancelBlock) : null;
  const blockLinks = cancelBlock ? buildMutationBlockReferenceLinks(cancelBlock) : [];
  const activity = await getDocumentActivityTimeline("SupplierDebitNote", id);
  return { id, created, role, permissions, debit, reason, blockLinks, activity };
  } catch (error) { console.error("[supplier-DN detail]", error); throw error; }
};

const DebitDetailPage = async ({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }): Promise<JSX.Element> => {
  const { id, created, role, permissions, debit, reason, blockLinks, activity } = await loadDebitDetail({ params, searchParams });
  const money = (value: unknown) => Number(value).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return <div className="space-y-5 text-slate-900 dark:text-slate-100">
    <Link href="/admin/supplier-debit-notes" className="text-sky-800 dark:text-sky-300">กลับรายการ DN</Link>
    <h1 className="text-2xl font-semibold">{debit.debitNo} · {debit.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิก"}</h1>
    {created === "1" && debit.status === "ACTIVE" && <p role="status" className="rounded border border-emerald-200 bg-emerald-50 p-3 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">บันทึกใบเพิ่มหนี้ {debit.debitNo} สำเร็จ</p>}
    <div className="grid gap-2 rounded border border-slate-200 p-4 sm:grid-cols-2 dark:border-slate-700">
      <p>supplier: {debit.supplier.name}</p><p>เลข supplier: {debit.supplierReferenceNo}</p>
      <p>ใบซื้อเดิม: <Link href={`/admin/purchases/${debit.purchase.id}`} className="text-sky-800 dark:text-sky-300">{debit.purchase.purchaseNo}</Link></p>
      <p>วันที่ออก: {formatDateThai(debit.debitDate)} · ได้รับ: {formatDateThai(debit.receivedDate)}</p>
      <p>ลงต้นทุน: {formatDateThai(debit.postingDate)}</p><p>ครบกำหนด: {formatDateThai(debit.dueDate)}</p>
      <p>เหตุผล: {debit.reason}</p><p>หมายเหตุ: {debit.note || "-"}</p>
    </div>
    <div className="grid gap-3 rounded bg-sky-50 p-4 sm:grid-cols-3 dark:bg-sky-950">
      <p>ก่อน VAT {money(debit.subtotalAmount)}</p><p>VAT {money(debit.vatAmount)} ({debit.vatRecoverable ? "ใช้ภาษีซื้อ" : "รวมในต้นทุน"})</p><p>เจ้าหนี้เพิ่ม {money(debit.netAmount)}</p>
      <p>เพิ่มมูลค่าสต็อก {money(debit.inventoryAmount)}</p><p>ส่วนต่างต้นทุนงวด DN {money(debit.varianceAmount)}</p><p>ค้างจ่าย {money(debit.amountRemain)}</p>
    </div>
    <p className="text-sm text-slate-600 dark:text-slate-400">ใช้ stock coverage รวมของ SKU ณ ลงรายการ · ไม่ปรับต้นทุนใบขายเดิม · จำนวนสินค้าไม่เปลี่ยน</p>
    <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-100 dark:bg-slate-800"><tr>
      {['สินค้า', 'จำนวนปรับ', 'ราคาเดิม', 'ส่วนต่างกรอก', 'เข้าสต็อก', 'ส่วนต่างงวดนี้', 'MAVG ก่อน → หลัง'].map((label) => <th className="p-2 text-left" key={label}>{label}</th>)}
    </tr></thead><tbody>{debit.items.map((item) => <tr key={item.id} className="border-b border-slate-200 dark:border-slate-700">
      <td className="p-2"><Link href={`/admin/stock/card?productId=${item.productId}`} className="text-sky-800 dark:text-sky-300">{item.product.code} · {item.product.name}</Link></td>
      <td>{Number(item.affectedQuantity)} {item.showUnitName}</td><td>{money(item.originalUnitPrice)}</td><td>{money(item.increaseAmount)} {item.amountMode === "TOTAL" ? "รวมรายการ" : `ต่อ ${item.showUnitName}`}</td>
      <td>{money(item.inventoryAmount)}</td><td>{money(item.varianceAmount)}</td><td>{money(item.avgCostBefore)} → {money(item.avgCostAfter)} / หน่วยฐาน</td>
    </tr>)}</tbody></table></div>
    <div className="space-y-2">{debit.supplierPaymentItems.map((item) => <p key={item.id}>ชำระ <Link href={`/admin/supplier-payments/${item.payment.id}`} className="text-sky-800 dark:text-sky-300">{item.payment.paymentNo}</Link> · {money(item.paidAmount)}</p>)}</div>
    {debit.status === "ACTIVE" && hasPermissionAccess(role, permissions, "supplier_debit_notes.cancel") && (reason
      ? <div className="rounded bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200"><p>ยกเลิกไม่ได้: {reason}</p>
        {blockLinks.map((link) => <Link key={link.href} href={link.href} className="mr-3 underline">{link.label}</Link>)}</div>
      : <CancelDebitButton id={id} />)}
    {debit.cancelNote && <p>เหตุผลยกเลิก: {debit.cancelNote}</p>}
    <DocumentActivityTimeline events={activity} />
  </div>;
};
export default DebitDetailPage;
