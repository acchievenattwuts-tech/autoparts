export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import CreditNoteForm from "./CreditNoteForm";

const NewCreditNotePage = async () => {
  const [products, sales] = await Promise.all([
    db.product.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: {
        id:           true,
        code:         true,
        name:         true,
        salePrice:    true,
        saleUnitName: true,
        units: {
          select: { name: true, scale: true, isBase: true },
          orderBy: { isBase: "desc" },
        },
      },
    }),
    db.sale.findMany({
      orderBy: { saleDate: "desc" },
      take:    50,
      select: {
        id:           true,
        saleNo:       true,
        customerName: true,
        saleDate:     true,
      },
    }),
  ]);

  const productOptions = products.map((p) => ({
    id:           p.id,
    code:         p.code,
    name:         p.name,
    salePrice:    Number(p.salePrice),
    saleUnitName: p.saleUnitName,
    units:        p.units.map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase })),
  }));

  const saleOptions = sales.map((s) => ({
    id:           s.id,
    saleNo:       s.saleNo,
    customerName: s.customerName,
    saleDate:     s.saleDate,
  }));

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/admin/credit-notes"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors"
        >
          <ChevronLeft size={16} /> รายการ Credit Note
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">สร้าง CN ใหม่</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">สร้างใบลดหนี้ (Credit Note)</h1>
      <CreditNoteForm products={productOptions} sales={saleOptions} />
    </div>
  );
};

export default NewCreditNotePage;
