export const dynamic = "force-dynamic";
export const maxDuration = 300; // Vercel Pro ceiling: AI Research rotates up to 10 keys (rate-limited keys fail instantly, so all 10 fit in time)

import { db } from "@/lib/db";
import {
  getActiveCarBrandOptionsWithModels,
  getActiveCategoryOptions,
  getActivePartsBrandOptions,
} from "@/lib/admin-master-options";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import ProductForm from "@/components/shared/ProductForm";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import { getActivePriceListOptions } from "@/lib/pricing/price-list-repository";

const NewProductPage = async () => {
  await requirePermission("products.create");

  const [categories, carBrands, partsBrands, suppliers, priceLists] = await Promise.all([
    getActiveCategoryOptions(),
    getActiveCarBrandOptionsWithModels(),
    getActivePartsBrandOptions(),
    db.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    }),
    getActivePriceListOptions(),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Link
          href="/admin/products"
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-[#1e3a5f] dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} />
          สินค้าทั้งหมด
        </Link>
      </div>

      <AdminPageHeader
        title="เพิ่มสินค้าใหม่"
        description="บันทึกรายละเอียดสินค้า หน่วยนับ สต็อก และการผูกกับรถ"
      />

      <ProductForm categories={categories} carBrands={carBrands} partsBrands={partsBrands} suppliers={suppliers} priceLists={priceLists} />
    </div>
  );
};

export default NewProductPage;
