export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getSiteConfig } from "@/lib/site-config";
import SaleForm from "../../new/SaleForm";

const EditSalePage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;

  const [sale, rawProducts, customers, config] = await Promise.all([
    db.sale.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: {
              select: {
                units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
              },
            },
          },
        },
      },
    }),
    db.product.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: {
        id: true, code: true, name: true, description: true,
        salePrice: true, saleUnitName: true, warrantyDays: true,
        category: { select: { name: true } },
        brand:    { select: { name: true } },
        aliases:  { select: { alias: true } },
        units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
      },
    }),
    db.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, phone: true, code: true, shippingAddress: true } }),
    getSiteConfig(),
  ]);

  if (!sale) notFound();
  if (sale.status === "CANCELLED") redirect(`/admin/sales/${id}`);

  const products = rawProducts.map((p) => ({
    id: p.id, code: p.code, name: p.name, description: p.description,
    salePrice: Number(p.salePrice), saleUnitName: p.saleUnitName ?? "",
    warrantyDays: p.warrantyDays ?? 0,
    categoryName: p.category.name, brandName: p.brand?.name ?? null,
    aliases: p.aliases.map((a) => a.alias),
    units: p.units.map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase })),
  }));

  const initialItems = sale.items.map((item) => {
    const baseUnit = item.product.units.find((u) => u.isBase) ?? item.product.units[0];
    return {
      productId:    item.productId,
      unitName:     baseUnit?.name ?? "",
      qty:          Number(item.quantity),   // stored in base units
      salePrice:    Number(item.salePrice),  // stored per original display unit
      warrantyDays: item.warrantyDays ?? 0,
    };
  });

  const initialData = {
    id,
    saleDate:        sale.saleDate.toISOString().slice(0, 10),
    customerId:      sale.customerId ?? "",
    customerName:    sale.customerName ?? "",
    customerPhone:   sale.customerPhone ?? "",
    saleType:        sale.saleType,
    paymentType:     sale.paymentType as "CASH_SALE" | "CREDIT_SALE",
    paymentMethod:   sale.paymentMethod ?? "",
    fulfillmentType: sale.fulfillmentType as "PICKUP" | "DELIVERY",
    shippingAddress: sale.shippingAddress ?? "",
    shippingFee:     Number(sale.shippingFee ?? 0),
    discount:        Number(sale.discount ?? 0),
    note:            sale.note ?? "",
    vatType:         sale.vatType,
    vatRate:         Number(sale.vatRate),
    items:           initialItems,
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href={`/admin/sales/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors">
          <ChevronLeft size={16} /> {sale.saleNo}
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">แก้ไข</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">แก้ไขใบขาย</h1>
      <SaleForm
        products={products}
        customers={customers}
        defaultVatType={config.vatType}
        defaultVatRate={config.vatRate}
        initialData={initialData}
      />
    </div>
  );
};

export default EditSalePage;
