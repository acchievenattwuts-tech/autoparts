export const dynamic = "force-dynamic";
export const maxDuration = 200; // Vercel Pro: must match createPurchaseReturn tx timeout (180s) + response time

import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { requirePermission } from "@/lib/require-auth";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import PurchaseReturnForm from "./PurchaseReturnForm";
import { getOriginalClaimUnitCost } from "@/lib/claim-stock";
import { getThailandDateKey } from "@/lib/th-date";
import { getTransactionSuppliers } from "@/lib/transaction-options";
import { isInventoryTracked } from "@/lib/inventory-tracking";

const NewPurchaseReturnPage = async ({
  searchParams,
}: {
  searchParams?: Promise<{ claimId?: string }>;
}) => {
  await requirePermission("purchase_returns.create");
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const claimId = resolvedSearchParams?.claimId?.trim() || undefined;

  const [config, cashBankAccounts, linkedClaim] = await Promise.all([
    getSiteConfig(),
    getActiveCashBankAccountOptions(),
    claimId
      ? db.warrantyClaim.findUnique({
          where: { id: claimId },
          select: {
            id: true,
            claimNo: true,
            warrantyId: true,
            supplierId: true,
            supplier: { select: { id: true, name: true } },
            warranty: {
              select: {
                productId: true,
                product: {
                  select: {
                    id: true,
                    code: true,
                    name: true,
                    description: true,
                    avgCost: true,
                    inventoryTracking: true,
                    isLotControl: true,
                    purchaseUnitName: true,
                    category: { select: { name: true } },
                    brand: { select: { name: true } },
                    aliases: { select: { alias: true } },
                    units: {
                      select: { name: true, scale: true, isBase: true },
                      orderBy: { isBase: "desc" },
                    },
                  },
                },
              },
            },
          },
        })
      : Promise.resolve(null),
  ]);

  const [productRows, supplierOptions] = await Promise.all([
    db.product.findMany({
      orderBy: { code: "asc" },
      select: {
        id: true, code: true, name: true, description: true, avgCost: true, costPrice: true, isActive: true,
        inventoryTracking: true, isLotControl: true,
        category: { select: { name: true } }, brand: { select: { name: true } },
        aliases: { select: { alias: true } },
        units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } },
      },
    }),
    getTransactionSuppliers([linkedClaim?.supplierId]),
  ]);

  const products = productRows.map((p) => ({
    id: p.id, code: p.code, name: p.name, description: p.description,
    avgCost: Number(p.avgCost), costPrice: Number(p.costPrice), inventoryTracking: p.inventoryTracking,
    isLotControl: isInventoryTracked(p.inventoryTracking) && p.isLotControl,
    categoryName: p.category.name, brandName: p.brand?.name ?? null,
    aliases: p.aliases.map((a) => a.alias),
    units: p.units.map((u) => ({ name: u.name, scale: Number(u.scale), isBase: u.isBase })),
    isActive: p.isActive,
  }));

  const originalCost = linkedClaim
    ? await db.$transaction((tx) => getOriginalClaimUnitCost(tx, linkedClaim.warrantyId))
    : null;
  const claimProduct = linkedClaim?.warranty.product;
  const claimPurchaseUnit = claimProduct?.units.find((unit) => unit.name === claimProduct.purchaseUnitName)
    ?? claimProduct?.units.find((unit) => unit.isBase)
    ?? claimProduct?.units[0];
  const claimUnitScale = claimPurchaseUnit ? Number(claimPurchaseUnit.scale) : 1;
  const initialPurchases = linkedClaim?.supplierId
    ? await db.purchase.findMany({
        where: { supplierId: linkedClaim.supplierId },
        orderBy: { purchaseDate: "desc" },
        take: 200,
        select: { id: true, purchaseNo: true, purchaseDate: true },
      })
    : [];
  const prefillData =
    linkedClaim && claimProduct && originalCost
      ? {
          returnDate: getThailandDateKey(),
          purchaseId: "",
          claimId: linkedClaim.id,
          supplierId: linkedClaim.supplierId ?? "",
          type: "OTHER" as const,
          settlementType: "SUPPLIER_CREDIT" as const,
          cashBankAccountId: "",
          note: `ใบลดหนี้ซื้อจากใบเคลม ${linkedClaim.claimNo}`,
          vatType: config.vatType,
          vatRate: config.vatRate,
          items: [
            {
              productId: claimProduct.id,
              unitName: claimPurchaseUnit?.name ?? "",
              qty: 1,
              costPrice: originalCost.unitCost * claimUnitScale,
              lotItems: [],
            },
          ],
        }
      : undefined;
  const claimContext =
    linkedClaim && claimProduct
      ? {
          id: linkedClaim.id,
          claimNo: linkedClaim.claimNo,
          supplierName: linkedClaim.supplier?.name ?? null,
          productId: claimProduct.id,
          productCode: claimProduct.code,
          productName: claimProduct.name,
        }
      : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/admin/purchase-returns"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors dark:text-slate-400 dark:hover:text-sky-300"
        >
          <ChevronLeft size={16} /> รายการคืนสินค้า
        </Link>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">บันทึกคืนสินค้าใหม่</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100 mb-6">คืนสินค้าให้ซัพพลายเออร์</h1>
      <PurchaseReturnForm
        products={products}
        suppliers={supplierOptions}
        cashBankAccounts={cashBankAccounts}
        initialPurchases={initialPurchases}
        defaultVatType={config.vatType}
        defaultVatRate={config.vatRate}
        prefillData={prefillData}
        claimId={claimId}
        claimContext={claimContext}
      />
    </div>
  );
};

export default NewPurchaseReturnPage;
