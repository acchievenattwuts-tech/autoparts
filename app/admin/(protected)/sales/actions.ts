"use server";

import { uploadProductsBucketObject } from "@/lib/products-bucket-storage";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db, dbTx } from "@/lib/db";
import { reportCriticalError } from "@/lib/error-reporting";
import { invalidateTransactionCustomerOptions } from "@/lib/transaction-options";
import { requireAnyPermission, requirePermission } from "@/lib/require-auth";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
import { dispatchOutOfStockAlerts } from "@/lib/notifications";
import { generateSaleNo } from "@/lib/doc-number";
import {
  AuditAction,
  FulfillmentType,
  PaymentMethod,
  Prisma,
  SalePaymentType,
  SaleType,
  ShippingMethod,
  ShippingStatus,
  VatType,
} from "@/lib/generated/prisma";
import { generateTrackingToken } from "@/lib/delivery-tracking";
import { getDocumentMutationBlockMessage } from "@/lib/document-mutation-guard";
import { sniffImageMimeType } from "@/lib/image-upload-validation";
import { calcVat, calcItemSubtotal } from "@/lib/vat";
import { recalculateSaleAmountRemain } from "@/lib/amount-remain";
import { getLotAvailability, writeSaleLots, writeStockMovementLots, reverseSaleLotBalance, validateLotRows, type LotSubRow } from "@/lib/lot-control";
import type { LotAvailableJSON } from "@/lib/lot-control-client";
import {
  getTransactionProductDetailRowsByIds,
  searchTransactionProductDetailRows,
  type TransactionProductDetailRow,
} from "@/lib/transaction-product-search";
import { CashBankDirection, CashBankSourceType, DocumentPaymentDocType } from "@/lib/generated/prisma";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";
import {
  assertPaymentsMatchTotal,
  clearDocumentPayments,
  derivePrimaryAccountId,
  parseDocumentPaymentRows,
  replaceDocumentPayments,
  toCashBankEntries,
  type DocumentPaymentRow,
} from "@/lib/document-payments";
import { revalidateProfitDashboardCache } from "@/lib/profit-cache";
import { rebuildSaleProfitFacts } from "@/lib/profit-fact";
import { formatDateOnlyForInput, parseDateOnlyToDate } from "@/lib/th-date";
import { isInventoryTracked, resolveSaleUnitCost } from "@/lib/inventory-tracking";
import {
  assertLotBalanceAvailable,
  createWarrantySnapshots,
  getSaleUnitKey,
  preloadSaleDependencies,
  resolveSalePaymentMethodFromAccounts,
} from "@/lib/sale-core";

const TRACKING_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

const serializeSaleProductOption = (product: TransactionProductDetailRow) => ({
  id: product.id,
  code: product.code,
  name: product.name,
  description: product.description,
  salePrice: product.salePrice,
  retailPrice: product.retailPrice,
  memberPrice: product.memberPrice,
  saleUnitName: product.saleUnitName,
  warrantyDays: product.warrantyDays,
  categoryName: product.categoryName,
  brandName: product.brandName,
  units: product.units,
  preferredSupplierId: product.preferredSupplierActive ? product.preferredSupplierId : null,
  preferredSupplierName: product.preferredSupplierActive ? product.preferredSupplierName : null,
  isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
  lotIssueMethod: product.lotIssueMethod as string,
  allowExpiredIssue: product.allowExpiredIssue,
  isActive: product.isActive,
});

export async function searchSaleProducts(query: string) {
  const session = await requireAnyPermission(["sales.create", "sales.update"]).catch(
    () => null,
  );
  if (!session?.user?.id) return [];

  return (await searchTransactionProductDetailRows(query)).map(serializeSaleProductOption);
}

export async function loadSaleProductsByIds(ids: string[]) {
  const session = await requireAnyPermission(["sales.create", "sales.update"]).catch(() => null);
  if (!session?.user?.id) return [];
  return (await getTransactionProductDetailRowsByIds(ids)).map(serializeSaleProductOption);
}

export async function searchSaleCustomers(query: string) {
  const session = await requireAnyPermission(["sales.create", "sales.update"]).catch(
    () => null,
  );
  if (!session?.user?.id) return [];

  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) return [];

  return db.customer.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: normalizedQuery, mode: "insensitive" } },
        { code: { contains: normalizedQuery, mode: "insensitive" } },
        { phone: { contains: normalizedQuery, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: 50,
    select: {
      id: true,
      name: true,
      phone: true,
      code: true,
      shippingAddress: true,
      creditTerm: true,
      defaultLatitude: true,
      defaultLongitude: true,
    },
  });
}

export async function searchSaleSuppliers(query: string) {
  const session = await requireAnyPermission(["sales.create", "sales.update"]).catch(
    () => null,
  );
  if (!session?.user?.id) return [];

  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) return [];

  return db.supplier.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: normalizedQuery, mode: "insensitive" } },
        { code: { contains: normalizedQuery, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: 50,
    select: { id: true, name: true, code: true },
  });
}

async function requireSaleLotPermission() {
  const createSession = await requirePermission("sales.create").catch(() => null);
  if (createSession?.user?.id) return createSession;
  return requireAnyPermission(["sales.update", "delivery.update"]).catch(() => null);
}

const lotSubRowSchema = z.object({
  lotNo:    z.string().min(1).max(100),
  qty:      z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
  mfgDate:  z.string().default(""),
  expDate:  z.string().default(""),
});

const saleItemSchema = z.object({
  productId:    z.string().min(1).max(50),
  unitName:     z.string().min(1).max(20),
  qty:          z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  salePrice:    z.coerce.number().min(0, "ราคาต้องไม่ติดลบ"),
  unitListPrice: z.coerce.number().min(0).default(0),
  lineDiscount:  z.coerce.number().min(0).default(0),
  warrantyDays: z.coerce.number().int().min(0).default(0),
  supplierId:   z.string().max(50).optional(),
  supplierName: z.string().max(200).optional(),
  moreDetail:   z.string().max(500).optional(),
  lotItems:     z.array(lotSubRowSchema).default([]),
}).transform((item) => {
  // salePrice is the source of truth for all money math. Derive/repair the
  // display-only list price + line discount so they always satisfy:
  //   unitListPrice >= salePrice  and  lineDiscount = (unitListPrice - salePrice) * qty
  // This keeps totals/VAT/profit untouched even if the client sends stale values.
  const unitListPrice = Math.max(item.unitListPrice, item.salePrice);
  const lineDiscount = Math.round((unitListPrice - item.salePrice) * item.qty * 100) / 100;
  return { ...item, unitListPrice, lineDiscount };
});

const saleSchema = z.object({
  saleDate:        z.string().min(1, "กรุณาระบุวันที่"),
  customerId:      z.string().min(1, "กรุณาเลือกลูกค้า").max(50),
  saleType:        z.nativeEnum(SaleType).default(SaleType.RETAIL),
  paymentType:     z.nativeEnum(SalePaymentType).default(SalePaymentType.CASH_SALE),
  fulfillmentType: z.nativeEnum(FulfillmentType).default(FulfillmentType.PICKUP),
  customerName:    z.string().max(100).optional(),
  customerPhone:   z.string().max(20).optional(),
  shippingAddress:  z.string().max(500).optional(),
  shippingFee:      z.coerce.number().min(0).default(0),
  destLatitude:     z.coerce.number().finite().gte(-90).lte(90).optional(),
  destLongitude:    z.coerce.number().finite().gte(-180).lte(180).optional(),
  saveAsCustomerDefault: z.enum(["1"]).optional(),
  discount:        z.coerce.number().min(0).default(0),
  paymentMethod:   z.nativeEnum(PaymentMethod).optional(),
  cashBankAccountId: z.string().optional(),
  note:            z.string().max(500).optional(),
  vatType:         z.nativeEnum(VatType).default(VatType.NO_VAT),
  vatRate:         z.coerce.number().min(0).max(100).default(0),
  shippingMethod:  z.nativeEnum(ShippingMethod).default(ShippingMethod.NONE),
  creditTerm:      z.coerce.number().int().min(0).max(365).optional(),
  items:           z.array(saleItemSchema).min(1, "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ").max(100),
});


// Build a stable signature for a sale line in BASE-UNIT terms.
// Lines whose signature matches an existing DB line produce identical
// StockCard + lot-out + warranty effects, so the differential updater
// can leave them untouched. costPrice is intentionally excluded — for
// matched items we keep the historical avgCost snapshot already stored.
type SaleStockSignatureLot = {
  lotNo:     string;
  qtyInBase: number;
};

function buildSaleItemSignature(payload: {
  productId:    string;
  qtyInBase:    number;
  salePrice:    number;
  warrantyDays: number;
  supplierId:   string | null;
  supplierName: string | null;
  lots:         SaleStockSignatureLot[];
}): string {
  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const lotsSig = payload.lots
    .map((l) => [l.lotNo, round4(l.qtyInBase)].join("|"))
    .sort()
    .join("//");
  return [
    payload.productId,
    round4(payload.qtyInBase),
    round2(payload.salePrice),
    payload.warrantyDays,
    payload.supplierId   ?? "",
    payload.supplierName ?? "",
    lotsSig,
  ].join("||");
}

async function getSaleAuditSnapshot(saleId: string) {
  const [sale, payments] = await Promise.all([
    db.sale.findUnique({
    where: { id: saleId },
    include: {
      items: {
        select: {
          productId: true,
          quantity: true,
          salePrice: true,
          unitListPrice: true,
          lineDiscount: true,
          totalAmount: true,
          warrantyDays: true,
          supplierId: true,
          supplierName: true,
          moreDetail: true,
        },
        orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      },
    },
  }),
    db.documentPayment.findMany({
      where: { docType: DocumentPaymentDocType.SALE, docId: saleId },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      select: { cashBankAccountId: true, amount: true },
    }),
  ]);

  if (!sale) {
    return null;
  }

  return {
    id: sale.id,
    saleNo: sale.saleNo,
    saleDate: sale.saleDate,
    customerId: sale.customerId,
    customerName: sale.customerName,
    customerPhone: sale.customerPhone,
    saleType: sale.saleType,
    paymentType: sale.paymentType,
    fulfillmentType: sale.fulfillmentType,
    status: sale.status,
    shippingStatus: sale.shippingStatus,
    shippingMethod: sale.shippingMethod,
    trackingNo: sale.trackingNo,
    deliveryStaffId: sale.deliveryStaffId,
    shippingAddress: sale.shippingAddress,
    shippingFee: sale.shippingFee,
    discount: sale.discount,
    totalAmount: sale.totalAmount,
    subtotalAmount: sale.subtotalAmount,
    vatAmount: sale.vatAmount,
    netAmount: sale.netAmount,
    amountRemain: sale.amountRemain,
    vatType: sale.vatType,
    vatRate: sale.vatRate,
    paymentMethod: sale.paymentMethod,
    cashBankAccountId: sale.cashBankAccountId,
    note: sale.note,
    creditTerm: sale.creditTerm,
    items: sale.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      salePrice: item.salePrice,
      unitListPrice: item.unitListPrice,
      lineDiscount: item.lineDiscount,
      totalAmount: item.totalAmount,
      warrantyDays: item.warrantyDays,
      supplierId: item.supplierId,
      supplierName: item.supplierName,
      moreDetail: item.moreDetail,
    })),
    payments: payments.map((payment) => ({
      cashBankAccountId: payment.cashBankAccountId,
      amount: payment.amount,
    })),
  };
}

function validateDeliveryFields(input: {
  fulfillmentType: FulfillmentType;
  shippingAddress?: string | null;
  shippingMethod: ShippingMethod;
}): string | null {
  if (input.fulfillmentType !== FulfillmentType.DELIVERY) {
    return null;
  }

  if (!input.shippingAddress?.trim()) {
    return "กรุณาระบุที่อยู่จัดส่ง";
  }

  if (input.shippingMethod === ShippingMethod.NONE) {
    return "กรุณาเลือกประเภทขนส่ง";
  }

  return null;
}

async function getSaleSignerSnapshot(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  userId: string,
  signedAt: Date,
): Promise<{
  signerName: string | null;
  signerSignatureUrl: string | null;
  signedAt: Date | null;
}> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { name: true, signatureUrl: true },
  });

  return {
    signerName: user?.name ?? null,
    signerSignatureUrl: user?.signatureUrl ?? null,
    signedAt: user?.name ? signedAt : null,
  };
}

export async function createSale(
  formData: FormData
): Promise<{ success?: boolean; saleId?: string; saleNo?: string; error?: string }> {
  const session = await requirePermission("sales.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  let items: z.infer<typeof saleItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch {
    return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" };
  }

  const parsed = saleSchema.safeParse({
    saleDate:        formData.get("saleDate"),
    customerId:      formData.get("customerId")      || undefined,
    saleType:        formData.get("saleType")        || SaleType.RETAIL,
    paymentType:     formData.get("paymentType")     || SalePaymentType.CASH_SALE,
    fulfillmentType: formData.get("fulfillmentType") || FulfillmentType.PICKUP,
    customerName:    formData.get("customerName")    || undefined,
    customerPhone:   formData.get("customerPhone")   || undefined,
    shippingAddress:  formData.get("shippingAddress")  || undefined,
    shippingFee:      formData.get("shippingFee")      || 0,
    destLatitude:     formData.get("destLatitude")     || undefined,
    destLongitude:    formData.get("destLongitude")    || undefined,
    saveAsCustomerDefault: formData.get("saveAsCustomerDefault") || undefined,
    discount:         formData.get("discount")         || 0,
    paymentMethod:    formData.get("paymentMethod")    || undefined,
    cashBankAccountId: formData.get("cashBankAccountId") || undefined,
    note:             formData.get("note")             || undefined,
    vatType:          (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:          formData.get("vatRate")          || 0,
    shippingMethod:   (formData.get("shippingMethod") as ShippingMethod) || ShippingMethod.NONE,
    creditTerm:       formData.get("creditTerm")       || undefined,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const {
    saleDate,
    customerId,
    saleType,
    paymentType,
    fulfillmentType,
    customerName,
    customerPhone,
    shippingAddress,
    shippingFee,
    destLatitude,
    destLongitude,
    saveAsCustomerDefault,
    discount,
    note,
    vatType,
    vatRate,
    shippingMethod,
    creditTerm,
    items: validItems,
  } = parsed.data;

  // Calculate totals
  const totalAmount = validItems.reduce((sum, item) => sum + item.qty * item.salePrice, 0);
  const discountedTotal = Math.max(0, totalAmount + shippingFee - discount);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(discountedTotal, vatType, vatRate);
  const deliveryValidationError = validateDeliveryFields({
    fulfillmentType,
    shippingAddress,
    shippingMethod,
  });
  if (deliveryValidationError) {
    return { error: deliveryValidationError };
  }
  let payments: DocumentPaymentRow[] = [];
  if (paymentType === SalePaymentType.CASH_SALE) {
    try {
      payments = parseDocumentPaymentRows(formData.get("payments"));
    } catch {
      return { error: "รูปแบบข้อมูลช่องทางรับเงินไม่ถูกต้อง" };
    }
    if (payments.length === 0) {
      return { error: "กรุณาระบุช่องทางรับเงินอย่างน้อย 1 ช่องทาง" };
    }
    try {
      assertPaymentsMatchTotal(payments, netAmount);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "ยอดช่องทางรับเงินไม่ถูกต้อง" };
    }
  }

  const resolvedCashBankAccountId = derivePrimaryAccountId(payments) ?? undefined;
  const docDate = parseDateOnlyToDate(saleDate);
  const salePrefix = paymentType === "CREDIT_SALE" ? "SAC" : "SA";
  const saleNo  = await generateSaleNo(salePrefix, docDate);
  let createdSaleId = "";
  const stockCrossedToZero: string[] = [];

  try {
    const requestContext = await getRequestContext();
    await dbTx(async (tx) => {
      const resolvedPaymentMethod = await resolveSalePaymentMethodFromAccounts(
        tx,
        payments.map((row) => row.cashBankAccountId),
      );
      const signerSnapshot = await getSaleSignerSnapshot(tx, session.user!.id, docDate);
      const { productMap, unitMap } = await preloadSaleDependencies(tx, validItems);
      // 1. Create Sale header
      const sale = await tx.sale.create({
        data: {
          saleNo,
          customerId:       customerId       ?? null,
          saleType,
          paymentType,
          fulfillmentType,
          shippingAddress:  shippingAddress  ?? null,
          shippingFee,
          destLatitude:     destLatitude     ?? null,
          destLongitude:    destLongitude    ?? null,
          customerName:     customerName     ?? null,
          customerPhone:    customerPhone    ?? null,
          userId:           session.user!.id!,
          signerName:       signerSnapshot.signerName,
          signerSignatureUrl: signerSnapshot.signerSignatureUrl,
          signedAt:         signerSnapshot.signedAt,
          totalAmount,
          discount,
          netAmount,
          vatType,
          vatRate,
          subtotalAmount,
          vatAmount,
          paymentMethod:   resolvedPaymentMethod,
          cashBankAccountId: resolvedCashBankAccountId || null,
          note:            note            ?? null,
          saleDate:        docDate,
          amountRemain:    new Prisma.Decimal(paymentType === "CREDIT_SALE" ? netAmount : 0),
          shippingMethod,
          shippingStatus:  ShippingStatus.PENDING,
          creditTerm:      creditTerm      ?? null,
        },
      });
      createdSaleId = sale.id;

      // 2. Process each line item
      for (const [itemIndex, item] of validItems.entries()) {
        // Get unit scale
        const unit = unitMap.get(getSaleUnitKey(item.productId, item.unitName));
        const product = productMap.get(item.productId);
        if (!product) throw new Error("ไม่พบสินค้า");
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale      = unit.scale;
        const qtyInBase  = item.qty * scale;

        const isTracked = isInventoryTracked(product.inventoryTracking);
        const costPerBase = resolveSaleUnitCost(product);

        const itemTotal    = item.qty * item.salePrice;
        const itemSubtotal = calcItemSubtotal(itemTotal, vatType, vatRate);

        // Create SaleItem
        const saleItem = await tx.saleItem.create({
          data: {
            saleId:        sale.id,
            lineNo:        itemIndex + 1,
            productId:     item.productId,
            quantity:      Math.round(qtyInBase),
            salePrice:     item.salePrice,
            unitListPrice: item.unitListPrice,
            lineDiscount:  item.lineDiscount,
            costPrice:     costPerBase,
            totalAmount:   itemTotal,
            subtotalAmount: itemSubtotal,
            showQty:       item.qty,
            showUnitName:  item.unitName,
            showPricePerUnit: item.salePrice,
            unitScale:     scale,
            warrantyDays:  item.warrantyDays,
            supplierId:    item.supplierId || null,
            supplierName:  item.supplierName || null,
            moreDetail:    item.moreDetail || null,
          },
        });

        // Auto-create Warranty rows - one per display-unit qty (N warranties for N pieces sold)
        // Write StockCard (outgoing)
        const stockCardId = isTracked ? await writeStockCard(tx, {
          productId:   item.productId,
          docNo:       saleNo,
          docDate,
          source:      "SALE",
          qtyIn:       0,
          qtyOut:      qtyInBase,
          priceIn:     0,
          detail:      `ขาย ${item.qty} ${item.unitName}`,
          referenceId: saleItem.id,
        }, stockCrossedToZero) : null;

        // Lot Control - only if product has isLotControl=true
        if (stockCardId && item.lotItems.length > 0 && product?.isLotControl) {
            const lotErr = validateLotRows(item.lotItems as LotSubRow[], item.qty, false);
            if (lotErr) throw new Error(lotErr);

            const lotsInBase = item.lotItems.map((lot) => ({
              lotNo:        lot.lotNo.trim(),
              qtyInBase:    lot.qty * scale,
              unitCostBase: costPerBase,
              mfgDate:      null as Date | null,
              expDate:      null as Date | null,
            }));

            await assertLotBalanceAvailable(tx, item.productId, lotsInBase);
            await writeSaleLots(tx, saleItem.id, item.productId, lotsInBase);

            await writeStockMovementLots(tx, stockCardId, lotsInBase, "out");
        }

        await createWarrantySnapshots(tx, {
          saleId: sale.id,
          saleItemId: saleItem.id,
          productId: item.productId,
          warrantyDays: item.warrantyDays,
          docDate,
          itemQty: item.qty,
          lotItems: item.lotItems as LotSubRow[],
        });
      }

      await replaceDocumentPayments(
        tx,
        DocumentPaymentDocType.SALE,
        sale.id,
        CashBankDirection.IN,
        payments,
      );

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.SALE,
        sale.id,
        toCashBankEntries(payments, {
          txnDate: docDate,
          direction: CashBankDirection.IN,
          referenceNo: saleNo,
          note: note ?? null,
        }),
      );

      await rebuildSaleProfitFacts(tx, sale.id);

      if (
        saveAsCustomerDefault === "1" &&
        customerId &&
        fulfillmentType === FulfillmentType.DELIVERY &&
        destLatitude !== undefined &&
        destLongitude !== undefined
      ) {
        await tx.customer.update({
          where: { id: customerId },
          data: {
            defaultLatitude:  destLatitude,
            defaultLongitude: destLongitude,
          },
        });
      }
    }, { timeout: 180_000 });

    // Customer default lat/long feeds the cached transaction dropdown options.
    if (
      saveAsCustomerDefault === "1" &&
      customerId &&
      fulfillmentType === FulfillmentType.DELIVERY &&
      destLatitude !== undefined &&
      destLongitude !== undefined
    ) {
      invalidateTransactionCustomerOptions();
    }

    const afterSnapshot = createdSaleId
      ? await getSaleAuditSnapshot(createdSaleId)
      : null;
    if (afterSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "Sale",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.saleNo,
        after: afterSnapshot,
      });
    }

    if (
      saveAsCustomerDefault === "1" &&
      customerId &&
      fulfillmentType === FulfillmentType.DELIVERY &&
      destLatitude !== undefined &&
      destLongitude !== undefined
    ) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "Customer",
        entityId: customerId,
        entityRef: saleNo,
        after: {
          defaultLatitude: destLatitude,
          defaultLongitude: destLongitude,
          source: `sale:${saleNo}`,
        },
      });
    }

    // Real-time out-of-stock alert — AFTER commit, never blocks the sale.
    await dispatchOutOfStockAlerts(stockCrossedToZero).catch((err) =>
      console.warn("[createSale] out-of-stock alert skipped:", err instanceof Error ? err.message : "unknown"),
    );

    // ล้างแคชแบบ deferred ด้วย after() — callback ถูกรัน "หลัง" response ถูกส่ง
    // ออกไปแล้ว ทำให้ Server Action ไม่แนบ RSC payload ของหน้าปัจจุบันกลับมา
    // router จึงไม่ re-render หน้าฟอร์มทิ้ง (แก้อาการจอกระพริบ 1 ครั้งหลังบันทึก)
    // ผลการล้างแคชเท่าเดิมทุกประการ เพียงเกิดขึ้นช้ากว่าไม่กี่มิลลิวินาที
    after(() => {
      revalidateProfitDashboardCache();
      revalidatePath("/admin");
      revalidatePath("/admin/sales");
      revalidatePath("/admin/products");
    });
    return { success: true, saleId: createdSaleId, saleNo };
  } catch (err) {
    await reportCriticalError(err, { scope: "sales.create" });
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const cancelSaleSchema = z.object({
  saleId:     z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelSale(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("sales.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelSaleSchema.safeParse({
    saleId:     formData.get("saleId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { saleId, cancelNote } = parsed.data;

  const sale = await db.sale.findUnique({
    where: { id: saleId },
    include: {
      items:       { orderBy: { lineNo: "asc" }, select: { id: true, productId: true } },
      creditNotes: { where: { status: "ACTIVE" }, select: { cnNo: true } },
      receipts:    { include: { receipt: { select: { receiptNo: true, status: true } } } },
      warranties:  {
        select: {
          id: true,
          claims: {
            where: { status: { not: "CANCELLED" } },
            select: { claimNo: true },
          },
        },
      },
    },
  });
  if (!sale)                        return { error: "ไม่พบเอกสาร" };
  if (sale.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกไปแล้ว" };
  const mutationBlockMessage = await getDocumentMutationBlockMessage("Sale", saleId, "cancel");
  if (mutationBlockMessage) return { error: mutationBlockMessage };

  // Reference chain: ตรวจ CN ที่ยัง active
  if (sale.creditNotes.length > 0) {
    const nos = sale.creditNotes.map((cn) => cn.cnNo).join(", ");
    return { error: `ไม่สามารถยกเลิกได้ มีใบลดหนี้ที่อ้างอิงอยู่: ${nos} กรุณายกเลิก CN ก่อน` };
  }

  // Reference chain: ตรวจใบเสร็จที่ยัง active
  const activeReceipts = sale.receipts
    .filter((ri) => ri.receipt.status === "ACTIVE")
    .map((ri) => ri.receipt);
  if (activeReceipts.length > 0) {
    const nos = activeReceipts.map((r) => r.receiptNo).join(", ");
    return { error: `ไม่สามารถยกเลิกได้ มีใบเสร็จรับเงินที่อ้างอิงอยู่: ${nos} กรุณายกเลิกใบเสร็จก่อน` };
  }

  // Reference chain: ตรวจใบเคลมที่ยัง active
  const activeClaims = sale.warranties.flatMap((w) => w.claims);
  if (activeClaims.length > 0) {
    const nos = activeClaims.map((c) => c.claimNo).join(", ");
    return { error: `ไม่สามารถยกเลิกได้ มีใบเคลมที่อ้างอิงอยู่: ${nos} กรุณายกเลิกใบเคลมก่อน` };
  }

  const affectedProductIds = [...new Set(sale.items.map((i) => i.productId))];

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getSaleAuditSnapshot(saleId);
    const cancelledAt = new Date();
    await dbTx(async (tx) => {
      await clearCashBankSourceMovements(tx, CashBankSourceType.SALE, saleId);
      await clearDocumentPayments(tx, DocumentPaymentDocType.SALE, saleId);
      // Reverse Lot balances before deleting StockCard rows
      for (const item of sale.items) {
        await reverseSaleLotBalance(tx, item.id, item.productId);
      }
      await tx.stockCard.deleteMany({ where: { docNo: sale.saleNo } });
      for (const productId of affectedProductIds) {
        await recalculateStockCard(tx, productId);
      }
      // ลบ warranties ที่ auto-generated จากใบขายนี้
      await tx.warranty.deleteMany({ where: { saleId } });
      await tx.sale.update({
        where: { id: saleId },
        data: {
          status: "CANCELLED",
          cancelledAt,
          cancelNote,
          amountRemain: new Prisma.Decimal(0),
          ...(sale.trackingToken
            ? { trackingExpiry: new Date(cancelledAt.getTime() + TRACKING_TOKEN_TTL_MS) }
            : {}),
        },
      });
      await rebuildSaleProfitFacts(tx, saleId);
    }, { timeout: 180_000 });

    const afterSnapshot = await getSaleAuditSnapshot(saleId);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CANCEL,
        entityType: "Sale",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.saleNo,
        before: diff.before,
        after: diff.after,
        meta: { cancelNote: cancelNote ?? null },
      });
    }

    revalidateProfitDashboardCache();
    revalidatePath("/admin");
    revalidatePath("/admin/sales");
    return { success: true };
  } catch (err) {
    await reportCriticalError(err, { scope: "sales.cancel" });
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// updateSale

export async function updateSale(
  id: string,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("sales.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสเอกสารไม่ถูกต้อง" };
  }

  const existing = await db.sale.findUnique({
    where: { id },
    include: {
      user:        { select: { name: true, signatureUrl: true } },
      items: {
        orderBy: { lineNo: "asc" },
        select: {
          id:            true,
          productId:     true,
          quantity:      true,
          salePrice:     true,
          warrantyDays:  true,
          supplierId:    true,
          supplierName:  true,
          lotItems: {
            orderBy: { id: "asc" },
            select: { lotNo: true, qty: true },
          },
        },
      },
      creditNotes: { where: { status: "ACTIVE" }, select: { cnNo: true } },
      receipts:    { include: { receipt: { select: { receiptNo: true, status: true } } } },
      warranties:  {
        select: {
          id: true,
          claims: {
            where: { status: { not: "CANCELLED" } },
            select: { claimNo: true },
          },
        },
      },
    },
  });
  if (!existing)                        return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };
  const mutationBlockMessage = await getDocumentMutationBlockMessage("Sale", id, "update");
  if (mutationBlockMessage) return { error: mutationBlockMessage };
  if (existing.creditNotes.length > 0) {
    const nos = existing.creditNotes.map((cn) => cn.cnNo).join(", ");
    return { error: `ไม่สามารถแก้ไขได้ มีใบลดหนี้ที่อ้างอิงอยู่: ${nos}` };
  }
  const activeReceipts = existing.receipts.filter((ri) => ri.receipt.status === "ACTIVE");
  if (activeReceipts.length > 0) {
    const nos = activeReceipts.map((ri) => ri.receipt.receiptNo).join(", ");
    return { error: `ไม่สามารถแก้ไขได้ มีใบเสร็จรับเงินที่อ้างอิงอยู่: ${nos}` };
  }
  const activeClaims = existing.warranties.flatMap((w) => w.claims);
  if (activeClaims.length > 0) {
    const nos = activeClaims.map((c) => c.claimNo).join(", ");
    return { error: `ไม่สามารถแก้ไขได้ มีใบเคลมที่อ้างอิงอยู่: ${nos} กรุณายกเลิกใบเคลมก่อน` };
  }

  let items: z.infer<typeof saleItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch { return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" }; }

  const parsed = saleSchema.safeParse({
    saleDate:        formData.get("saleDate"),
    customerId:      formData.get("customerId")      || undefined,
    saleType:        formData.get("saleType")        || SaleType.RETAIL,
    paymentType:     formData.get("paymentType")     || SalePaymentType.CASH_SALE,
    fulfillmentType: formData.get("fulfillmentType") || FulfillmentType.PICKUP,
    customerName:    formData.get("customerName")    || undefined,
    customerPhone:   formData.get("customerPhone")   || undefined,
    shippingAddress:  formData.get("shippingAddress")  || undefined,
    shippingFee:      formData.get("shippingFee")      || 0,
    destLatitude:     formData.get("destLatitude")     || undefined,
    destLongitude:    formData.get("destLongitude")    || undefined,
    saveAsCustomerDefault: formData.get("saveAsCustomerDefault") || undefined,
    discount:         formData.get("discount")         || 0,
    paymentMethod:    formData.get("paymentMethod")    || undefined,
    cashBankAccountId: formData.get("cashBankAccountId") || undefined,
    note:             formData.get("note")             || undefined,
    vatType:          (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:          formData.get("vatRate")          || 0,
    shippingMethod:   (formData.get("shippingMethod") as ShippingMethod) || ShippingMethod.NONE,
    creditTerm:       formData.get("creditTerm")       || undefined,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { saleDate, customerId, saleType, paymentType, fulfillmentType, customerName, customerPhone, shippingAddress, shippingFee, destLatitude, destLongitude, saveAsCustomerDefault, discount, note, vatType, vatRate, shippingMethod, creditTerm, items: validItems } = parsed.data;

  const totalAmount     = validItems.reduce((sum, item) => sum + item.qty * item.salePrice, 0);
  const discountedTotal = Math.max(0, totalAmount + shippingFee - discount);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(discountedTotal, vatType, vatRate);
  const deliveryValidationError = validateDeliveryFields({
    fulfillmentType,
    shippingAddress,
    shippingMethod,
  });
  if (deliveryValidationError) {
    return { error: deliveryValidationError };
  }

  let payments: DocumentPaymentRow[] = [];
  if (paymentType === SalePaymentType.CASH_SALE) {
    try {
      payments = parseDocumentPaymentRows(formData.get("payments"));
    } catch {
      return { error: "รูปแบบข้อมูลช่องทางรับเงินไม่ถูกต้อง" };
    }
    if (payments.length === 0) {
      return { error: "กรุณาระบุช่องทางรับเงินอย่างน้อย 1 ช่องทาง" };
    }
    try {
      assertPaymentsMatchTotal(payments, netAmount);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "ยอดช่องทางรับเงินไม่ถูกต้อง" };
    }
  }
  const resolvedCashBankAccountId = derivePrimaryAccountId(payments) ?? undefined;
  const docDate = parseDateOnlyToDate(saleDate);

  const oldProductIds = [...new Set(existing.items.map((i) => i.productId))];

  // ─── Differential Analysis ────────────────────────────────────────────────
  // Compare incoming items against existing items in base-unit terms. Lines
  // that match an existing line by signature are left untouched (no lot
  // reverse, no StockCard rewrite, no warranty/MAVG rebuild). Lines that
  // don't match are removed; new lines are added. Sale uses no landed-cost
  // allocation across items, so shipping/discount changes never shift
  // per-line cost — only a saleDate change forces a full reset (docDate of
  // every StockCard row would otherwise need to change).
  const saleDateChanged =
    formatDateOnlyForInput(existing.saleDate) !== saleDate;

  // Resolve unit scales for the incoming items so we can normalize them
  // into base units before computing signatures.
  const newUnitLookup = validItems.length === 0
    ? []
    : await db.productUnit.findMany({
        where: {
          OR: validItems.map((i) => ({
            productId: i.productId,
            name: i.unitName,
          })),
        },
        select: { productId: true, name: true, scale: true },
      });
  const newUnitScaleMap = new Map(
    newUnitLookup.map((u) => [
      getSaleUnitKey(u.productId, u.name),
      Number(u.scale),
    ]),
  );

  type ExistingSaleSig = {
    existingItemId: string;
    productId:      string;
    signature:      string;
  };
  type NewSaleSig = {
    newIdx:    number;
    productId: string;
    signature: string;
  };

  const oldItemSigs: ExistingSaleSig[] = existing.items.map((item) => ({
    existingItemId: item.id,
    productId:      item.productId,
    signature: buildSaleItemSignature({
      productId:    item.productId,
      qtyInBase:    Number(item.quantity),
      salePrice:    Number(item.salePrice),
      warrantyDays: item.warrantyDays,
      supplierId:   item.supplierId ?? null,
      supplierName: item.supplierName ?? null,
      lots: item.lotItems.map((l) => ({
        lotNo:     l.lotNo,
        qtyInBase: Number(l.qty),
      })),
    }),
  }));

  const newItemSigs: NewSaleSig[] = validItems.map((item, idx) => {
    const scale =
      newUnitScaleMap.get(getSaleUnitKey(item.productId, item.unitName)) ?? 1;
    return {
      newIdx:    idx,
      productId: item.productId,
      signature: buildSaleItemSignature({
        productId:    item.productId,
        qtyInBase:    item.qty * scale,
        salePrice:    item.salePrice,
        warrantyDays: item.warrantyDays,
        supplierId:   item.supplierId   || null,
        supplierName: item.supplierName || null,
        lots: (item.lotItems ?? []).map((l) => ({
          lotNo:     l.lotNo.trim(),
          qtyInBase: l.qty * scale,
        })),
      }),
    };
  });

  // Greedy multiset match: each existing line can be claimed by at most one
  // new line with the same signature.
  const matchedExistingIds = new Set<string>();
  const matchedByNewIdx = new Map<number, string>();
  for (const n of newItemSigs) {
    const candidate = oldItemSigs.find(
      (o) =>
        !matchedExistingIds.has(o.existingItemId) && o.signature === n.signature,
    );
    if (candidate) {
      matchedExistingIds.add(candidate.existingItemId);
      matchedByNewIdx.set(n.newIdx, candidate.existingItemId);
    }
  }
  const removedExistingItems = oldItemSigs.filter(
    (o) => !matchedExistingIds.has(o.existingItemId),
  );
  const addedNewItems = newItemSigs.filter(
    (n) => !matchedByNewIdx.has(n.newIdx),
  );

  const useDifferential = !saleDateChanged;
  const affectedProductIds = new Set<string>();
  removedExistingItems.forEach((r) => affectedProductIds.add(r.productId));
  addedNewItems.forEach((a) => affectedProductIds.add(a.productId));

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getSaleAuditSnapshot(id);
    await dbTx(async (tx) => {
      const resolvedPaymentMethod = await resolveSalePaymentMethodFromAccounts(
        tx,
        payments.map((row) => row.cashBankAccountId),
      );
      const fallbackSignerName = existing.signerName ?? existing.user?.name ?? null;
      const fallbackSignerSignatureUrl =
        existing.signerSignatureUrl ?? existing.user?.signatureUrl ?? null;
      const fallbackSignedAt = existing.signedAt ?? (fallbackSignerName ? docDate : null);

      // 1. Drop stock effects for removed/changed lines only.
      //    Differential path: only the lines that didn't survive signature
      //    matching are reversed + deleted. Fallback path: everything is
      //    reversed and we rebuild from scratch (original behaviour).
      //    Warranty must be deleted before SaleItem because of FK.
      if (useDifferential) {
        if (removedExistingItems.length > 0) {
          const removedIds = removedExistingItems.map((r) => r.existingItemId);
          for (const removed of removedExistingItems) {
            await reverseSaleLotBalance(tx, removed.existingItemId, removed.productId);
            await tx.stockCard.deleteMany({
              where: {
                docNo:       existing.saleNo,
                referenceId: removed.existingItemId,
              },
            });
          }
          await tx.warranty.deleteMany({ where: { saleItemId: { in: removedIds } } });
          // Cascade removes SaleItemLot rows as well.
          await tx.saleItem.deleteMany({ where: { id: { in: removedIds } } });
        }
        for (const productId of affectedProductIds) {
          await recalculateStockCard(tx, productId);
        }
      } else {
        const oldItems = await tx.saleItem.findMany({
          where: { saleId: id },
          select: { id: true, productId: true },
        });
        for (const item of oldItems) {
          await reverseSaleLotBalance(tx, item.id, item.productId);
        }
        await tx.stockCard.deleteMany({ where: { docNo: existing.saleNo } });
        await tx.warranty.deleteMany({ where: { saleId: id } });
        await tx.saleItem.deleteMany({ where: { saleId: id } });
        for (const productId of oldProductIds) {
          await recalculateStockCard(tx, productId);
        }
      }

      // 2. Update header
      await tx.sale.update({
        where: { id },
        data: {
          saleDate:        docDate,
          customerId:      customerId      ?? null,
          saleType,
          paymentType,
          fulfillmentType,
          customerName:    customerName    ?? null,
          customerPhone:   customerPhone   ?? null,
          signerName:      fallbackSignerName,
          signerSignatureUrl: fallbackSignerSignatureUrl,
          signedAt:        fallbackSignedAt,
          shippingAddress:  shippingAddress  ?? null,
          shippingFee,
          destLatitude:     destLatitude     ?? null,
          destLongitude:    destLongitude    ?? null,
          discount,
          paymentMethod:    resolvedPaymentMethod,
          cashBankAccountId: resolvedCashBankAccountId || null,
          note:            note            ?? null,
          vatType,
          vatRate,
          totalAmount,
          subtotalAmount,
          vatAmount,
          netAmount,
          amountRemain:    new Prisma.Decimal(paymentType === "CREDIT_SALE" ? netAmount : 0),
          shippingMethod,
          creditTerm:      creditTerm      ?? null,
        },
      });
      // 2b. Sync header-derived fields on items we kept untouched in the
      //     differential path. subtotalAmount = calcItemSubtotal(itemTotal,
      //     vatType, vatRate) lives on SaleItem, so it must follow the
      //     header when VAT basis changes.
      if (useDifferential && matchedByNewIdx.size > 0) {
        const taxBasisChanged =
          existing.vatType !== vatType ||
          Math.abs(Number(existing.vatRate) - vatRate) > 0.0001;
        for (const [newIdx, existingItemId] of matchedByNewIdx) {
          const item = validItems[newIdx];
          const displayScale =
            newUnitScaleMap.get(getSaleUnitKey(item.productId, item.unitName)) ?? 1;
          const itemTotal = item.qty * item.salePrice;
          const itemSubtotal = calcItemSubtotal(itemTotal, vatType, vatRate);
          await tx.saleItem.update({
            where: { id: existingItemId },
            data: {
              lineNo: newIdx + 1,
              showQty: item.qty,
              showUnitName: item.unitName,
              showPricePerUnit: item.salePrice,
              unitListPrice: item.unitListPrice,
              lineDiscount: item.lineDiscount,
              unitScale: displayScale,
              moreDetail: item.moreDetail || null,
              ...(taxBasisChanged ? { subtotalAmount: itemSubtotal } : {}),
            },
          });
        }
      }

      // 3. Create items + stock cards + warranties.
      //    Differential: only added/changed lines. Fallback: every line.
      const itemsToCreate: { item: typeof validItems[number]; newIdx: number }[] = useDifferential
        ? addedNewItems.map((a) => ({ item: validItems[a.newIdx], newIdx: a.newIdx }))
        : validItems.map((item, idx) => ({ item, newIdx: idx }));

      const { productMap, unitMap } = await preloadSaleDependencies(
        tx,
        itemsToCreate.map(({ item }) => item),
      );

      for (const { item, newIdx } of itemsToCreate) {
        const unit = unitMap.get(getSaleUnitKey(item.productId, item.unitName));
        const product = productMap.get(item.productId);
        if (!product) throw new Error("ไม่พบสินค้า");
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale     = unit.scale;
        const qtyInBase = item.qty * scale;
        const isTracked = isInventoryTracked(product.inventoryTracking);
        const costPerBase  = resolveSaleUnitCost(product);
        const itemTotal    = item.qty * item.salePrice;
        const itemSubtotal = calcItemSubtotal(itemTotal, vatType, vatRate);

        const saleItem = await tx.saleItem.create({
          data: {
            saleId: id,
            lineNo: newIdx + 1,
            productId: item.productId,
            quantity: Math.round(qtyInBase),
            salePrice: item.salePrice,
            unitListPrice: item.unitListPrice,
            lineDiscount: item.lineDiscount,
            costPrice: costPerBase,
            totalAmount: itemTotal,
            subtotalAmount: itemSubtotal,
            showQty: item.qty,
            showUnitName: item.unitName,
            showPricePerUnit: item.salePrice,
            unitScale: scale,
            warrantyDays: item.warrantyDays,
            supplierId: item.supplierId || null,
            supplierName: item.supplierName || null,
            moreDetail: item.moreDetail || null,
          },
        });

        const stockCardId = isTracked ? await writeStockCard(tx, {
          productId:   item.productId,
          docNo:       existing.saleNo,
          docDate,
          source:      "SALE",
          qtyIn:       0,
          qtyOut:      qtyInBase,
          priceIn:     0,
          detail:      `ขาย ${item.qty} ${item.unitName}`,
          referenceId: saleItem.id,
        }) : null;

        if (stockCardId && item.lotItems.length > 0 && product?.isLotControl) {
            const lotErr = validateLotRows(item.lotItems as LotSubRow[], item.qty, false);
            if (lotErr) throw new Error(lotErr);

            const lotsInBase = item.lotItems.map((lot) => ({
              lotNo:        lot.lotNo.trim(),
              qtyInBase:    lot.qty * scale,
              unitCostBase: costPerBase,
              mfgDate:      null as Date | null,
              expDate:      null as Date | null,
            }));

            await assertLotBalanceAvailable(tx, item.productId, lotsInBase);
            await writeSaleLots(tx, saleItem.id, item.productId, lotsInBase);

            await writeStockMovementLots(tx, stockCardId, lotsInBase, "out");
        }

        await createWarrantySnapshots(tx, {
          saleId: id,
          saleItemId: saleItem.id,
          productId: item.productId,
          warrantyDays: item.warrantyDays,
          docDate,
          itemQty: item.qty,
          lotItems: item.lotItems as LotSubRow[],
        });
      }

      // 4. Recalculate amountRemain after updating netAmount
      await recalculateSaleAmountRemain(tx, id);

      await replaceDocumentPayments(
        tx,
        DocumentPaymentDocType.SALE,
        id,
        CashBankDirection.IN,
        payments,
      );

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.SALE,
        id,
        toCashBankEntries(payments, {
          txnDate: docDate,
          direction: CashBankDirection.IN,
          referenceNo: existing.saleNo,
          note: note ?? null,
        }),
      );

      await rebuildSaleProfitFacts(tx, id);

      if (
        saveAsCustomerDefault === "1" &&
        customerId &&
        fulfillmentType === FulfillmentType.DELIVERY &&
        destLatitude !== undefined &&
        destLongitude !== undefined
      ) {
        await tx.customer.update({
          where: { id: customerId },
          data: {
            defaultLatitude:  destLatitude,
            defaultLongitude: destLongitude,
          },
        });
      }
    }, { timeout: 180_000 });

    // Customer default lat/long feeds the cached transaction dropdown options.
    if (
      saveAsCustomerDefault === "1" &&
      customerId &&
      fulfillmentType === FulfillmentType.DELIVERY &&
      destLatitude !== undefined &&
      destLongitude !== undefined
    ) {
      invalidateTransactionCustomerOptions();
    }

    const afterSnapshot = await getSaleAuditSnapshot(id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "Sale",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.saleNo,
        before: diff.before,
        after: diff.after,
      });
    }

    if (
      saveAsCustomerDefault === "1" &&
      customerId &&
      fulfillmentType === FulfillmentType.DELIVERY &&
      destLatitude !== undefined &&
      destLongitude !== undefined
    ) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "Customer",
        entityId: customerId,
        entityRef: existing.saleNo,
        after: {
          defaultLatitude: destLatitude,
          defaultLongitude: destLongitude,
          source: `sale:${existing.saleNo}`,
        },
      });
    }

    // ล้างแคชแบบ deferred ด้วย after() — เหตุผลเดียวกับใน createSale
    // ฟอร์มแก้ไขอยู่หน้าเดิมหลังบันทึก จึงต้องไม่ให้ router re-render ทิ้ง
    after(() => {
      revalidateProfitDashboardCache();
      revalidatePath("/admin");
      revalidatePath("/admin/sales");
      revalidatePath(`/admin/sales/${id}`);
      revalidatePath("/admin/products");
    });
    return { success: true };
  } catch (err) {
    console.error("[updateSale]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// updateShippingStatus

const DELIVERY_PROOF_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png":  "png",
  "image/webp": "webp",
} as const;
type DeliveryProofContentType = keyof typeof DELIVERY_PROOF_EXTENSIONS;
const DELIVERY_PROOF_MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const DELIVERY_PROOF_MAX_SIGNATURE_BYTES = 1 * 1024 * 1024;

const deliveryProofSchema = z.object({
  saleId:       z.string().min(1).max(50),
  receiverName: z.string().trim().max(100).optional(),
  note:         z.string().trim().max(500).optional(),
});

type DeliveryProofImageKind = "signature" | "photo";
type DeliveryProofUploadResult = { url?: string; error?: string };

export type DeliveryProofDetail = {
  id:                string;
  receiverName:      string | null;
  signatureImageUrl: string | null;
  deliveryPhotoUrl:  string | null;
  note:              string | null;
  capturedAt:        string;
};

const getDeliveryProofFile = (formData: FormData, key: string): File | null => {
  const file = formData.get(key);
  if (!(file instanceof File) || file.size === 0) {
    return null;
  }

  return file;
};

const getDeliveryProofContentType = (file: File): DeliveryProofContentType | null => {
  if (file.type === "image/jpg") return "image/jpeg";
  if (file.type in DELIVERY_PROOF_EXTENSIONS) return file.type as DeliveryProofContentType;

  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";

  return null;
};

const uploadDeliveryProofImage = async ({
  saleId,
  file,
  kind,
}: {
  saleId: string;
  file: File;
  kind: DeliveryProofImageKind;
}): Promise<DeliveryProofUploadResult> => {
  const contentType = getDeliveryProofContentType(file);
  if (!contentType) {
    return { error: "อนุญาตเฉพาะไฟล์รูปภาพ JPEG, PNG หรือ WebP" };
  }

  const maxSize =
    kind === "signature" ? DELIVERY_PROOF_MAX_SIGNATURE_BYTES : DELIVERY_PROOF_MAX_PHOTO_BYTES;
  if (file.size > maxSize) {
    return {
      error:
        kind === "signature"
          ? "ไฟล์ลายเซ็นต้องไม่เกิน 1MB"
          : "ไฟล์รูปหลักฐานต้องไม่เกิน 5MB",
    };
  }

  const ext = DELIVERY_PROOF_EXTENSIONS[contentType];
  const safeSaleId = saleId.replace(/[^a-zA-Z0-9_-]/g, "");
  const filePath = `delivery-proofs/${safeSaleId}/${Date.now()}-${kind}-${crypto.randomUUID()}.${ext}`;
  const buffer = new Uint8Array(await file.arrayBuffer());
  const detectedType = sniffImageMimeType(buffer);
  if (!detectedType || !(detectedType in DELIVERY_PROOF_EXTENSIONS)) {
    return { error: "ไฟล์นี้ไม่ใช่รูปภาพที่รองรับ (JPEG, PNG, WebP)" };
  }

  try {
    // Backend (Supabase vs Vercel Blob) is selected by the IMAGE_STORAGE_PRODUCTS flag.
    const url = await uploadProductsBucketObject({
      objectPath: filePath,
      body: buffer,
      contentType: detectedType,
    });
    return { url };
  } catch (error) {
    await reportCriticalError(error, { scope: "sales.update" });
    return { error: "อัปโหลดรูปหลักฐานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
};

export async function getLatestDeliveryProof(
  saleId: string,
): Promise<{ proof?: DeliveryProofDetail | null; error?: string }> {
  const session = await requirePermission("delivery.view").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = z.string().min(1).max(50).safeParse(saleId);
  if (!parsed.success) return { error: "ข้อมูลใบขายไม่ถูกต้อง" };

  try {
    const proof = await db.deliveryProof.findFirst({
      where: {
        saleId: parsed.data,
        sale:   { fulfillmentType: FulfillmentType.DELIVERY },
      },
      orderBy: { capturedAt: "desc" },
      select: {
        id:                true,
        receiverName:      true,
        signatureImageUrl: true,
        deliveryPhotoUrl:  true,
        note:              true,
        capturedAt:        true,
      },
    });

    if (!proof) return { proof: null };

    return {
      proof: {
        ...proof,
        capturedAt: proof.capturedAt.toISOString(),
      },
    };
  } catch (err) {
    console.error("[getLatestDeliveryProof]", err);
    return { error: "โหลดหลักฐานการส่งไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
}

async function getSaleDeliveryAuditSnapshot(saleId: string) {
  const sale = await db.sale.findUnique({
    where: { id: saleId },
    select: {
      id: true,
      saleNo: true,
      shippingStatus: true,
      shippingMethod: true,
      trackingNo: true,
      deliveryStaffId: true,
      updatedAt: true,
    },
  });

  if (!sale) {
    return null;
  }

  return sale;
}

export async function saveDeliveryProof(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("delivery.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = deliveryProofSchema.safeParse({
    saleId:       formData.get("saleId"),
    receiverName: formData.get("receiverName") || undefined,
    note:         formData.get("note") || undefined,
  });
  if (!parsed.success) return { error: "ข้อมูลหลักฐานการส่งไม่ถูกต้อง" };

  const signatureFile = getDeliveryProofFile(formData, "signatureImage");
  const photoFile = getDeliveryProofFile(formData, "deliveryPhoto");
  const receiverName = parsed.data.receiverName?.trim() || null;
  const note = parsed.data.note?.trim() || null;

  if (!receiverName && !note && !signatureFile && !photoFile) {
    return { error: "กรุณาระบุหลักฐานอย่างน้อยหนึ่งรายการก่อนบันทึก" };
  }

  try {
    const sale = await db.sale.findUnique({
      where: { id: parsed.data.saleId },
      select: {
        id: true,
        saleNo: true,
        status: true,
        fulfillmentType: true,
      },
    });

    if (!sale || sale.status !== "ACTIVE") {
      return { error: "ไม่พบใบขาย หรือเอกสารถูกยกเลิกแล้ว" };
    }

    if (sale.fulfillmentType !== FulfillmentType.DELIVERY) {
      return { error: "ใบขายนี้ไม่ได้เป็นรายการจัดส่ง" };
    }

    const emptyUpload: DeliveryProofUploadResult = {};
    const [signatureUpload, photoUpload] = await Promise.all([
      signatureFile
        ? uploadDeliveryProofImage({
            saleId: sale.id,
            file:   signatureFile,
            kind:   "signature",
          })
        : Promise.resolve(emptyUpload),
      photoFile
        ? uploadDeliveryProofImage({
            saleId: sale.id,
            file:   photoFile,
            kind:   "photo",
          })
        : Promise.resolve(emptyUpload),
    ]);
    if (signatureUpload.error) return { error: signatureUpload.error };
    if (photoUpload.error) return { error: photoUpload.error };

    const requestContext = await getRequestContext();
    const proof = await db.deliveryProof.create({
      data: {
        saleId:            sale.id,
        receiverName,
        signatureImageUrl: signatureUpload.url ?? null,
        deliveryPhotoUrl:  photoUpload.url ?? null,
        note,
        capturedByUserId:  session.user.id,
      },
      select: {
        id: true,
        receiverName: true,
        signatureImageUrl: true,
        deliveryPhotoUrl: true,
        note: true,
        capturedAt: true,
      },
    });

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.CREATE,
      entityType: "DeliveryProof",
      entityId: proof.id,
      entityRef: sale.saleNo,
      after: {
        id: proof.id,
        saleId: sale.id,
        receiverName: proof.receiverName,
        signatureImageUrl: proof.signatureImageUrl,
        deliveryPhotoUrl: proof.deliveryPhotoUrl,
        note: proof.note,
        capturedAt: proof.capturedAt,
      },
      meta: { source: "delivery.proof" },
    });

    revalidatePath("/admin/delivery");
    revalidatePath("/admin/delivery/update");
    revalidatePath(`/admin/sales/${sale.id}`);
    return { success: true };
  } catch (err) {
    console.error("[saveDeliveryProof]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const shippingUpdateSchema = z.object({
  shippingStatus:  z.nativeEnum(ShippingStatus),
  trackingNo:      z.string().max(100).optional(),
  shippingMethod:  z.nativeEnum(ShippingMethod).optional(),
  deliveryStaffId: z.string().min(1).max(50).optional(),
});

export async function updateShippingStatus(
  saleId: string,
  data: {
    shippingStatus: string;
    trackingNo?: string;
    shippingMethod?: string;
    deliveryStaffId?: string;
  }
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("delivery.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = shippingUpdateSchema.safeParse(data);
  if (!parsed.success) return { error: "ข้อมูลไม่ถูกต้อง" };

  try {
    const requestContext = await getRequestContext();
    const existingSnapshot = await getSaleDeliveryAuditSnapshot(saleId);
    if (!existingSnapshot) {
      return { error: "ไม่พบใบขาย หรือเอกสารถูกยกเลิกแล้ว" };
    }
    const sale = await db.sale.findUnique({
      where: { id: saleId },
      select: {
        id: true,
        status: true,
        fulfillmentType: true,
        shippingStatus: true,
        shippingMethod: true,
        trackingNo: true,
        trackingToken: true,
        deliveryStaffId: true,
        deliveryCommissionItems: {
          where: {
            activeSaleId: saleId,
            run: { status: "ACTIVE" },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!sale || sale.status !== "ACTIVE") {
      return { error: "ไม่พบใบขาย หรือเอกสารถูกยกเลิกแล้ว" };
    }

    if (sale.fulfillmentType !== FulfillmentType.DELIVERY) {
      return { error: "ใบขายนี้ไม่ได้เป็นรายการจัดส่ง" };
    }

    if (
      sale.deliveryCommissionItems.length > 0 &&
      parsed.data.shippingStatus !== sale.shippingStatus
    ) {
      return {
        error:
          "บิลนี้ถูกทำจ่ายค่าส่งแล้ว หากต้องการเปลี่ยนสถานะ กรุณายกเลิกเอกสารทำจ่ายก่อน",
      };
    }

    const nextShippingMethod = parsed.data.shippingMethod ?? sale.shippingMethod;
    const nextTrackingNo = parsed.data.trackingNo ?? sale.trackingNo ?? undefined;
    const requiresTrackingNo =
      nextShippingMethod !== ShippingMethod.NONE && nextShippingMethod !== ShippingMethod.SELF;

    if (requiresTrackingNo && !nextTrackingNo?.trim()) {
      return { error: "กรุณาระบุเลขติดตามสำหรับการจัดส่งผ่านขนส่งภายนอก" };
    }

    // Explicit pick from the delivery queue popup wins over the auto-stamp below.
    const selectedStaffId = parsed.data.deliveryStaffId;
    if (selectedStaffId && selectedStaffId !== sale.deliveryStaffId) {
      if (sale.deliveryCommissionItems.length > 0) {
        return {
          error:
            "บิลนี้ถูกทำจ่ายค่าส่งแล้ว หากต้องการเปลี่ยนผู้ส่ง กรุณายกเลิกเอกสารทำจ่ายก่อน",
        };
      }

      const staff = await db.user.findFirst({
        where:  { id: selectedStaffId, isActive: true },
        select: { id: true },
      });
      if (!staff) return { error: "ไม่พบผู้ส่งที่เลือก หรือบัญชีถูกปิดใช้งานแล้ว" };
    }

    const shouldStampDeliveryStaff =
      !selectedStaffId &&
      (parsed.data.shippingStatus === ShippingStatus.OUT_FOR_DELIVERY ||
        (parsed.data.shippingStatus === ShippingStatus.DELIVERED && !sale.deliveryStaffId));

    // Auto-generate tracking token when sale first moves to OUT_FOR_DELIVERY
    const shouldGenerateToken =
      parsed.data.shippingStatus === ShippingStatus.OUT_FOR_DELIVERY &&
      sale.shippingStatus !== ShippingStatus.OUT_FOR_DELIVERY &&
      !sale.trackingToken;

    const shouldClearTrackingExpiry =
      parsed.data.shippingStatus === ShippingStatus.OUT_FOR_DELIVERY &&
      Boolean(sale.trackingToken || shouldGenerateToken);

    // Expire token 48 hours after delivery is marked done
    const shouldExpireToken =
      parsed.data.shippingStatus === ShippingStatus.DELIVERED && sale.trackingToken;

    const beforeSnapshot = existingSnapshot;
    await db.sale.update({
      where: { id: saleId },
      data: {
        shippingStatus: parsed.data.shippingStatus,
        ...(parsed.data.trackingNo !== undefined ? { trackingNo: parsed.data.trackingNo } : {}),
        ...(parsed.data.shippingMethod !== undefined ? { shippingMethod: parsed.data.shippingMethod } : {}),
        ...(selectedStaffId ? { deliveryStaffId: selectedStaffId } : {}),
        ...(shouldStampDeliveryStaff ? { deliveryStaffId: session.user.id } : {}),
        ...(shouldGenerateToken
          ? {
              trackingToken: generateTrackingToken(),
            }
          : {}),
        ...(shouldClearTrackingExpiry ? { trackingExpiry: null } : {}),
        ...(shouldExpireToken
          ? { trackingExpiry: new Date(Date.now() + TRACKING_TOKEN_TTL_MS) }
          : {}),
      },
    });

    const afterSnapshot = await getSaleDeliveryAuditSnapshot(saleId);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "Sale",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.saleNo,
        before: diff.before,
        after: diff.after,
        meta: { source: "delivery.update" },
      });
    }
    revalidatePath("/admin/delivery");
    revalidatePath("/admin/delivery/update");
    revalidatePath("/admin/delivery-commissions");
    revalidatePath(`/admin/sales/${saleId}`);
    return { success: true };
  } catch (err) {
    console.error("[updateShippingStatus]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// reorderDeliveryQueue - manual queue ordering for /admin/delivery/update

const reorderQueueSchema = z.object({
  saleIds: z.array(z.string().min(1)).min(1).max(100),
});

export async function reorderDeliveryQueue(
  saleIds: string[],
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("delivery.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = reorderQueueSchema.safeParse({ saleIds });
  if (!parsed.success) return { error: "ข้อมูลไม่ถูกต้อง" };

  try {
    const requestContext = await getRequestContext();
    const openQueueWhere = {
      fulfillmentType: FulfillmentType.DELIVERY,
      status: "ACTIVE" as const,
      shippingStatus: { in: [ShippingStatus.PENDING, ShippingStatus.OUT_FOR_DELIVERY] },
    };

    const [sales, totalOpenQueueCount] = await Promise.all([
      db.sale.findMany({
        where: {
          id: { in: parsed.data.saleIds },
          ...openQueueWhere,
        },
        select: {
          id: true,
          saleNo: true,
          deliveryQueueOrder: true,
        },
      }),
      db.sale.count({ where: openQueueWhere }),
    ]);

    if (sales.length === 0) return { error: "ไม่พบใบขายที่ต้องจัดเรียง" };

    if (sales.length !== totalOpenQueueCount || parsed.data.saleIds.length !== totalOpenQueueCount) {
      return {
        error:
          "กรุณาเปิดคิวจัดส่งหลักและโหลดรายการให้ครบก่อนจัดลำดับ",
      };
    }

    const saleMap = new Map(sales.map((s) => [s.id, s]));
    const orderedSales = parsed.data.saleIds
      .map((id) => saleMap.get(id))
      .filter((s): s is (typeof sales)[number] => Boolean(s));

    const before = orderedSales.map((s) => ({
      saleNo: s.saleNo,
      order:  s.deliveryQueueOrder,
    }));
    const after = orderedSales.map((s, index) => ({
      saleNo: s.saleNo,
      order:  index + 1,
    }));

    await dbTx(async (tx) => {
      for (let i = 0; i < orderedSales.length; i++) {
        const sale = orderedSales[i];
        const nextOrder = i + 1;
        if (sale.deliveryQueueOrder === nextOrder) continue;
        await tx.sale.update({
          where: { id: sale.id },
          data:  { deliveryQueueOrder: nextOrder },
        });
      }
    });

    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action:     AuditAction.UPDATE,
      entityType: "Sale",
      entityId:   null,
      entityRef:  `delivery-queue:${orderedSales.length}`,
      before,
      after,
      meta:       { source: "delivery.queue-reorder", count: orderedSales.length },
    });

    revalidatePath("/admin/delivery");
    revalidatePath("/admin/delivery/update");
    return { success: true };
  } catch (err) {
    console.error("[reorderDeliveryQueue]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// fetchProductLots - for SaleForm auto-allocate

export async function fetchProductLots(
  productId: string,
  lotIssueMethod: string
): Promise<LotAvailableJSON[] | { error: string }> {
  const session = await requireSaleLotPermission();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  if (!productId) return { error: "ไม่ระบุสินค้า" };
  try {
    const lots: LotAvailableJSON[] = await getLotAvailability(db, productId);
    if (lotIssueMethod === "FEFO") {
      lots.sort((a, b) => {
        if (!a.expDate) return 1;
        if (!b.expDate) return -1;
        return a.expDate.localeCompare(b.expDate);
      });
    } else {
      lots.sort((a, b) => {
        if (!a.mfgDate) return 1;
        if (!b.mfgDate) return -1;
        return a.mfgDate.localeCompare(b.mfgDate);
      });
    }
    return lots;
  } catch {
    return { error: "ไม่สามารถโหลดข้อมูล Lot ได้" };
  }
}
