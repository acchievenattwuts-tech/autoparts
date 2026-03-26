export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ShieldCheck, ChevronRight } from "lucide-react";
import NewWarrantyForm from "./NewWarrantyForm";

const NewWarrantyPage = async () => {
  const since = new Date();
  since.setDate(since.getDate() - 60);

  const recentSales = await db.sale.findMany({
    where: {
      status: "ACTIVE",
      saleDate: { gte: since },
    },
    orderBy: { saleDate: "desc" },
    take: 100,
    select: {
      id: true,
      saleNo: true,
      saleDate: true,
      customerName: true,
    },
  });

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link href="/admin/warranties" className="hover:text-[#1e3a5f]">ประกันสินค้า</Link>
        <ChevronRight size={14} />
        <span className="text-gray-900">บันทึกประกันใหม่</span>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <ShieldCheck size={22} className="text-[#1e3a5f]" />
        <h1 className="font-kanit text-2xl font-bold text-gray-900">บันทึกประกันสินค้า</h1>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
        <NewWarrantyForm recentSales={recentSales} />
      </div>
    </div>
  );
};

export default NewWarrantyPage;
