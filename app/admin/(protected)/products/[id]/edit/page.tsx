export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import ProductForm, { type ProductFormData } from "@/components/shared/ProductForm";
import { INVENTORY_TRACKING_NON_TRACKED } from "@/lib/inventory-tracking";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";

interface EditProductPageProps {
  params: Promise<{ id: string }>;
}

const EditProductPage = async ({ params }: EditProductPageProps) => {
  await requirePermission("products.update");

  const { id } = await params;

  const [product, categories, carBrands, partsBrands, suppliers] = await Promise.all([
    db.product.findUnique({
      where: { id },
      include: {
        aliases: true,
        carModels: {
          select: {
            id: true,
            carModelId: true,
            submodel: true,
            yearStart: true,
            yearEnd: true,
            engineCode: true,
            engineSize: true,
            note: true,
          },
          orderBy: [{ carModelId: "asc" }, { yearStart: "asc" }],
        },
        units: { orderBy: { isBase: "desc" } },
        images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
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
    db.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    }),
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
    inventoryTracking: product.inventoryTracking,
    salePrice:        Number(product.salePrice),
    minStock:         product.minStock,
    warrantyDays:     product.warrantyDays,
    shelfLocation:    product.shelfLocation,
    saleUnitName:     product.saleUnitName,
    purchaseUnitName: product.purchaseUnitName,
    reportUnitName:   product.reportUnitName,
    imageUrl:         product.imageUrl,
    productImages:    product.images.map((image) => ({
      url: image.url,
      alt: image.alt,
      sortOrder: image.sortOrder,
      isPrimary: image.isPrimary,
    })),
    categoryId:       product.categoryId,
    brandId:              product.brandId,
    preferredSupplierId:  product.preferredSupplierId,
    isLotControl:         product.isLotControl,
    requireExpiryDate:    product.requireExpiryDate,
    lotIssueMethod:       product.lotIssueMethod,
    allowExpiredIssue:    product.allowExpiredIssue,
    aliases:              product.aliases.map((a) => ({ alias: a.alias, kind: a.kind })),
    fitments:         product.carModels.map((cm) => ({
      carModelId: cm.carModelId,
      submodel: cm.submodel,
      yearStart: cm.yearStart,
      yearEnd: cm.yearEnd,
      engineCode: cm.engineCode,
      engineSize: cm.engineSize,
      note: cm.note,
    })),
    units:            product.units.map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase })),
  };

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
        title={product.name}
        description={`รหัส: ${product.code}`}
        meta={
          product.inventoryTracking === INVENTORY_TRACKING_NON_TRACKED ? (
            <AdminStatusBadge tone="warning">ไม่คำนวณสต็อก</AdminStatusBadge>
          ) : (
            <AdminStatusBadge tone="info">คำนวณสต็อก</AdminStatusBadge>
          )
        }
      />

      <ProductForm categories={categories} carBrands={carBrands} partsBrands={partsBrands} suppliers={suppliers} product={productData} />
    </div>
  );
};

export default EditProductPage;
