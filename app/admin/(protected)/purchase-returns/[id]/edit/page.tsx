export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getSiteConfig } from "@/lib/site-config";
import PurchaseReturnForm from "../../new/PurchaseReturnForm";

const EditPurchaseReturnPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;

  const [ret, rawProducts, suppliers, purchases, config] = await Promise.all([
    db.purchaseReturn.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: { units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } } },
            },
          },
        },
      },
    }),
    db.product.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: {
        id: true, code: true, name: true, description: true, avgCost: true,
        category: { select: { name: true } }, brand: { select: { name: true } },
        aliases:  { select: { alias: true } },
        units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
      },
    }),
    db.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.purchase.findMany({ orderBy: { purchaseDate: "desc" }, take: 30, select: { id: true, purchaseNo: true } }),
    getSiteConfig(),
  ]);

  if (!ret) notFound();
  if (ret.status === "CANCELLED") redirect(`/admin/purchase-returns/${id}`);

  const products = rawProducts.map((p) => ({
    id: p.id, code: p.code, name: p.name, description: p.description, avgCost: Number(p.avgCost),
    categoryName: p.category.name, brandName: p.brand?.name ?? null,
    aliases: p.aliases.map((a) => a.alias),
    units: p.units.map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase })),
  }));

  const initialItems = ret.items.map((item) => {
    const baseUnit = item.product.units.find((u) => u.isBase) ?? item.product.units[0];
    return {
      productId: item.productId,
      unitName:  baseUnit?.name ?? "",
      qty:       Number(item.qty),
    };
  });

  const initialData = {
    id,
    returnDate: ret.returnDate.toISOString().slice(0, 10),
    purchaseId: ret.purchaseId ?? "",
    supplierId: ret.supplierId ?? "",
    note:       ret.note ?? "",
    vatType:    ret.vatType,
    vatRate:    Number(ret.vatRate),
    items:      initialItems,
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href={`/admin/purchase-returns/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> {ret.returnNo}
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">แก้ไข</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">แก้ไขใบคืนสินค้า</h1>
      <PurchaseReturnForm
        products={products}
        suppliers={suppliers}
        purchases={purchases}
        defaultVatType={config.vatType}
        defaultVatRate={config.vatRate}
        initialData={initialData}
      />
    </div>
  );
};

export default EditPurchaseReturnPage;
