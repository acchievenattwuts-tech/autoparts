export const dynamic = "force-dynamic";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { db } from "@/lib/db";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import CustomerAdvanceForm from "../CustomerAdvanceForm";
export default async function NewCustomerAdvancePage() {
  await requirePermission("customer_advances.create");
  const { role, permissions } = await getSessionPermissionContext();
  const canPrint = hasPermissionAccess(role, permissions, "customer_advances.view");
  const [customers, accounts] = await Promise.all([db.customer.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, phone: true } }), getActiveCashBankAccountOptions()]);
  return <div><div className="mb-6 flex items-center gap-2"><Link href="/admin/customer-advances" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"><ChevronLeft size={16} /> รับเงินมัดจำลูกค้า</Link><span className="text-gray-300 dark:text-slate-600">/</span><span className="text-sm text-gray-700 dark:text-slate-300">สร้างเอกสารใหม่</span></div><h1 className="mb-6 font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">บันทึกรับเงินมัดจำลูกค้า</h1><CustomerAdvanceForm customers={customers} cashBankAccounts={accounts} canPrint={canPrint} /></div>;
}
