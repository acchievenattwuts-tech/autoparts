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
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import ProductForm, { type ProductFormData } from "@/components/shared/ProductForm";
import { INVENTORY_TRACKING_NON_TRACKED } from "@/lib/inventory-tracking";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import { partitionProductFitments } from "@/lib/product-fitment";

interface EditProductPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string }>;
}

const getSafeProductReturnTo = (returnTo?: string) => {
  if (!returnTo) return "/admin/products";
  if (returnTo === "/admin/products" || returnTo.startsWith("/admin/products?")) return returnTo;
  if (returnTo === "/admin/products/search" || returnTo.startsWith("/admin/products/search?")) return returnTo;
  return "/admin/products";
};

const EditProductPage = async ({ params, searchParams }: EditProductPageProps) => {
  await requirePermission("products.update");

  const { id } = await params;
  const { returnTo } = await searchParams;
  const safeReturnTo = getSafeProductReturnTo(returnTo);

  const [product, categories, carBrands, partsBrands, suppliers] = await Promise.all([
    db.product.findUnique({
      where: { id },
      include: {
        aliases: true,
        carModels: {
          select: {
            id: true,
            fitmentType: true,
            carModelId: true,
            submodel: true,
            yearStart: true,
            yearEnd: true,
            engineCode: true,
            engineSize: true,
            note: true,
          },
          orderBy: [{ fitmentType: "asc" }, { carModelId: "asc" }, { yearStart: "asc" }],
        },
        units: { orderBy: { isBase: "desc" } },
        images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      },
    }),
    getActiveCategoryOptions(),
    getActiveCarBrandOptionsWithModels(),
    getActivePartsBrandOptions(),
    db.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true },
    }),
  ]);

  if (!product) {
    notFound();
  }

  const fitmentGroups = partitionProductFitments(product.carModels);

  const productData: ProductFormData = {
    id:               product.id,
    code:             product.code,
    name:             product.name,
    description:      product.description,
    costPrice:        Number(product.costPrice),
    inventoryTracking: product.inventoryTracking,
    isStorefrontVisible: product.isStorefrontVisible,
    salePrice:        Number(product.salePrice),
    retailPrice:      Number(product.retailPrice),
    memberPrice:      Number(product.memberPrice),
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
    fitments:         fitmentGroups.direct.map((cm) => ({
      carModelId: cm.carModelId,
      submodel: cm.submodel,
      yearStart: cm.yearStart,
      yearEnd: cm.yearEnd,
      engineCode: cm.engineCode,
      engineSize: cm.engineSize,
      note: cm.note,
    })),
    compatibleFitments: fitmentGroups.compatible.map((cm) => ({
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
          href={safeReturnTo}
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
          <div className="flex flex-wrap gap-2">
            {product.inventoryTracking === INVENTORY_TRACKING_NON_TRACKED ? (
              <AdminStatusBadge tone="warning">ไม่คำนวณสต็อก</AdminStatusBadge>
            ) : (
              <AdminStatusBadge tone="info">คำนวณสต็อก</AdminStatusBadge>
            )}
            <AdminStatusBadge tone={product.isStorefrontVisible ? "success" : "neutral"}>
              {product.isStorefrontVisible ? "แสดงหน้าบ้าน" : "ซ่อนหน้าบ้าน"}
            </AdminStatusBadge>
          </div>
        }
      />

      <ProductForm categories={categories} carBrands={carBrands} partsBrands={partsBrands} suppliers={suppliers} product={productData} returnTo={safeReturnTo} />
    </div>
  );
};

export default EditProductPage;
