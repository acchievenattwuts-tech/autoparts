export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import ReceiptForm from "./ReceiptForm";

const NewReceiptPage = async () => {
  await requirePermission("receipts.create");

  // Get customers with outstanding Sale AR balance
  const [saleBalances, cnBalances, cashBankAccounts] = await Promise.all([
    db.sale.groupBy({
    by:    ["customerId"],
    where: {
      customerId:   { not: null },
      status:       "ACTIVE",
      paymentType:  "CREDIT_SALE",
      amountRemain: { gt: 0 },
    },
    _sum: { amountRemain: true },
    }),

  // Get customers with unused CREDIT_DEBT credit notes
    db.creditNote.groupBy({
    by:    ["customerId"],
    where: {
      customerId:     { not: null },
      status:         "ACTIVE",
      settlementType: "CREDIT_DEBT",
      amountRemain:   { gt: 0 },
    },
    _sum: { amountRemain: true },
    }),
    getActiveCashBankAccountOptions(),
  ]);

  // Merge all customer IDs that have any outstanding balance or CN credit
  const allCustomerIds = [
    ...new Set([
      ...saleBalances.map((b) => b.customerId).filter((id): id is string => id !== null),
      ...cnBalances.map((b) => b.customerId).filter((id): id is string => id !== null),
    ]),
  ];

  const customerRows = await db.customer.findMany({
    where:   { id: { in: allCustomerIds }, isActive: true },
    select:  { id: true, name: true, code: true },
    orderBy: { name: "asc" },
  });

  const saleBalanceMap = new Map(
    saleBalances
      .filter((balance): balance is typeof balance & { customerId: string } => balance.customerId !== null)
      .map((balance) => [balance.customerId, Number(balance._sum.amountRemain ?? 0)]),
  );
  const cnBalanceMap = new Map(
    cnBalances
      .filter((balance): balance is typeof balance & { customerId: string } => balance.customerId !== null)
      .map((balance) => [balance.customerId, Number(balance._sum.amountRemain ?? 0)]),
  );

  const customers = customerRows.map((c) => {
    const saleSum = saleBalanceMap.get(c.id) ?? 0;
    const cnSum   = cnBalanceMap.get(c.id) ?? 0;
    return {
      ...c,
      amountRemain: saleSum - cnSum, // net outstanding (sale AR minus CN credits)
    };
  });

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

      <ReceiptForm customers={customers} cashBankAccounts={cashBankAccounts} />
    </div>
  );
};

export default NewReceiptPage;
