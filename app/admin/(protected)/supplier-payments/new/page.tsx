export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import SupplierPaymentForm from "../SupplierPaymentForm";

const NewSupplierPaymentPage = async () => {
  await requirePermission("supplier_payments.create");

  const [suppliers, cashBankAccounts] = await Promise.all([
    db.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        code: true,
        phone: true,
      },
    }),
    getActiveCashBankAccountOptions(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Link
          href="/admin/supplier-payments"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f]"
        >
          <ArrowLeft size={16} /> กลับไปรายการจ่ายชำระซัพพลายเออร์
        </Link>
      </div>

      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900">สร้างจ่ายชำระซัพพลายเออร์</h1>
        <p className="mt-1 text-sm text-gray-500">
          บันทึกการจ่ายซื้อเชื่อ และเลือกใช้เครดิต CN ซื้อหรือเงินมัดจำซัพพลายเออร์เพื่อตัดยอดได้ในเอกสารเดียว
        </p>
      </div>

      <SupplierPaymentForm suppliers={suppliers} cashBankAccounts={cashBankAccounts} />
    </div>
  );
};

export default NewSupplierPaymentPage;
