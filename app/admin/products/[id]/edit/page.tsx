import { db } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import ProductForm from "@/components/shared/ProductForm";

interface EditProductPageProps {
  params: Promise<{ id: string }>;
}

const EditProductPage = async ({ params }: EditProductPageProps) => {
  const { id } = await params;

  const [product, categories, carBrands] = await Promise.all([
    db.product.findUnique({
      where: { id },
      include: {
        aliases: true,
        carModels: { select: { carModelId: true } },
      },
    }),
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.carBrand.findMany({
      orderBy: { name: "asc" },
      include: {
        carModels: { orderBy: { name: "asc" } },
      },
    }),
  ]);

  if (!product) {
    notFound();
  }

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
        <span className="text-sm font-medium text-gray-700">แก้ไขสินค้า</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900">{product.name}</h1>
          <p className="text-sm text-gray-500 mt-1">รหัส: {product.code}</p>
        </div>
      </div>

      <ProductForm categories={categories} carBrands={carBrands} product={product} />
    </div>
  );
};

export default EditProductPage;
