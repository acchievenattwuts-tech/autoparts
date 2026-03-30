export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import ProductForm, { type ProductFormData } from "@/components/shared/ProductForm";

interface EditProductPageProps {
  params: Promise<{ id: string }>;
}

const EditProductPage = async ({ params }: EditProductPageProps) => {
  await requirePermission("products.update");

  const { id } = await params;

  const [product, categories, carBrands, partsBrands] = await Promise.all([
    db.product.findUnique({
      where: { id },
      include: {
        aliases: true,
        carModels: { select: { carModelId: true } },
        units: { orderBy: { isBase: "desc" } },
      },
    }),
    db.category.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.carBrand.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: {
        carModels: { where: { isActive: true }, orderBy: { name: "asc" } },
      },
    }),
    db.partsBrand.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
  ]);

  if (!product) {
    notFound();
  }

  const productData: ProductFormData = {
    id:               product.id,
    code:             product.code,
    name:             product.name,
    description:      product.description,
    costPrice:        Number(product.costPrice),
    salePrice:        Number(product.salePrice),
    minStock:         product.minStock,
    warrantyDays:     product.warrantyDays,
    shelfLocation:    product.shelfLocation,
    saleUnitName:     product.saleUnitName,
    purchaseUnitName: product.purchaseUnitName,
    reportUnitName:   product.reportUnitName,
    imageUrl:         product.imageUrl,
    categoryId:       product.categoryId,
    brandId:          product.brandId,
    aliases:          product.aliases.map((a) => ({ alias: a.alias })),
    carModels:        product.carModels.map((cm) => ({ carModelId: cm.carModelId })),
    units:            product.units.map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase })),
  };

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

      <ProductForm categories={categories} carBrands={carBrands} partsBrands={partsBrands} product={productData} />
    </div>
  );
};

export default EditProductPage;
