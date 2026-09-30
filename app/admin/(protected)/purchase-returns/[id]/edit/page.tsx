export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getSiteConfig } from "@/lib/site-config";
import { formatDateOnlyForInput } from "@/lib/th-date";
import {
  buildMutationBlockMessage,
  buildMutationBlockReferenceLinks,
  buildStockDebitEditWarning,
  checkDocumentMutation,
  checkDocumentStockDebitWarning,
} from "@/lib/document-mutation-guard";
import DocumentMutationBlockedNotice from "@/components/shared/DocumentMutationBlockedNotice";
import PurchaseReturnForm from "../../new/PurchaseReturnForm";
import { getPurchaseReturnProductOptionsByIds, getTransactionSuppliers } from "@/lib/transaction-options";
import { getDocumentPeriodLockView } from "@/lib/period-lock-document";
import { PURCHASE_RETURN_PERIOD_LOCK_ALLOWED_EDITS_HINT } from "../../purchase-return-period-lock";
import { postsPurchaseAllowance } from "@/lib/purchase-allowance";

const EditPurchaseReturnPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const session = await requirePermission("purchase_returns.update");

  const { id } = await params;

  const ret = await db.purchaseReturn.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: [{ lineNo: "asc" }, { id: "asc" }],
        include: {
          product: {
            select: { units: { select: { name: true, scale: true, isBase: true }, orderBy: { isBase: "desc" } } },
          },
          lotItems: { orderBy: { id: "asc" }, select: { lotNo: true, qty: true } },
        },
      },
      // V3: the return must use the referenced purchase's VAT.
      purchase: { select: { vatType: true, vatRate: true, taxInvoiceDate: true } },
      claim: {
        select: {
          id: true,
          claimNo: true,
          supplier: { select: { name: true } },
          warranty: {
            select: {
              productId: true,
              product: { select: { code: true, name: true } },
            },
          },
        },
      },
    },
  });

  if (!ret) notFound();
  if (ret.status === "CANCELLED") redirect(`/admin/purchase-returns/${id}`);

  const returnPayments = await db.documentPayment.findMany({
    where: { docType: "CN_PURCHASE", docId: id },
    orderBy: [{ lineNo: "asc" }, { id: "asc" }],
    select: { cashBankAccountId: true, amount: true },
  });

  const [mutationBlock, stockDebitWarning, periodLock] = await Promise.all([
    checkDocumentMutation("PurchaseReturn", id, "update"),
    // Lines before an active supplier DN: a warning only; updatePurchaseReturn blocks just the rows it rewrites.
    checkDocumentStockDebitWarning("PurchaseReturn", id),
    // Month already distributed: same message updatePurchaseReturn returns (lib/period-lock.ts). A DISCOUNT/OTHER
    // return's ลดราคาซื้อ is posted on its creation date (V8), whose month a cost change also needs open.
    getDocumentPeriodLockView(postsPurchaseAllowance(ret) ? [ret.returnDate, ret.createdAt] : [ret.returnDate],
      session.user.permissions),
  ]);
  const mutationBlockMessage = buildMutationBlockMessage(mutationBlock);
  const mutationBlockReferences = buildMutationBlockReferenceLinks(mutationBlock);
  const stockDebitWarningMessage = mutationBlockMessage ? null : buildStockDebitEditWarning(stockDebitWarning);
  const stockDebitWarningReferences = buildMutationBlockReferenceLinks(stockDebitWarning);

  const [products, suppliers, config, cashBankAccounts] = await Promise.all([
    getPurchaseReturnProductOptionsByIds(ret.items.map((item) => item.productId)),
    getTransactionSuppliers([ret.supplierId]),
    getSiteConfig(),
    getActiveCashBankAccountOptions(),
  ]);

  const initialPurchases = ret.supplierId
    ? await db.purchase.findMany({
        // Only ACTIVE purchases can be referenced; keep the one this return already uses.
        where:   ret.purchaseId
          ? { supplierId: ret.supplierId, OR: [{ status: "ACTIVE" }, { id: ret.purchaseId }] }
          : { supplierId: ret.supplierId, status: "ACTIVE" },
        orderBy: { purchaseDate: "desc" },
        take:    200,
        select:  { id: true, purchaseNo: true, purchaseDate: true },
      })
    : [];

  const initialItems = ret.items.map((item) => {
    const baseUnit = item.product.units.find((u) => u.isBase) ?? item.product.units[0];
    const displayUnitName = item.showUnitName ?? baseUnit?.name ?? "";
    const displayScale = Number(item.unitScale ?? baseUnit?.scale ?? 1) || 1;
    const displayQty = item.showQty != null ? Number(item.showQty) : Number(item.qty) / displayScale;
    const displayCostPrice =
      item.showPricePerUnit != null
        ? Number(item.showPricePerUnit)
        : Number(item.costPrice) * displayScale;
    return {
      productId: item.productId,
      unitName:  displayUnitName,
      qty:       displayQty,
      costPrice: displayCostPrice,
      moreDetail: item.moreDetail ?? "",
      lotItems: item.lotItems.map((lot) => ({
        lotNo: lot.lotNo,
        qty: Number(lot.qty) / displayScale,
        unitCost: displayCostPrice,
        mfgDate: "",
        expDate: "",
      })),
    };
  });

  const initialData = {
    id,
    updatedAt: ret.updatedAt.toISOString(),
      returnDate: formatDateOnlyForInput(ret.returnDate),
    purchaseId: ret.purchaseId ?? "",
    claimId: ret.claimId ?? "",
    supplierId: ret.supplierId ?? "",
    type: ret.type,
    settlementType: ret.settlementType,
    cashBankAccountId: ret.cashBankAccountId ?? "",
    payments: returnPayments.map((row) => ({
      cashBankAccountId: row.cashBankAccountId,
      amount: Number(row.amount),
    })),
    note:       ret.note ?? "",
    vatType:    ret.vatType,
    vatRate:    Number(ret.vatRate),
    taxInvoiceNo: ret.taxInvoiceNo ?? "",
    taxInvoiceDate: ret.taxInvoiceDate ? formatDateOnlyForInput(ret.taxInvoiceDate) : "",
    purchaseVat: ret.purchase
      ? {
          vatType: ret.purchase.vatType,
          vatRate: Number(ret.purchase.vatRate),
          taxInvoiceDate: ret.purchase.taxInvoiceDate ? formatDateOnlyForInput(ret.purchase.taxInvoiceDate) : "",
        }
      : null,
    items:      initialItems,
  };
  const claimContext = ret.claim
    ? {
        id: ret.claim.id,
        claimNo: ret.claim.claimNo,
        supplierName: ret.claim.supplier?.name ?? null,
        productId: ret.claim.warranty.productId,
        productCode: ret.claim.warranty.product.code,
        productName: ret.claim.warranty.product.name,
      }
    : null;

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link href={`/admin/purchase-returns/${id}`}
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors dark:text-slate-400 dark:hover:text-sky-300">
          <ChevronLeft size={16} /> {ret.returnNo}
        </Link>
        <span className="text-gray-300 dark:text-slate-600">/</span>
        <span className="text-sm font-medium text-gray-700 dark:text-slate-300">แก้ไข</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100 mb-6">แก้ไขใบคืนสินค้า</h1>
      {mutationBlockMessage && (
        <div className="mb-6">
          <DocumentMutationBlockedNotice
            message={mutationBlockMessage}
            references={mutationBlockReferences}
          />
        </div>
      )}
      {stockDebitWarningMessage && (
        <div className="mb-6">
          <DocumentMutationBlockedNotice
            message={stockDebitWarningMessage}
            references={stockDebitWarningReferences}
          />
        </div>
      )}
      <PurchaseReturnForm
        products={products}
        suppliers={suppliers}
        cashBankAccounts={cashBankAccounts}
        initialPurchases={initialPurchases}
        defaultVatType={config.vatType}
        defaultVatRate={config.vatRate}
        vatRegisteredFrom={config.vatRegisteredFrom}
        initialData={initialData}
        claimContext={claimContext}
        submitLocked={!!mutationBlockMessage}
        periodLock={periodLock}
        periodLockHint={PURCHASE_RETURN_PERIOD_LOCK_ALLOWED_EDITS_HINT}
      />
    </div>
  );
};

export default EditPurchaseReturnPage;
