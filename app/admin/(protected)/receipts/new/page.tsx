export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import ReceiptForm from "./ReceiptForm";

const NewReceiptPage = async () => {
  await requirePermission("receipts.create");

  // Only show customers with outstanding AR balance
  const arBalances = await db.sale.groupBy({
    by:    ["customerId"],
    where: {
      customerId:  { not: null },
      status:      "ACTIVE",
      paymentType: "CREDIT_SALE",
      amountRemain: { gt: 0 },
    },
    _sum: { amountRemain: true },
  });

  const customerIds = arBalances
    .map((b) => b.customerId)
    .filter((id): id is string => id !== null);

  const customerRows = await db.customer.findMany({
    where:   { id: { in: customerIds }, isActive: true },
    select:  { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });

  const customers = customerRows.map((c) => ({
    ...c,
    amountRemain: Number(
      arBalances.find((b) => b.customerId === c.id)?._sum.amountRemain ?? 0
    ),
  }));

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/admin/receipts"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors"
        >
          <ChevronLeft size={16} /> ใบเสร็จรับเงิน
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">สร้างใบเสร็จใหม่</span>
      </div>

      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">สร้างใบเสร็จรับเงิน</h1>

      <ReceiptForm customers={customers} />
    </div>
  );
};

export default NewReceiptPage;
