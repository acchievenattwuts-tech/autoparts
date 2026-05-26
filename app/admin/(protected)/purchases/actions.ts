"use server";

import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db, dbTx } from "@/lib/db";
import { requireAnyPermission, requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
import { generatePurchaseNo } from "@/lib/doc-number";
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
import { searchProductIds, sortProductsByIds } from "@/lib/product-search";
import { CashBankDirection, CashBankSourceType } from "@/lib/generated/prisma";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";
import { isInventoryTracked } from "@/lib/inventory-tracking";

const purchaseProductOptionSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  purchaseUnitName: true,
  costPrice: true,
  inventoryTracking: true,
  isLotControl: true,
  requireExpiryDate: true,
  category: { select: { name: true } },
  brand:    { select: { name: true } },
  aliases:  { select: { alias: true } },
  units: {
    select: { name: true, scale: true, isBase: true },
    orderBy: { isBase: "desc" },
  },
} as const;

export async function searchPurchaseProducts(query: string) {
  const session = await requireAnyPermission(["purchases.create", "purchases.update"]).catch(
    () => null,
  );
  if (!session?.user?.id) return [];

  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 3) return [];

  const searchResult = await searchProductIds({
    query: normalizedQuery,
    isActive: true,
    take: 20,
  });
  if (searchResult.ids.length === 0) return [];

  const products = await db.product.findMany({
    where: { id: { in: searchResult.ids } },
    select: purchaseProductOptionSelect,
  });

  return sortProductsByIds(products, searchResult.ids).map((product) => ({
    id: product.id,
    code: product.code,
    name: product.name,
    description: product.description,
    purchaseUnitName: product.purchaseUnitName,
    costPrice: Number(product.costPrice),
    categoryName: product.category.name,
    brandName: product.brand?.name ?? null,
    aliases: product.aliases.map((alias) => alias.alias),
    units: product.units.map((unit) => ({ name: unit.name, scale: Number(unit.scale), isBase: unit.isBase })),
    isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
    requireExpiryDate: product.requireExpiryDate,
  }));
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
  items:        z.array(purchaseItemSchema).min(1, "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ").max(100),
});

type PurchaseTxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];
type PurchaseItemInput = z.infer<typeof purchaseItemSchema>;

type PurchaseProductSnapshot = {
  isLotControl: boolean;
  requireExpiryDate: boolean;
  inventoryTracking: string;
};

type PurchaseStockCardDraft = {
  productId: string;
  docNo: string;
  docDate: Date;
  source: "PURCHASE";
  qtyIn: number;
  qtyOut: number;
  priceIn: number;
  landedCost?: number;
  detail?: string;
  referenceId?: string;
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
  accountId: string | undefined,
): Promise<PaymentMethod> {
  if (purchaseType === PurchaseType.CREDIT_PURCHASE) {
    return PaymentMethod.CREDIT;
  }

  if (!accountId) {
    throw new Error("ไม่พบบัญชีจ่ายเงิน");
  }

  const account = await tx.cashBankAccount.findUnique({
    where: { id: accountId },
    select: { type: true },
  });
  if (!account) {
    throw new Error("ไม่พบบัญชีจ่ายเงิน");
  }

  return account.type === "CASH" ? PaymentMethod.CASH : PaymentMethod.TRANSFER;
}

async function createPurchaseStockCardDraft(
  tx: PurchaseTxClient,
  input: PurchaseStockCardDraft,
  nextSorderByProductId: Map<string, number>,
): Promise<string> {
  const nextSorder = nextSorderByProductId.get(input.productId) ?? 1;
  nextSorderByProductId.set(input.productId, nextSorder + 1);

  const row = await tx.stockCard.create({
    data: {
      productId: input.productId,
      docNo: input.docNo,
      docDate: input.docDate,
      source: input.source,
      sorder: nextSorder,
      qtyIn: new Prisma.Decimal(input.qtyIn),
      qtyOut: new Prisma.Decimal(input.qtyOut),
      qtyBalance: new Prisma.Decimal(0),
      landedCost: new Prisma.Decimal(input.landedCost ?? 0),
      priceIn: new Prisma.Decimal(input.priceIn),
      priceOut: new Prisma.Decimal(0),
      priceBalance: new Prisma.Decimal(0),
      detail: input.detail,
      referenceId: input.referenceId,
    },
    select: { id: true },
  });

  return row.id;
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
  const purchase = await db.purchase.findUnique({
    where: { id: purchaseId },
    include: {
      supplier: {
        select: {
          code: true,
          name: true,
        },
      },
      items: {
        orderBy: { id: "asc" },
        select: {
          productId: true,
          supplierId: true,
          quantity: true,
          costPrice: true,
          landedCost: true,
          totalAmount: true,
          subtotalAmount: true,
          product: {
            select: {
              code: true,
              name: true,
            },
          },
        },
      },
    },
  });

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
      supplierId: item.supplierId,
      quantity: item.quantity,
      costPrice: item.costPrice,
      landedCost: item.landedCost,
      totalAmount: item.totalAmount,
      subtotalAmount: item.subtotalAmount,
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

  const { supplierId, purchaseDate, purchaseType, cashBankAccountId, discount, shippingFee, note, referenceNo, vatType, vatRate, creditTerm, items: validItems } = parsed.data;

  // Calculate totals — landed adjustment = shippingFee (raises cost) − discount (lowers cost),
  // allocated to lines by line value so MAVG reflects true net cost (IAS 2 compliant).
  const totalAmount = validItems.reduce((sum, item) => sum + item.qty * item.costPrice, 0);
  const landedAllocations = allocateLandedByLineValue(validItems, shippingFee - discount);
  const discountedTotal = Math.max(0, totalAmount + shippingFee - discount);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(discountedTotal, vatType, vatRate);
  const resolvedCashBankAccountId =
    purchaseType === PurchaseType.CASH_PURCHASE ? cashBankAccountId : undefined;
  const resolvedCreditTerm =
    purchaseType === PurchaseType.CREDIT_PURCHASE ? (creditTerm ?? null) : null;

  if (purchaseType === PurchaseType.CASH_PURCHASE && !resolvedCashBankAccountId) {
    return { error: "กรุณาเลือกบัญชีจ่ายเงิน" };
  }
  if (false) {
    return { error: "การชำระบางส่วนของใบซื้อจะเปิดในรอบถัดไป กรุณาใช้ชำระเต็มหรือยังไม่ชำระก่อน" };
  }

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
        resolvedCashBankAccountId,
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
            productId:     item.productId,
            supplierId:    supplierId || null,
            quantity:      Math.round(qtyInBase),
            costPrice:     costPerBase,
            totalAmount:   itemTotal,
            subtotalAmount: itemSubtotal,
            landedCost:    landedCostPerSelectedUnit,
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

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.PURCHASE,
        purchase.id,
        purchaseType === PurchaseType.CASH_PURCHASE && resolvedCashBankAccountId
          ? [{
              accountId: resolvedCashBankAccountId,
              txnDate: parseDateOnlyToDate(purchaseDate),
              direction: CashBankDirection.OUT,
              amount: netAmount,
              referenceNo: purchaseNo,
              note: note ?? null,
            }]
          : [],
      );
    }, { timeout: 120_000 });

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

    revalidatePath("/admin/purchases");
    revalidatePath("/admin/products");
    return { success: true, purchaseId: createdPurchaseId, purchaseNo };
  } catch (err) {
    console.error("[createPurchase]", err);
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
      items:          { select: { id: true, productId: true } },
      purchaseReturns: { where: { status: "ACTIVE" }, select: { returnNo: true } },
      supplierPaymentItems: {
        where: { payment: { status: "ACTIVE" } },
        select: { payment: { select: { paymentNo: true } } },
      },
    },
  });
  if (!purchase)                        return { error: "ไม่พบเอกสาร" };
  if (purchase.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกไปแล้ว" };

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
      // Reverse Lot balances before deleting StockCard rows
      for (const item of purchase.items) {
        await reversePurchaseLotBalance(tx, item.id, item.productId);
      }
      await tx.stockCard.deleteMany({ where: { docNo: purchase.purchaseNo } });
      for (const productId of affectedProductIds) {
        await recalculateStockCard(tx, productId);
      }
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
    console.error("[cancelPurchase]", err);
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
        select: {
          id: true,
          productId: true,
          quantity: true,
          costPrice: true,
          landedCost: true,
          lotItems: {
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

  const { supplierId, purchaseDate, purchaseType, cashBankAccountId, discount, shippingFee, note, referenceNo, vatType, vatRate, creditTerm, items: validItems } = parsed.data;

  const totalAmount     = validItems.reduce((sum, item) => sum + item.qty * item.costPrice, 0);
  const landedAllocations = allocateLandedByLineValue(validItems, shippingFee - discount);
  const discountedTotal = Math.max(0, totalAmount + shippingFee - discount);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(discountedTotal, vatType, vatRate);
  const resolvedCashBankAccountId =
    purchaseType === PurchaseType.CASH_PURCHASE ? cashBankAccountId : undefined;
  const resolvedCreditTerm =
    purchaseType === PurchaseType.CREDIT_PURCHASE ? (creditTerm ?? null) : null;

  if (purchaseType === PurchaseType.CASH_PURCHASE && !resolvedCashBankAccountId) {
    return { error: "กรุณาเลือกบัญชีจ่ายเงิน" };
  }
  if (false) {
    return { error: "การชำระบางส่วนของใบซื้อจะเปิดในรอบถัดไป กรุณาใช้ชำระเต็มหรือยังไม่ชำระก่อน" };
  }

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
        resolvedCashBankAccountId,
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
        for (const item of oldItems) {
          await reversePurchaseLotBalance(tx, item.id, item.productId);
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
        const supplierIdChanged =
          (existing.supplierId ?? null) !== (supplierId || null);
        const taxBasisChanged =
          existing.vatType !== vatType ||
          Math.abs(Number(existing.vatRate) - vatRate) > 0.0001;
        if (supplierIdChanged || taxBasisChanged || canUpdateLandedAllocationInPlace) {
          const changedStockCardIds: string[] = [];
          for (const [newIdx, existingItemId] of matchedByNewIdx) {
            const item = validItems[newIdx];
            const itemTotal = item.qty * item.costPrice;
            const itemSubtotal = calcItemSubtotal(itemTotal, vatType, vatRate);
            const allocatedLandedForLine = landedAllocations.get(newIdx) ?? 0;
            const landedCostPerSelectedUnit =
              item.qty > 0 ? allocatedLandedForLine / item.qty : 0;
            await tx.purchaseItem.update({
              where: { id: existingItemId },
              data: {
                supplierId: supplierId || null,
                subtotalAmount: itemSubtotal,
                ...(canUpdateLandedAllocationInPlace
                  ? { landedCost: landedCostPerSelectedUnit }
                  : {}),
              },
            });

            if (canUpdateLandedAllocationInPlace) {
              const updatedStockCards = await tx.stockCard.findMany({
                where: { docNo: existing.purchaseNo, referenceId: existingItemId },
                select: { id: true },
              });
              const updatedStockCardIds = updatedStockCards.map((row) => row.id);
              if (updatedStockCardIds.length > 0) {
                changedStockCardIds.push(...updatedStockCardIds);
                await tx.stockCard.updateMany({
                  where: { id: { in: updatedStockCardIds } },
                  data: { landedCost: allocatedLandedForLine },
                });
              }
            }
          }

          if (canUpdateLandedAllocationInPlace && changedStockCardIds.length > 0) {
            const changedRows = await tx.stockCard.findMany({
              where: { id: { in: changedStockCardIds } },
              select: {
                id: true,
                productId: true,
                docDate: true,
                sorder: true,
              },
            });

            for (const row of changedRows) {
              const refreshed = await refreshLatestPurchaseStockCardBalance(tx, row);
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

      for (const { item, itemIndex } of itemsToCreate) {
        const unit = unitMap.get(getPurchaseUnitKey(item.productId, item.unitName));
        const product = productMap.get(item.productId);
        if (!product) throw new Error("ไม่พบสินค้า");
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale       = unit.scale;
        const qtyInBase   = item.qty * scale;
        const costPerBase = item.costPrice / scale;
        const allocatedLandedForLine = landedAllocations.get(itemIndex) ?? 0;
        const landedCostPerSelectedUnit = item.qty > 0 ? allocatedLandedForLine / item.qty : 0;
        const isTracked   = isInventoryTracked(product.inventoryTracking);
        const itemTotal   = item.qty * item.costPrice;
        const itemSubtotal = calcItemSubtotal(itemTotal, vatType, vatRate);

        const purchaseItem = await tx.purchaseItem.create({
          data: {
            purchaseId:    id,
            productId:     item.productId,
            supplierId:    supplierId || null,
            quantity:      Math.round(qtyInBase),
            costPrice:     costPerBase,
            totalAmount:   itemTotal,
            subtotalAmount: itemSubtotal,
            landedCost:    landedCostPerSelectedUnit,
          },
        });

        const stockCardId = isTracked ? await createPurchaseStockCardDraft(tx, {
          productId:   item.productId,
          docNo:       existing.purchaseNo,
          docDate:     parseDateOnlyToDate(purchaseDate),
          source:      "PURCHASE",
          qtyIn:       qtyInBase,
          qtyOut:      0,
          priceIn:     costPerBase,
          landedCost:  allocatedLandedForLine,
          detail:      `ซื้อเข้า ${item.qty} ${item.unitName}`,
          referenceId: purchaseItem.id,
        }, nextSorderByProductId) : null;
        if (stockCardId) {
          productIdsNeedingRecalc.add(item.productId);
        }
        if (stockCardId && item.lotItems.length > 0 && product?.isLotControl) {
            const lotErr = validateLotRows(item.lotItems as LotSubRow[], item.qty, product.requireExpiryDate);
            if (lotErr) throw new Error(lotErr);

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

      for (const productId of productIdsNeedingRecalc) {
        await recalculateStockCard(tx, productId);
      }

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.PURCHASE,
        id,
        purchaseType === PurchaseType.CASH_PURCHASE && resolvedCashBankAccountId
          ? [{
              accountId: resolvedCashBankAccountId,
              txnDate: parseDateOnlyToDate(purchaseDate),
              direction: CashBankDirection.OUT,
              amount: netAmount,
              referenceNo: existing.purchaseNo,
              note: note ?? null,
            }]
          : [],
      );
    }, { timeout: 120_000 });

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

    revalidatePath("/admin/purchases");
    revalidatePath(`/admin/purchases/${id}`);
    revalidatePath("/admin/products");
    return { success: true };
  } catch (err) {
    console.error("[updatePurchase]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}
