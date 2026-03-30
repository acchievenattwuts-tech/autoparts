export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import CreditNoteForm from "./CreditNoteForm";

const NewCreditNotePage = async () => {
  await requirePermission("credit_notes.create");

  const [products, customers, config] = await Promise.all([
    db.product.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: {
        id:           true,
        code:         true,
        name:         true,
        description:  true,
        salePrice:    true,
        saleUnitName: true,
        category: { select: { name: true } },
        brand:    { select: { name: true } },
        aliases:  { select: { alias: true } },
        units: {
          select: { name: true, scale: true, isBase: true },
          orderBy: { isBase: "desc" },
        },
      },
    }),
    db.customer.findMany({
      where:   { isActive: true },
      orderBy: { name: "asc" },
      select:  { id: true, name: true },
    }),
    getSiteConfig(),
  ]);

  const productOptions = products.map((p) => ({
    id:           p.id,
    code:         p.code,
    name:         p.name,
    description:  p.description,
    salePrice:    Number(p.salePrice),
    saleUnitName: p.saleUnitName,
    categoryName: p.category.name,
    brandName:    p.brand?.name ?? null,
    aliases:      p.aliases.map((a) => a.alias),
    units:        p.units.map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase })),
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
      <CreditNoteForm products={productOptions} customers={customers} defaultVatType={config.vatType} defaultVatRate={config.vatRate} />
    </div>
  );
};

export default NewCreditNotePage;
