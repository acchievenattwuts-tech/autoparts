"use server";

import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db, dbTx } from "@/lib/db";
import { reportCriticalError } from "@/lib/error-reporting";
import { requireAnyPermission, requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { writeStockCard, recalculateStockCardMany } from "@/lib/stock-card";
import { generatePurchaseNo } from "@/lib/doc-number";
import { getDocumentMutationBlockMessage } from "@/lib/document-mutation-guard";
import {
  AuditAction,
  PaymentMethod,
  PurchasePaymentStatus,
  PurchaseType,
  VatType,
} from "@/lib/generated/prisma";
import { calcVat, calcItemSubtotal } from "@/lib/vat";
import { Prisma } from "@/lib/generated/prisma";
import { formatDateOnlyForInput, parseDateOnlyToDate } from "@/lib/th-date";
import { writePurchaseLots, writeStockMovementLots, reversePurchaseLotBalance, validateLotRows, type LotSubRow } from "@/lib/lot-control";
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
import { isInventoryTracked } from "@/lib/inventory-tracking";
import { refreshProductPurchaseLastFields } from "@/lib/product-purchase-last";

const serializePurchaseProductOption = (product: TransactionProductDetailRow) => ({
  id: product.id,
  code: product.code,
  name: product.name,
  description: product.description,
  purchaseUnitName: product.purchaseUnitName,
  costPrice: product.costPrice,
  categoryName: product.categoryName,
  brandName: product.brandName,
  units: product.units,
  isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
  requireExpiryDate: product.requireExpiryDate,
  isActive: product.isActive,
});

export async function searchPurchaseProducts(query: string) {
  const session = await requireAnyPermission(["purchases.create", "purchases.update"]).catch(
    () => null,
  );
  if (!session?.user?.id) return [];

  return (await searchTransactionProductDetailRows(query)).map(serializePurchaseProductOption);
}

export async function loadPurchaseProductsByIds(ids: string[]) {
  const session = await requireAnyPermission(["purchases.create", "purchases.update"]).catch(() => null);
  if (!session?.user?.id) return [];
  return (await getTransactionProductDetailRowsByIds(ids)).map(serializePurchaseProductOption);
}

const lotSubRowSchema = z.object({
  lotNo:    z.string().min(1).max(100),
  qty:      z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
  mfgDate:  z.string().default(""),
  expDate:  z.string().default(""),
});

const purchaseItemSchema = z.object({
  productId:   z.string().min(1).max(50),
  unitName:    z.string().min(1).max(20),
  qty:         z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  costPrice:   z.coerce.number().min(0, "ราคาต้องไม่ติดลบ"),   // per selected unit
  landedCost:  z.coerce.number().min(0).default(0),             // per selected unit
  moreDetail:  z.string().max(500).optional(),
  lotItems:    z.array(lotSubRowSchema).default([]),
});

const purchaseSchema = z.object({
  supplierId:   z.string().min(1, "กรุณาเลือกผู้จำหน่าย").max(50),
  purchaseDate: z.string().min(1),
  purchaseType: z.nativeEnum(PurchaseType).default(PurchaseType.CASH_PURCHASE),
  cashBankAccountId: z.string().optional(),
  discount:     z.coerce.number().min(0).default(0),
  shippingFee:  z.coerce.number().min(0).default(0),
  note:         z.string().max(500).optional(),
  referenceNo:  z.string().max(100).optional(),
  vatType:      z.nativeEnum(VatType).default(VatType.NO_VAT),
  vatRate:      z.coerce.number().min(0).max(100).default(0),
  creditTerm:   z.coerce.number().int().min(0).max(365).optional(),
  items:        z.array(purchaseItemSchema).min(1, "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ").max(300),
});

type PurchaseTxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];
type PurchaseItemInput = z.infer<typeof purchaseItemSchema>;

type PurchaseProductSnapshot = {
  isLotControl: boolean;
  requireExpiryDate: boolean;
  inventoryTracking: string;
};

type PurchaseLandedStockCardSnapshot = {
  id: string;
  productId: string;
  docDate: Date;
  sorder: number;
};

const getPurchaseUnitKey = (productId: string, unitName: string): string => `${productId}::${unitName}`;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Keep non-finite computed numbers out of batched parameterized SQL writes.
function safeSqlNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

// Build a stable signature for a purchase line in BASE-UNIT terms.
// Two lines that produce identical StockCard + lot effects share the same
// signature, so the differential updater can keep them untouched.
type StockSignatureLot = {
  lotNo: string;
  qtyInBase: number;
  unitCostBase: number;
  mfgDate: Date | null;
  expDate: Date | null;
};

function buildItemStockSignature(payload: {
  productId: string;
  qtyInBase: number;
  costPerBase: number;
  lots: StockSignatureLot[];
}): string {
  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  const lotsSig = payload.lots
    .map((l) =>
      [
        l.lotNo,
        round4(l.qtyInBase),
        round4(l.unitCostBase),
        l.mfgDate ? l.mfgDate.toISOString() : "",
        l.expDate ? l.expDate.toISOString() : "",
      ].join("|"),
    )
    .sort()
    .join("//");
  return [
    payload.productId,
    round4(payload.qtyInBase),
    round4(payload.costPerBase),
    lotsSig,
  ].join("||");
}

// Allocate signed landed-cost adjustment (shippingFee − discount) by line value.
// Positive amount raises per-unit cost (shipping); negative lowers it (trade discount).
function allocateLandedByLineValue(
  items: PurchaseItemInput[],
  netAdjustment: number,
): Map<number, number> {
  const allocation = new Map<number, number>();
  const roundedAdjustment = roundMoney(netAdjustment);
  if (roundedAdjustment === 0 || items.length === 0) {
    items.forEach((_, index) => allocation.set(index, 0));
    return allocation;
  }

  const lineValues = items.map((item) => roundMoney(item.qty * item.costPrice));
  const totalLineValue = roundMoney(lineValues.reduce((sum, value) => sum + value, 0));
  if (totalLineValue <= 0) {
    items.forEach((_, index) => allocation.set(index, 0));
    return allocation;
  }

  let allocatedTotal = 0;
  lineValues.forEach((lineValue, index) => {
    const amount = index === lineValues.length - 1
      ? roundMoney(roundedAdjustment - allocatedTotal)
      : roundMoney((roundedAdjustment * lineValue) / totalLineValue);
    allocation.set(index, amount);
    allocatedTotal = roundMoney(allocatedTotal + amount);
  });

  return allocation;
}

async function preloadPurchaseDependencies(
  tx: PurchaseTxClient,
  items: PurchaseItemInput[],
): Promise<{
  unitMap: Map<string, { scale: number }>;
  productMap: Map<string, PurchaseProductSnapshot>;
}> {
  const productIds = [...new Set(items.map((item) => item.productId))];
  const uniquePairs = [
    ...new Map(items.map((item) => [getPurchaseUnitKey(item.productId, item.unitName), item])).values(),
  ];

  const [units, products] = await Promise.all([
    uniquePairs.length === 0
      ? Promise.resolve([])
      : tx.productUnit.findMany({
          where: {
            OR: uniquePairs.map((item) => ({
              productId: item.productId,
              name: item.unitName,
            })),
          },
          select: {
            productId: true,
            name: true,
            scale: true,
          },
        }),
    productIds.length === 0
      ? Promise.resolve([])
      : tx.product.findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            inventoryTracking: true,
            isLotControl: true,
            requireExpiryDate: true,
          },
        }),
  ]);

  return {
    unitMap: new Map(
      units.map((unit) => [
        getPurchaseUnitKey(unit.productId, unit.name),
        { scale: Number(unit.scale) },
      ]),
    ),
    productMap: new Map(
      products.map((product) => [
        product.id,
        {
          isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
          requireExpiryDate: product.requireExpiryDate,
          inventoryTracking: product.inventoryTracking,
        },
      ]),
    ),
  };
}

async function resolvePurchasePaymentMethod(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  purchaseType: PurchaseType,
  payments: DocumentPaymentRow[],
): Promise<PaymentMethod> {
  if (purchaseType === PurchaseType.CREDIT_PURCHASE) {
    return PaymentMethod.CREDIT;
  }

  if (payments.length === 0) {
    throw new Error("ไม่พบบัญชีจ่ายเงิน");
  }

  const accountIds = [...new Set(payments.map((row) => row.cashBankAccountId))];
  const accounts = await tx.cashBankAccount.findMany({
    where: { id: { in: accountIds } },
    select: { type: true },
  });
  if (accounts.length !== accountIds.length) {
    throw new Error("ไม่พบบัญชีจ่ายเงิน");
  }

  // Mixed channels: label as transfer unless every channel is cash.
  const allCash = accounts.every((account) => account.type === "CASH");
  return allCash ? PaymentMethod.CASH : PaymentMethod.TRANSFER;
}

async function refreshLatestPurchaseStockCardBalance(
  tx: PurchaseTxClient,
  row: PurchaseLandedStockCardSnapshot,
): Promise<boolean> {
  const laterRow = await tx.stockCard.findFirst({
    where: {
      productId: row.productId,
      OR: [
        { docDate: { gt: row.docDate } },
        { docDate: row.docDate, sorder: { gt: row.sorder } },
      ],
    },
    select: { id: true },
  });
  if (laterRow) return false;

  const rows = await tx.stockCard.findMany({
    where: { productId: row.productId },
    orderBy: [{ docDate: "asc" }, { sorder: "asc" }],
    select: {
      id: true,
      source: true,
      qtyIn: true,
      qtyOut: true,
      priceIn: true,
      landedCost: true,
      usesReferenceCost: true,
    },
  });

  let baQty = 0;
  let baPrice = 0;
  let baTotal = 0;
  let currentPriceOut = 0;
  let currentQtyBalance = 0;
  let currentPriceBalance = 0;
  const neutralInSources = ["RETURN_IN", "CLAIM_RETURN_IN", "CLAIM_RECV_IN"];

  for (const stockRow of rows) {
    const qIn = Number(stockRow.qtyIn);
    const qOut = Number(stockRow.qtyOut);
    const usesRef = stockRow.usesReferenceCost === true;
    const pIn =
      qIn > 0 && neutralInSources.includes(stockRow.source) && !usesRef
        ? baPrice
        : Number(stockRow.priceIn);
    const landedCost = Number(stockRow.landedCost);
    const newQty = baQty + qIn - qOut;
    let newPrice = 0;
    let newTotal = 0;
    let priceOut = baPrice;

    if (qIn > 0) {
      if (newQty > 0) {
        if (baQty > 0) {
          newTotal = baTotal + qIn * pIn - qOut * baPrice + landedCost;
          newPrice = newTotal / newQty;
        } else {
          newPrice = pIn + landedCost / qIn;
          newTotal = newPrice * newQty;
        }
      }
    } else if (usesRef && Number(stockRow.priceIn) > 0) {
      const refCost = Number(stockRow.priceIn);
      priceOut = refCost;
      if (newQty >= 0) {
        newTotal = baTotal - qOut * refCost;
        if (newTotal < 0) newTotal = 0;
        newPrice = newQty > 0 ? newTotal / newQty : 0;
      }
    } else {
      priceOut = baPrice;
      if (newQty >= 0) {
        newPrice = baPrice;
        newTotal = baTotal - qOut * baPrice;
        if (newTotal < 0) newTotal = 0;
      }
    }

    baQty = newQty;
    baPrice = newPrice;
    baTotal = newTotal;

    if (stockRow.id === row.id) {
      currentPriceOut = priceOut;
      currentQtyBalance = newQty;
      currentPriceBalance = newPrice > 0 ? newPrice : 0;
    }
  }

  await tx.stockCard.update({
    where: { id: row.id },
    data: {
      priceOut: new Prisma.Decimal(currentPriceOut),
      qtyBalance: new Prisma.Decimal(currentQtyBalance),
      priceBalance: new Prisma.Decimal(currentPriceBalance),
    },
  });

  await tx.product.update({
    where: { id: row.productId },
    data: {
      stock: Math.round(baQty),
      avgCost: new Prisma.Decimal(baPrice > 0 ? baPrice : 0),
    },
  });

  return true;
}

function derivePurchasePaymentStatus(purchaseType: PurchaseType): PurchasePaymentStatus {
  return purchaseType === PurchaseType.CASH_PURCHASE
    ? PurchasePaymentStatus.PAID
    : PurchasePaymentStatus.UNPAID;
}

async function getPurchaseAuditSnapshot(purchaseId: string) {
  const [purchase, payments] = await Promise.all([
    db.purchase.findUnique({
    where: { id: purchaseId },
    include: {
      supplier: {
        select: {
          code: true,
          name: true,
        },
      },
      items: {
        orderBy: [{ lineNo: "asc" }, { id: "asc" }],
        select: {
          lineNo: true,
          productId: true,
          supplierId: true,
          quantity: true,
          costPrice: true,
          landedCost: true,
          totalAmount: true,
          subtotalAmount: true,
          moreDetail: true,
          product: {
            select: {
              code: true,
              name: true,
            },
          },
        },
      },
    },
  }),
    db.documentPayment.findMany({
      where: { docType: DocumentPaymentDocType.PURCHASE, docId: purchaseId },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      select: { cashBankAccountId: true, amount: true },
    }),
  ]);

  if (!purchase) return null;

  return {
    id: purchase.id,
    purchaseNo: purchase.purchaseNo,
    supplierId: purchase.supplierId,
    supplierRef: purchase.supplier?.code ?? purchase.supplier?.name ?? null,
    purchaseDate: purchase.purchaseDate,
    purchaseType: purchase.purchaseType,
    status: purchase.status,
    paymentMethod: purchase.paymentMethod,
    paymentStatus: purchase.paymentStatus,
    cashBankAccountId: purchase.cashBankAccountId,
    creditTerm: purchase.creditTerm,
    totalAmount: purchase.totalAmount,
    discount: purchase.discount,
    shippingFee: purchase.shippingFee,
    subtotalAmount: purchase.subtotalAmount,
    vatAmount: purchase.vatAmount,
    vatType: purchase.vatType,
    vatRate: purchase.vatRate,
    netAmount: purchase.netAmount,
    amountRemain: purchase.amountRemain,
    referenceNo: purchase.referenceNo,
    note: purchase.note,
    cancelNote: purchase.cancelNote,
    cancelledAt: purchase.cancelledAt,
    items: purchase.items.map((item) => ({
      productId: item.productId,
      productCode: item.product.code,
      productName: item.product.name,
      lineNo: item.lineNo,
      supplierId: item.supplierId,
      quantity: item.quantity,
      costPrice: item.costPrice,
      landedCost: item.landedCost,
      totalAmount: item.totalAmount,
      subtotalAmount: item.subtotalAmount,
      moreDetail: item.moreDetail,
    })),
    payments: payments.map((payment) => ({
      cashBankAccountId: payment.cashBankAccountId,
      amount: payment.amount,
    })),
  };
}

export async function createPurchase(
  formData: FormData
): Promise<{ success?: boolean; purchaseId?: string; purchaseNo?: string; error?: string }> {
  const session = await requirePermission("purchases.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  let items: z.infer<typeof purchaseItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch { return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" }; }

  const parsed = purchaseSchema.safeParse({
    supplierId:   formData.get("supplierId") || undefined,
    purchaseDate: formData.get("purchaseDate"),
    purchaseType: (formData.get("purchaseType") as PurchaseType) || PurchaseType.CASH_PURCHASE,
    cashBankAccountId: formData.get("cashBankAccountId") || undefined,
    discount:     formData.get("discount") || 0,
    shippingFee:  formData.get("shippingFee") || 0,
    note:         formData.get("note") || undefined,
    referenceNo:  formData.get("referenceNo") || undefined,
    vatType:      (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:      formData.get("vatRate") || 0,
    creditTerm:   formData.get("creditTerm") || undefined,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { supplierId, purchaseDate, purchaseType, discount, shippingFee, note, referenceNo, vatType, vatRate, creditTerm, items: validItems } = parsed.data;

  // Calculate totals — landed adjustment = shippingFee (raises cost) − discount (lowers cost),
  // allocated to lines by line value so MAVG reflects true net cost (IAS 2 compliant).
  const totalAmount = validItems.reduce((sum, item) => sum + item.qty * item.costPrice, 0);
  const landedAllocations = allocateLandedByLineValue(validItems, shippingFee - discount);
  const discountedTotal = Math.max(0, totalAmount + shippingFee - discount);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(discountedTotal, vatType, vatRate);
  const resolvedCreditTerm =
    purchaseType === PurchaseType.CREDIT_PURCHASE ? (creditTerm ?? null) : null;

  let payments: DocumentPaymentRow[] = [];
  if (purchaseType === PurchaseType.CASH_PURCHASE) {
    try {
      payments = parseDocumentPaymentRows(formData.get("payments"));
    } catch {
      return { error: "รูปแบบข้อมูลช่องทางจ่ายเงินไม่ถูกต้อง" };
    }
    if (payments.length === 0) {
      return { error: "กรุณาระบุช่องทางจ่ายเงินอย่างน้อย 1 ช่องทาง" };
    }
    try {
      assertPaymentsMatchTotal(payments, netAmount);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "ยอดช่องทางจ่ายเงินไม่ถูกต้อง" };
    }
  }
  const resolvedCashBankAccountId = derivePrimaryAccountId(payments) ?? undefined;

  const paymentStatus = derivePurchasePaymentStatus(purchaseType);
  const purchasePrefix = purchaseType === PurchaseType.CREDIT_PURCHASE ? "RRC" : "RR";
  const purchaseNo = await generatePurchaseNo(purchasePrefix, parseDateOnlyToDate(purchaseDate));
  let createdPurchaseId = "";

  try {
    const requestContext = await getRequestContext();
    await dbTx(async (tx) => {
      const resolvedPaymentMethod = await resolvePurchasePaymentMethod(
        tx,
        purchaseType,
        payments,
      );
      const { productMap, unitMap } = await preloadPurchaseDependencies(tx, validItems);

      // 1. Create Purchase header
      const purchase = await tx.purchase.create({
        data: {
          purchaseNo,
          supplierId:    supplierId || null,
          userId:        session.user!.id!,
          totalAmount:   totalAmount,
          discount:      discount,
          shippingFee,
          netAmount:     netAmount,
          purchaseType,
          amountRemain:  new Prisma.Decimal(
            purchaseType === PurchaseType.CASH_PURCHASE ? 0 : netAmount,
          ),
          note,
          vatType,
          vatRate,
          subtotalAmount,
          vatAmount,
          referenceNo:   referenceNo ?? null,
          purchaseDate:  parseDateOnlyToDate(purchaseDate),
          paymentMethod: resolvedPaymentMethod,
          paymentStatus,
          cashBankAccountId: resolvedCashBankAccountId || null,
          creditTerm: resolvedCreditTerm,
        },
      });
      createdPurchaseId = purchase.id;

      // 2. Process each line item
      for (const [itemIndex, item] of validItems.entries()) {
        // Get unit scale
        const unit = unitMap.get(getPurchaseUnitKey(item.productId, item.unitName));
        const product = productMap.get(item.productId);
        if (!product) throw new Error("ไม่พบสินค้า");
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale       = unit.scale;
        const qtyInBase   = item.qty * scale;
        const costPerBase = item.costPrice / scale;  // convert to base unit cost
        const allocatedLandedForLine = landedAllocations.get(itemIndex) ?? 0;
        const landedCostPerSelectedUnit = item.qty > 0 ? allocatedLandedForLine / item.qty : 0;
        const isTracked   = isInventoryTracked(product.inventoryTracking);

        const itemTotal    = item.qty * item.costPrice;
        const itemSubtotal = calcItemSubtotal(itemTotal, vatType, vatRate);

        // Create PurchaseItem
        const purchaseItem = await tx.purchaseItem.create({
          data: {
            purchaseId:    purchase.id,
            lineNo:        itemIndex + 1,
            productId:     item.productId,
            supplierId:    supplierId || null,
            quantity:      Math.round(qtyInBase),
            costPrice:     costPerBase,
            totalAmount:   itemTotal,
            subtotalAmount: itemSubtotal,
            landedCost:    landedCostPerSelectedUnit,
            showQty:       item.qty,
            showUnitName:  item.unitName,
            showPricePerUnit: item.costPrice,
            unitScale:     scale,
            moreDetail:    item.moreDetail || null,
          },
        });

        // 3. Write StockCard with MAVG
        const stockCardId = isTracked ? await writeStockCard(tx, {
          productId:   item.productId,
          docNo:       purchaseNo,
          docDate:     parseDateOnlyToDate(purchaseDate),
          source:      "PURCHASE",
          qtyIn:       qtyInBase,
          qtyOut:      0,
          priceIn:     costPerBase,
          landedCost:  allocatedLandedForLine,
          detail:      `ซื้อเข้า ${item.qty} ${item.unitName}`,
          referenceId: purchaseItem.id,
        }) : null;

        // 4. Lot Control - only if product has isLotControl=true
        if (stockCardId && item.lotItems.length > 0 && product?.isLotControl) {
            // Validate lot rows (server-side)
            const lotErr = validateLotRows(item.lotItems as LotSubRow[], item.qty, product.requireExpiryDate);
            if (lotErr) throw new Error(lotErr);

            // Convert lot rows to base unit
            const lotsInBase = item.lotItems.map((lot) => ({
              lotNo:        lot.lotNo.trim(),
              qtyInBase:    lot.qty * scale,
              unitCostBase: lot.unitCost / scale,
              mfgDate:      lot.mfgDate ? parseDateOnlyToDate(lot.mfgDate) : null,
              expDate:      lot.expDate ? parseDateOnlyToDate(lot.expDate) : null,
            }));

            await writePurchaseLots(tx, purchaseItem.id, item.productId, lotsInBase);
            await writeStockMovementLots(tx, stockCardId, lotsInBase, "in");
        }
      }

      await refreshProductPurchaseLastFields(
        tx,
        validItems.map((item) => item.productId),
      );

      await replaceDocumentPayments(
        tx,
        DocumentPaymentDocType.PURCHASE,
        purchase.id,
        CashBankDirection.OUT,
        payments,
      );

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.PURCHASE,
        purchase.id,
        toCashBankEntries(payments, {
          txnDate: parseDateOnlyToDate(purchaseDate),
          direction: CashBankDirection.OUT,
          referenceNo: purchaseNo,
          note: note ?? null,
        }),
      );
    });

    const afterSnapshot = createdPurchaseId
      ? await getPurchaseAuditSnapshot(createdPurchaseId)
      : null;
    if (afterSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "Purchase",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.purchaseNo,
        after: afterSnapshot,
      });
    }

    // ล้างแคชแบบ deferred ด้วย after() — callback ถูกรัน "หลัง" response ถูกส่ง
    // ออกไปแล้ว ทำให้ Server Action ไม่แนบ RSC payload ของหน้าปัจจุบันกลับมา
    // router จึงไม่ re-render หน้าฟอร์มทิ้ง (แก้อาการจอกระพริบ 1 ครั้งหลังบันทึก)
    // ผลการล้างแคชเท่าเดิมทุกประการ เพียงเกิดขึ้นช้ากว่าไม่กี่มิลลิวินาที
    after(() => {
      revalidatePath("/admin/purchases");
      revalidatePath("/admin/products");
    });
    return { success: true, purchaseId: createdPurchaseId, purchaseNo };
  } catch (err) {
    await reportCriticalError(err, { scope: "purchases.create" });
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const cancelPurchaseSchema = z.object({
  purchaseId: z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelPurchase(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("purchases.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelPurchaseSchema.safeParse({
    purchaseId: formData.get("purchaseId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { purchaseId, cancelNote } = parsed.data;

  const purchase = await db.purchase.findUnique({
    where: { id: purchaseId },
    include: {
      items:          { orderBy: { lineNo: "asc" }, select: { id: true, productId: true } },
      purchaseReturns: { where: { status: "ACTIVE" }, select: { returnNo: true } },
      supplierPaymentItems: {
        where: { payment: { status: "ACTIVE" } },
        select: { payment: { select: { paymentNo: true } } },
      },
    },
  });
  if (!purchase)                        return { error: "ไม่พบเอกสาร" };
  if (purchase.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกไปแล้ว" };
  const mutationBlockMessage = await getDocumentMutationBlockMessage("Purchase", purchaseId, "cancel");
  if (mutationBlockMessage) return { error: mutationBlockMessage };

  // Reference chain check: ห้ามยกเลิกถ้ามีใบคืนสินค้าที่ยัง active
  if (purchase.purchaseReturns.length > 0) {
    const nos = purchase.purchaseReturns.map((r) => r.returnNo).join(", ");
    return { error: `ไม่สามารถยกเลิกได้ มีใบคืนสินค้าที่อ้างอิงอยู่: ${nos} กรุณายกเลิกใบคืนก่อน` };
  }

  // Reference chain check: ห้ามยกเลิกถ้ามี SupplierPayment ที่ยัง active อ้างถึง
  if (purchase.supplierPaymentItems.length > 0) {
    const nos = [...new Set(purchase.supplierPaymentItems.map((i) => i.payment.paymentNo))].join(", ");
    return { error: `ไม่สามารถยกเลิกได้ มีเอกสารจ่ายชำระที่อ้างอิงอยู่: ${nos} กรุณายกเลิกเอกสารจ่ายชำระก่อน` };
  }

  const affectedProductIds = [...new Set(purchase.items.map((i) => i.productId))];

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getPurchaseAuditSnapshot(purchaseId);
    await dbTx(async (tx) => {
      await clearCashBankSourceMovements(tx, CashBankSourceType.PURCHASE, purchaseId);
      await clearDocumentPayments(tx, DocumentPaymentDocType.PURCHASE, purchaseId);
      // Reverse Lot balances before deleting StockCard rows
      for (const item of purchase.items) {
        await reversePurchaseLotBalance(tx, item.id, item.productId);
      }
      await tx.stockCard.deleteMany({ where: { docNo: purchase.purchaseNo } });
      await recalculateStockCardMany(tx, affectedProductIds);
      await tx.purchase.update({
        where: { id: purchaseId },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelNote, amountRemain: new Prisma.Decimal(0) },
      });
    });

    const afterSnapshot = await getPurchaseAuditSnapshot(purchaseId);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CANCEL,
        entityType: "Purchase",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.purchaseNo,
        before: diff.before,
        after: diff.after,
        meta: { cancelNote: cancelNote ?? null },
      });
    }

    revalidatePath("/admin/purchases");
    return { success: true };
  } catch (err) {
    await reportCriticalError(err, { scope: "purchases.cancel" });
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// updatePurchase

export async function updatePurchase(
  id: string,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("purchases.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสเอกสารไม่ถูกต้อง" };
  }

  // Load existing purchase (with full item data so we can diff against the
  // incoming items and skip StockCard / lot work for unchanged lines).
  const existing = await db.purchase.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { lineNo: "asc" },
        select: {
          id: true,
          lineNo: true,
          productId: true,
          quantity: true,
          costPrice: true,
          landedCost: true,
          lotItems: {
            orderBy: { id: "asc" },
            select: {
              lotNo: true,
              qty: true,
              unitCost: true,
              mfgDate: true,
              expDate: true,
            },
          },
        },
      },
      purchaseReturns: { where: { status: "ACTIVE" }, select: { returnNo: true } },
      supplierPaymentItems: {
        where: { payment: { status: "ACTIVE" } },
        select: { payment: { select: { paymentNo: true } } },
      },
    },
  });
  if (!existing)                        return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };
  const mutationBlockMessage = await getDocumentMutationBlockMessage("Purchase", id, "update");
  if (mutationBlockMessage) return { error: mutationBlockMessage };
  if (existing.purchaseReturns.length > 0) {
    const nos = existing.purchaseReturns.map((r) => r.returnNo).join(", ");
    return { error: `ไม่สามารถแก้ไขได้ มีใบคืนสินค้าที่อ้างอิงอยู่: ${nos}` };
  }
  if (existing.supplierPaymentItems.length > 0) {
    const nos = [...new Set(existing.supplierPaymentItems.map((i) => i.payment.paymentNo))].join(", ");
    return { error: `ไม่สามารถแก้ไขได้ มีเอกสารจ่ายชำระที่อ้างอิงอยู่: ${nos}` };
  }

  // Parse form data
  let items: z.infer<typeof purchaseItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch { return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" }; }

  const parsed = purchaseSchema.safeParse({
    supplierId:   formData.get("supplierId") || undefined,
    purchaseDate: formData.get("purchaseDate"),
    purchaseType: (formData.get("purchaseType") as PurchaseType) || existing.purchaseType,
    cashBankAccountId: formData.get("cashBankAccountId") || undefined,
    discount:     formData.get("discount") || 0,
    shippingFee:  formData.get("shippingFee") || 0,
    note:         formData.get("note") || undefined,
    referenceNo:  formData.get("referenceNo") || undefined,
    vatType:      (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:      formData.get("vatRate") || 0,
    creditTerm:   formData.get("creditTerm") || undefined,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { supplierId, purchaseDate, purchaseType, discount, shippingFee, note, referenceNo, vatType, vatRate, creditTerm, items: validItems } = parsed.data;

  const totalAmount     = validItems.reduce((sum, item) => sum + item.qty * item.costPrice, 0);
  const landedAllocations = allocateLandedByLineValue(validItems, shippingFee - discount);
  const discountedTotal = Math.max(0, totalAmount + shippingFee - discount);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(discountedTotal, vatType, vatRate);
  const resolvedCreditTerm =
    purchaseType === PurchaseType.CREDIT_PURCHASE ? (creditTerm ?? null) : null;

  let payments: DocumentPaymentRow[] = [];
  if (purchaseType === PurchaseType.CASH_PURCHASE) {
    try {
      payments = parseDocumentPaymentRows(formData.get("payments"));
    } catch {
      return { error: "รูปแบบข้อมูลช่องทางจ่ายเงินไม่ถูกต้อง" };
    }
    if (payments.length === 0) {
      return { error: "กรุณาระบุช่องทางจ่ายเงินอย่างน้อย 1 ช่องทาง" };
    }
    try {
      assertPaymentsMatchTotal(payments, netAmount);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "ยอดช่องทางจ่ายเงินไม่ถูกต้อง" };
    }
  }
  const resolvedCashBankAccountId = derivePrimaryAccountId(payments) ?? undefined;

  const oldProductIds = [...new Set(existing.items.map((i) => i.productId))];
  const paymentStatus = derivePurchasePaymentStatus(purchaseType);

  // ─── Differential Analysis ────────────────────────────────────────────────
  // Compare incoming items against existing items in base-unit terms. Lines
  // that match an existing line by signature are left untouched (no lot
  // reverse, no StockCard rewrite, no MAVG recalc). Lines that don't match
  // are removed; new lines are added. Fall back to a full reset whenever the
  // landed-cost allocation across lines could shift (different docDate, or
  // shipping/discount/totalLineValue changed while allocation is active),
  // because that would require updating every line's landedCost anyway.
  const purchaseDateChanged =
    formatDateOnlyForInput(existing.purchaseDate) !== purchaseDate;
  const oldShipping = Number(existing.shippingFee);
  const oldDiscount = Number(existing.discount);
  const allocationActive =
    oldShipping > 0 || oldDiscount > 0 || shippingFee > 0 || discount > 0;
  const oldTotalLineValue = existing.items.reduce(
    (sum, i) => sum + Number(i.quantity) * Number(i.costPrice),
    0,
  );
  const newTotalLineValue = totalAmount;
  const allocationsMayShift =
    allocationActive &&
    (oldShipping !== shippingFee ||
      oldDiscount !== discount ||
      Math.abs(oldTotalLineValue - newTotalLineValue) > 0.0001);

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
      getPurchaseUnitKey(u.productId, u.name),
      Number(u.scale),
    ]),
  );

  type ExistingItemSig = {
    existingItemId: string;
    productId: string;
    signature: string;
  };
  type NewItemSig = {
    newIdx: number;
    productId: string;
    signature: string;
  };

  const oldItemSigs: ExistingItemSig[] = existing.items.map((item) => ({
    existingItemId: item.id,
    productId: item.productId,
    signature: buildItemStockSignature({
      productId: item.productId,
      qtyInBase: Number(item.quantity),
      costPerBase: Number(item.costPrice),
      lots: item.lotItems.map((l) => ({
        lotNo: l.lotNo,
        qtyInBase: Number(l.qty),
        unitCostBase: Number(l.unitCost),
        mfgDate: l.mfgDate,
        expDate: l.expDate,
      })),
    }),
  }));

  const newItemSigs: NewItemSig[] = validItems.map((item, idx) => {
    const scale =
      newUnitScaleMap.get(getPurchaseUnitKey(item.productId, item.unitName)) ?? 1;
    return {
      newIdx: idx,
      productId: item.productId,
      signature: buildItemStockSignature({
        productId: item.productId,
        qtyInBase: item.qty * scale,
        costPerBase: item.costPrice / scale,
        lots: (item.lotItems ?? []).map((l) => ({
          lotNo: l.lotNo.trim(),
          qtyInBase: l.qty * scale,
          unitCostBase: l.unitCost / scale,
          mfgDate: l.mfgDate ? parseDateOnlyToDate(l.mfgDate) : null,
          expDate: l.expDate ? parseDateOnlyToDate(l.expDate) : null,
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

  const canUpdateLandedAllocationInPlace =
    !purchaseDateChanged &&
    allocationsMayShift &&
    removedExistingItems.length === 0 &&
    addedNewItems.length === 0;
  const useDifferential =
    !purchaseDateChanged && (!allocationsMayShift || canUpdateLandedAllocationInPlace);
  const affectedProductIds = new Set<string>();
  removedExistingItems.forEach((r) => affectedProductIds.add(r.productId));
  addedNewItems.forEach((a) => affectedProductIds.add(a.productId));

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getPurchaseAuditSnapshot(id);
    await dbTx(async (tx) => {
      const resolvedPaymentMethod = await resolvePurchasePaymentMethod(
        tx,
        purchaseType,
        payments,
      );
      const productIdsNeedingRecalc = new Set<string>();

      // 1. Drop stock effects for removed/changed lines only.
      //    Differential path: only the lines that didn't survive signature
      //    matching are reversed + deleted. Fallback path: everything is
      //    reversed and we rebuild from scratch (original behaviour).
      if (useDifferential) {
        for (const removed of removedExistingItems) {
          await reversePurchaseLotBalance(tx, removed.existingItemId, removed.productId);
          const deletedStockCards = await tx.stockCard.deleteMany({
            where: {
              docNo: existing.purchaseNo,
              referenceId: removed.existingItemId,
            },
          });
          if (deletedStockCards.count > 0) {
            productIdsNeedingRecalc.add(removed.productId);
          }
          // Cascade removes PurchaseItemLot rows as well.
          await tx.purchaseItem.delete({ where: { id: removed.existingItemId } });
        }
      } else {
        const oldStockProducts = await tx.stockCard.findMany({
          where: { docNo: existing.purchaseNo },
          select: { productId: true },
          distinct: ["productId"],
        });
        oldStockProducts.forEach((row) => productIdsNeedingRecalc.add(row.productId));
        const oldItems = await tx.purchaseItem.findMany({
          where: { purchaseId: id },
          select: { id: true, productId: true },
        });
        // Reverse lot balances for every removed line in batch: one lookup of
        // all their lot rows, aggregate the decrement per (product, lot), then a
        // single clamped UPDATE. GREATEST(balance - Σqty, 0) equals the per-row
        // decrement-then-clamp sequence because qty decrements are monotonic.
        if (oldItems.length > 0) {
          const productByItemId = new Map(oldItems.map((i) => [i.id, i.productId]));
          const oldLots = await tx.purchaseItemLot.findMany({
            where: { purchaseItemId: { in: oldItems.map((i) => i.id) } },
            select: { purchaseItemId: true, lotNo: true, qty: true },
          });
          const decByProductLot = new Map<string, { productId: string; lotNo: string; dec: Prisma.Decimal }>();
          for (const lot of oldLots) {
            const productId = productByItemId.get(lot.purchaseItemId);
            if (!productId) continue;
            const key = `${productId}\u0000${lot.lotNo}`;
            const existingDec = decByProductLot.get(key);
            if (existingDec) existingDec.dec = existingDec.dec.add(lot.qty);
            else decByProductLot.set(key, { productId, lotNo: lot.lotNo, dec: new Prisma.Decimal(lot.qty) });
          }
          if (decByProductLot.size > 0) {
            const values = Prisma.join(
              [...decByProductLot.values()].map((d) => Prisma.sql`(
                ${d.productId},
                ${d.lotNo},
                ${d.dec.toString()}::numeric
              )`),
            );
            await tx.$executeRaw`
              UPDATE "LotBalance" AS lb
              SET "qtyOnHand" = GREATEST(lb."qtyOnHand" - d."dec", 0)
              FROM (VALUES ${values}) AS d("productId","lotNo","dec")
              WHERE lb."productId" = d."productId" AND lb."lotNo" = d."lotNo"
            `;
          }
        }
        await tx.stockCard.deleteMany({ where: { docNo: existing.purchaseNo } });
        await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      }

      // 2. Update header
      await tx.purchase.update({
        where: { id },
        data: {
          supplierId:    supplierId || null,
          purchaseDate:  parseDateOnlyToDate(purchaseDate),
          discount,
          note:          note ?? null,
          referenceNo:   referenceNo ?? null,
          vatType,
          vatRate,
          totalAmount,
          shippingFee,
          subtotalAmount,
          vatAmount,
          netAmount,
          purchaseType,
          amountRemain:  new Prisma.Decimal(
            purchaseType === PurchaseType.CASH_PURCHASE ? 0 : netAmount,
          ),
          paymentMethod: resolvedPaymentMethod,
          paymentStatus,
          cashBankAccountId: resolvedCashBankAccountId || null,
          creditTerm: resolvedCreditTerm,
        },
      });

      // 2b. Sync header-derived fields on items we kept untouched in the
      //     differential path. supplierId, subtotalAmount (VAT-derived) live
      //     on PurchaseItem so they must follow the header. When only landed
      //     allocation changed and every line still matches, update the
      //     existing line + StockCard landed cost in place instead of
      //     rebuilding item/lot rows for the whole document.
      if (useDifferential && matchedByNewIdx.size > 0) {
          // Collect the header-derived field values for every matched line, then
          // write them in ONE bulk UPDATE instead of one round-trip per line.
          // Values are identical to the per-row update that ran before.
          type MatchedSync = {
            id: string;
            lineNo: number;
            subtotalAmount: number;
            showQty: number;
            showUnitName: string;
            showPricePerUnit: number;
            unitScale: number;
            landedCostPerSelectedUnit: number;
            allocatedLandedForLine: number;
            moreDetail: string | null;
          };
          const syncRows: MatchedSync[] = [];
          for (const [newIdx, existingItemId] of matchedByNewIdx) {
            const item = validItems[newIdx];
            const displayScale =
              newUnitScaleMap.get(getPurchaseUnitKey(item.productId, item.unitName)) ?? 1;
            const itemTotal = item.qty * item.costPrice;
            const itemSubtotal = calcItemSubtotal(itemTotal, vatType, vatRate);
            const allocatedLandedForLine = landedAllocations.get(newIdx) ?? 0;
            syncRows.push({
              id: existingItemId,
              lineNo: newIdx + 1,
              subtotalAmount: itemSubtotal,
              showQty: item.qty,
              showUnitName: item.unitName,
              showPricePerUnit: item.costPrice,
              unitScale: displayScale,
              landedCostPerSelectedUnit: item.qty > 0 ? allocatedLandedForLine / item.qty : 0,
              allocatedLandedForLine,
              moreDetail: item.moreDetail || null,
            });
          }

          // supplierId is the same for every line; landedCost is only synced when
          // the allocation can be updated in place (otherwise left untouched).
          const supplierValue = supplierId || null;
          const values = Prisma.join(
            syncRows.map((r) => {
              // Keep landed cost as a plain value (number | null) instead of a
              // nested Prisma.sql fragment. NULL leaves pi."landedCost" untouched
              // via the COALESCE below — behaviour is identical to before.
              const landedCostValue: number | null = canUpdateLandedAllocationInPlace
                ? safeSqlNumber(r.landedCostPerSelectedUnit)
                : null;
              return Prisma.sql`(
                ${r.id},
                ${r.lineNo}::int,
                ${safeSqlNumber(r.subtotalAmount)}::numeric,
                ${safeSqlNumber(r.showQty)}::numeric,
                ${r.showUnitName},
                ${safeSqlNumber(r.showPricePerUnit)}::numeric,
                ${safeSqlNumber(r.unitScale)}::numeric,
                ${landedCostValue}::numeric,
                ${r.moreDetail}::text
              )`;
            }),
          );
          await tx.$executeRaw`
            UPDATE "PurchaseItem" AS pi SET
              "supplierId" = ${supplierValue},
              "lineNo" = d."lineNo",
              "subtotalAmount" = d."subtotalAmount",
              "showQty" = d."showQty",
              "showUnitName" = d."showUnitName",
              "showPricePerUnit" = d."showPricePerUnit",
              "unitScale" = d."unitScale",
              "landedCost" = COALESCE(d."landedCost", pi."landedCost"),
              "moreDetail" = d."moreDetail"
            FROM (VALUES ${values}) AS d(
              "id","lineNo","subtotalAmount","showQty","showUnitName",
              "showPricePerUnit","unitScale","landedCost","moreDetail"
            )
            WHERE pi."id" = d."id"
          `;

          if (canUpdateLandedAllocationInPlace) {
            // Refresh StockCard landed cost in place: one bulk UPDATE for the
            // landed cost of every affected row, then replay the latest balance.
            const allocByRef = new Map(syncRows.map((r) => [r.id, r.allocatedLandedForLine]));
            const changedRows = await tx.stockCard.findMany({
              where: { docNo: existing.purchaseNo, referenceId: { in: syncRows.map((r) => r.id) } },
              select: { id: true, productId: true, docDate: true, sorder: true, referenceId: true },
            });
            if (changedRows.length > 0) {
              const scValues = Prisma.join(
                changedRows.map((row) => Prisma.sql`(
                  ${row.id},
                  ${safeSqlNumber(allocByRef.get(row.referenceId ?? "") ?? 0)}::numeric
                )`),
              );
              await tx.$executeRaw`
                UPDATE "StockCard" AS sc SET "landedCost" = d."landedCost"
                FROM (VALUES ${scValues}) AS d("id","landedCost")
                WHERE sc."id" = d."id"
              `;

              for (const row of changedRows) {
                const refreshed = await refreshLatestPurchaseStockCardBalance(tx, {
                  id: row.id,
                  productId: row.productId,
                  docDate: row.docDate,
                  sorder: row.sorder,
                });
                if (!refreshed) {
                  productIdsNeedingRecalc.add(row.productId);
                }
              }
            }
          }
      }

      // 3. Create items + stock cards.
      //    Differential: only added/changed lines. Fallback: every line.
      const itemsToCreate: { item: typeof validItems[number]; itemIndex: number }[] =
        useDifferential
          ? addedNewItems.map((a) => ({ item: validItems[a.newIdx], itemIndex: a.newIdx }))
          : validItems.map((item, itemIndex) => ({ item, itemIndex }));

      const { productMap, unitMap } = await preloadPurchaseDependencies(
        tx,
        itemsToCreate.map(({ item }) => item),
      );
      const stockProductIdsToCreate = [
        ...new Set(
          itemsToCreate
            .map(({ item }) => item.productId)
            .filter((productId) => {
              const product = productMap.get(productId);
              return product && isInventoryTracked(product.inventoryTracking);
            }),
        ),
      ];
      const maxSorderRows = stockProductIdsToCreate.length > 0
        ? await tx.stockCard.groupBy({
            by: ["productId"],
            where: { productId: { in: stockProductIdsToCreate } },
            _max: { sorder: true },
          })
        : [];
      const nextSorderByProductId = new Map(
        maxSorderRows.map((row) => [
          row.productId,
          (row._max.sorder ?? 0) + 1,
        ]),
      );

      // Resolve every line's derived values up-front (validating product/unit),
      // then write items + stock cards in batched statements rather than one
      // round-trip per line. Computed values are identical to the per-row path.
      const docDateForStock = parseDateOnlyToDate(purchaseDate);
      type PreparedLine = {
        itemIndex: number;
        item: typeof validItems[number];
        productId: string;
        lineNo: number;
        scale: number;
        qtyInBase: number;
        costPerBase: number;
        allocatedLandedForLine: number;
        landedCostPerSelectedUnit: number;
        isTracked: boolean;
        itemTotal: number;
        itemSubtotal: number;
        sorder: number | null; // assigned only for tracked lines
      };
      const prepared: PreparedLine[] = [];
      for (const { item, itemIndex } of itemsToCreate) {
        const unit = unitMap.get(getPurchaseUnitKey(item.productId, item.unitName));
        const product = productMap.get(item.productId);
        if (!product) throw new Error("ไม่พบสินค้า");
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale = unit.scale;
        const qtyInBase = item.qty * scale;
        const costPerBase = item.costPrice / scale;
        const allocatedLandedForLine = landedAllocations.get(itemIndex) ?? 0;
        const isTracked = isInventoryTracked(product.inventoryTracking);
        const itemTotal = item.qty * item.costPrice;

        // sorder is assigned only for tracked lines, in iteration order, exactly
        // as the per-row stock-card draft did, so values stay identical.
        let sorder: number | null = null;
        if (isTracked) {
          sorder = nextSorderByProductId.get(item.productId) ?? 1;
          nextSorderByProductId.set(item.productId, sorder + 1);
        }

        prepared.push({
          itemIndex,
          item,
          productId: item.productId,
          lineNo: itemIndex + 1,
          scale,
          qtyInBase,
          costPerBase,
          allocatedLandedForLine,
          landedCostPerSelectedUnit: item.qty > 0 ? allocatedLandedForLine / item.qty : 0,
          isTracked,
          itemTotal,
          itemSubtotal: calcItemSubtotal(itemTotal, vatType, vatRate),
          sorder,
        });
      }

      if (prepared.length > 0) {
        // 3a. Create all PurchaseItem rows in one statement, then read their ids
        //     back (createMany does not return ids). lineNo is unique per
        //     document, so it keys the new rows reliably.
        await tx.purchaseItem.createMany({
          data: prepared.map((p) => ({
            purchaseId:       id,
            lineNo:           p.lineNo,
            productId:        p.productId,
            supplierId:       supplierId || null,
            quantity:         Math.round(p.qtyInBase),
            costPrice:        p.costPerBase,
            totalAmount:      p.itemTotal,
            subtotalAmount:   p.itemSubtotal,
            landedCost:       p.landedCostPerSelectedUnit,
            showQty:          p.item.qty,
            showUnitName:     p.item.unitName,
            showPricePerUnit: p.item.costPrice,
            unitScale:        p.scale,
            moreDetail:       p.item.moreDetail || null,
          })),
        });
        const createdItems = await tx.purchaseItem.findMany({
          where: { purchaseId: id, id: { notIn: [...matchedExistingIds] } },
          select: { id: true, lineNo: true },
        });
        const itemIdByLineNo = new Map(createdItems.map((r) => [r.lineNo, r.id]));

        // 3b. Create all StockCard draft rows (tracked lines) in one statement.
        const trackedLines = prepared.filter((p) => p.isTracked && p.sorder !== null);
        if (trackedLines.length > 0) {
          await tx.stockCard.createMany({
            data: trackedLines.map((p) => ({
              productId:   p.productId,
              docNo:       existing.purchaseNo,
              docDate:     docDateForStock,
              source:      "PURCHASE" as const,
              sorder:      p.sorder as number,
              qtyIn:       new Prisma.Decimal(p.qtyInBase),
              qtyOut:      new Prisma.Decimal(0),
              qtyBalance:  new Prisma.Decimal(0),
              landedCost:  new Prisma.Decimal(p.allocatedLandedForLine),
              priceIn:     new Prisma.Decimal(p.costPerBase),
              priceOut:    new Prisma.Decimal(0),
              priceBalance: new Prisma.Decimal(0),
              detail:      `ซื้อเข้า ${p.item.qty} ${p.item.unitName}`,
              referenceId: itemIdByLineNo.get(p.lineNo) ?? null,
            })),
          });
          trackedLines.forEach((p) => productIdsNeedingRecalc.add(p.productId));
        }

        // 3c. Lot rows: only for lot-controlled tracked lines (rare). Map back
        //     the freshly-created StockCard ids by referenceId.
        const lotLines = prepared.filter((p) => {
          const product = productMap.get(p.productId);
          return p.isTracked && p.item.lotItems.length > 0 && product?.isLotControl;
        });
        if (lotLines.length > 0) {
          const lotItemIds = lotLines
            .map((p) => itemIdByLineNo.get(p.lineNo))
            .filter((v): v is string => Boolean(v));
          const lotStockCards = await tx.stockCard.findMany({
            where: { docNo: existing.purchaseNo, referenceId: { in: lotItemIds } },
            select: { id: true, referenceId: true },
          });
          const stockCardIdByItemId = new Map(
            lotStockCards.map((row) => [row.referenceId ?? "", row.id]),
          );
          for (const p of lotLines) {
            const product = productMap.get(p.productId);
            const lotErr = validateLotRows(
              p.item.lotItems as LotSubRow[],
              p.item.qty,
              product?.requireExpiryDate ?? false,
            );
            if (lotErr) throw new Error(lotErr);

            const purchaseItemId = itemIdByLineNo.get(p.lineNo);
            const stockCardId = purchaseItemId ? stockCardIdByItemId.get(purchaseItemId) : undefined;
            if (!purchaseItemId || !stockCardId) throw new Error("ไม่พบรายการสินค้าที่เพิ่งสร้าง");

            const lotsInBase = p.item.lotItems.map((lot) => ({
              lotNo:        lot.lotNo.trim(),
              qtyInBase:    lot.qty * p.scale,
              unitCostBase: lot.unitCost / p.scale,
              mfgDate:      lot.mfgDate ? parseDateOnlyToDate(lot.mfgDate) : null,
              expDate:      lot.expDate ? parseDateOnlyToDate(lot.expDate) : null,
            }));

            await writePurchaseLots(tx, purchaseItemId, p.productId, lotsInBase);
            await writeStockMovementLots(tx, stockCardId, lotsInBase, "in");
          }
        }
      }

      await recalculateStockCardMany(tx, productIdsNeedingRecalc);

      await refreshProductPurchaseLastFields(
        tx,
        new Set([...oldProductIds, ...validItems.map((item) => item.productId)]),
      );

      await replaceDocumentPayments(
        tx,
        DocumentPaymentDocType.PURCHASE,
        id,
        CashBankDirection.OUT,
        payments,
      );

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.PURCHASE,
        id,
        toCashBankEntries(payments, {
          txnDate: parseDateOnlyToDate(purchaseDate),
          direction: CashBankDirection.OUT,
          referenceNo: existing.purchaseNo,
          note: note ?? null,
        }),
      );
    });

    const afterSnapshot = await getPurchaseAuditSnapshot(id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "Purchase",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.purchaseNo,
        before: diff.before,
        after: diff.after,
      });
    }

    // ล้างแคชแบบ deferred ด้วย after() — เหตุผลเดียวกับใน createPurchase
    // ฟอร์มแก้ไขอยู่หน้าเดิมหลังบันทึก จึงต้องไม่ให้ router re-render ทิ้ง
    after(() => {
      revalidatePath("/admin/purchases");
      revalidatePath(`/admin/purchases/${id}`);
      revalidatePath("/admin/products");
    });
    return { success: true };
  } catch (err) {
    await reportCriticalError(err, { scope: "purchases.update" });
    if (err instanceof Error && /lock timeout|deadlock/i.test(err.message)) {
      return { error: "มีการบันทึกใบนี้ซ้อนกันอยู่ กรุณารอสักครู่แล้วลองใหม่อีกครั้ง" };
    }
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
