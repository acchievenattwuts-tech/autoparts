export const dynamic = "force-dynamic";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { formatDateOnlyForInput } from "@/lib/th-date";
import { buildMutationBlockMessage, buildMutationBlockReferenceLinks, checkDocumentMutation } from "@/lib/document-mutation-guard";
import DocumentMutationBlockedNotice from "@/components/shared/DocumentMutationBlockedNotice";
import CustomerAdvanceForm from "../../CustomerAdvanceForm";
export default async function EditCustomerAdvancePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("customer_advances.update"); const { role, permissions } = await getSessionPermissionContext(); const canPrint = hasPermissionAccess(role, permissions, "customer_advances.view"); const { id } = await params;
  const [advance, customers, accounts, payments] = await Promise.all([
    db.customerAdvance.findUnique({ where: { id }, select: { id: true, advanceNo: true, advanceDate: true, customerId: true, totalAmount: true, cashBankAccountId: true, note: true, status: true } }),
    db.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, phone: true } }), getActiveCashBankAccountOptions(),
    db.documentPayment.findMany({ where: { docType: "CUSTOMER_ADVANCE", docId: id }, orderBy: [{ lineNo: "asc" }, { id: "asc" }], select: { cashBankAccountId: true, amount: true } }),
  ]);
  if (!advance) notFound(); if (advance.status === "CANCELLED") redirect(`/admin/customer-advances/${id}`);
  const mutation = await checkDocumentMutation("CustomerAdvance", id, "update"); const message = buildMutationBlockMessage(mutation);
  return <div><div className="mb-6 flex items-center gap-2"><Link href={`/admin/customer-advances/${id}`} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"><ChevronLeft size={16} /> {advance.advanceNo}</Link><span className="text-gray-300 dark:text-slate-600">/</span><span className="text-sm text-gray-700 dark:text-slate-300">แก้ไข</span></div><h1 className="mb-6 font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">แก้ไขรับเงินมัดจำลูกค้า</h1>{message ? <div className="mb-6"><DocumentMutationBlockedNotice message={message} references={buildMutationBlockReferenceLinks(mutation)} /></div> : null}<CustomerAdvanceForm customers={customers} cashBankAccounts={accounts} submitLocked={Boolean(message)} canPrint={canPrint} initialData={{ id, customerId: advance.customerId, advanceDate: formatDateOnlyForInput(advance.advanceDate), totalAmount: Number(advance.totalAmount), cashBankAccountId: advance.cashBankAccountId ?? "", payments: payments.map((row) => ({ cashBankAccountId: row.cashBankAccountId, amount: Number(row.amount) })), note: advance.note ?? "" }} /></div>;
}
