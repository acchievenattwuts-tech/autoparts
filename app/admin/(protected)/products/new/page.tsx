import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import ProductForm from "@/components/shared/ProductForm";

const NewProductPage = async () => {
  const [categories, carBrands, partsBrands] = await Promise.all([
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.carBrand.findMany({
      orderBy: { name: "asc" },
      include: {
        carModels: { orderBy: { name: "asc" } },
      },
    }),
    db.partsBrand.findMany({ orderBy: { name: "asc" } }),
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

      <ProductForm categories={categories} carBrands={carBrands} partsBrands={partsBrands} />
    </div>
  );
};

export default NewProductPage;
