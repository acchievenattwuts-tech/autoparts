export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import ProductForm from "@/components/shared/ProductForm";

const NewProductPage = async () => {
  await requirePermission("products.create");

  const [categories, carBrands, partsBrands, suppliers] = await Promise.all([
    db.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.carBrand.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: {
        carModels: { where: { isActive: true }, orderBy: { name: "asc" } },
      },
    }),
    db.partsBrand.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    }),
  ]);

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/admin/products"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors"
        >
          <ChevronLeft size={16} />
          สินค้าทั้งหมด
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">เพิ่มสินค้าใหม่</span>
      </div>

      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">เพิ่มสินค้าใหม่</h1>

      <ProductForm categories={categories} carBrands={carBrands} partsBrands={partsBrands} suppliers={suppliers} />
    </div>
  );
};

export default NewProductPage;
