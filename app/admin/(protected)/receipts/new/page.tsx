export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import ReceiptForm from "./ReceiptForm";

const NewReceiptPage = async () => {
  const customers = await db.customer.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select:  { id: true, name: true, code: true },
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

      <ReceiptForm customers={customers} />
    </div>
  );
};

export default NewReceiptPage;
