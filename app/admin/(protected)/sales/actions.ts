"use server";

import { createClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db, dbTx } from "@/lib/db";
import { requireAnyPermission, requirePermission } from "@/lib/require-auth";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
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
import { calcVat, calcItemSubtotal } from "@/lib/vat";
import { recalculateSaleAmountRemain } from "@/lib/amount-remain";
import { getLotAvailability, writeSaleLots, writeStockMovementLots, reverseSaleLotBalance, validateLotRows, type LotSubRow } from "@/lib/lot-control";
import type { LotAvailableJSON } from "@/lib/lot-control-client";
import { searchProductIds, sortProductsByIds } from "@/lib/product-search";
import { CashBankDirection, CashBankSourceType } from "@/lib/generated/prisma";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";
import { rebuildSaleProfitFacts } from "@/lib/profit-fact";
import { addThailandDays, parseDateOnlyToDate, startOfThailandDay } from "@/lib/th-date";
import { isInventoryTracked, resolveSaleUnitCost } from "@/lib/inventory-tracking";

const TRACKING_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

const saleProductOptionSelect = {
  id:                  true,
  code:                true,
  name:                true,
  description:         true,
  salePrice:           true,
  saleUnitName:        true,
  warrantyDays:        true,
  preferredSupplierId: true,
  inventoryTracking:   true,
  costPrice:           true,
  isLotControl:        true,
  lotIssueMethod:      true,
  allowExpiredIssue:   true,
  category:            { select: { name: true } },
  brand:               { select: { name: true } },
  aliases:             { select: { alias: true } },
  preferredSupplier:   { select: { name: true } },
  units: {
    select: { name: true, scale: true, isBase: true },
    orderBy: { isBase: "desc" },
  },
} as const;

export async function searchSaleProducts(query: string) {
  const session = await requireAnyPermission(["sales.create", "sales.update"]).catch(
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
    select: saleProductOptionSelect,
  });

  return sortProductsByIds(products, searchResult.ids).map((product) => ({
    id:                    product.id,
    code:                  product.code,
    name:                  product.name,
    description:           product.description,
    salePrice:             Number(product.salePrice),
    saleUnitName:          product.saleUnitName,
    warrantyDays:          product.warrantyDays,
    categoryName:          product.category.name,
    brandName:             product.brand?.name ?? null,
    aliases:               product.aliases.map((alias) => alias.alias),
    units:                 product.units.map((unit) => ({ name: unit.name, scale: Number(unit.scale), isBase: unit.isBase })),
    preferredSupplierId:   product.preferredSupplierId ?? null,
    preferredSupplierName: product.preferredSupplier?.name ?? null,
    isLotControl:          isInventoryTracked(product.inventoryTracking) && product.isLotControl,
    lotIssueMethod:        product.lotIssueMethod as string,
    allowExpiredIssue:     product.allowExpiredIssue,
  }));
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
  warrantyDays: z.coerce.number().int().min(0).default(0),
  supplierId:   z.string().max(50).optional(),
  supplierName: z.string().max(200).optional(),
  lotItems:     z.array(lotSubRowSchema).default([]),
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

type SaleTxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];
type SaleItemInput = z.infer<typeof saleItemSchema>;

type SaleProductSnapshot = {
  avgCost: Prisma.Decimal;
  costPrice: Prisma.Decimal;
  inventoryTracking: string;
  isLotControl: boolean;
};

const getSaleUnitKey = (productId: string, unitName: string): string => `${productId}::${unitName}`;

async function getSaleAuditSnapshot(saleId: string) {
  const sale = await db.sale.findUnique({
    where: { id: saleId },
    include: {
      items: {
        select: {
          productId: true,
          quantity: true,
          salePrice: true,
          totalAmount: true,
          warrantyDays: true,
          supplierId: true,
          supplierName: true,
        },
        orderBy: [{ productId: "asc" }, { id: "asc" }],
      },
    },
  });

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
      totalAmount: item.totalAmount,
      warrantyDays: item.warrantyDays,
      supplierId: item.supplierId,
      supplierName: item.supplierName,
    })),
  };
}

async function preloadSaleDependencies(
  tx: SaleTxClient,
  items: SaleItemInput[],
): Promise<{
  unitMap: Map<string, { scale: number }>;
  productMap: Map<string, SaleProductSnapshot>;
}> {
  const productIds = [...new Set(items.map((item) => item.productId))];
  const uniquePairs = [
    ...new Map(items.map((item) => [getSaleUnitKey(item.productId, item.unitName), item])).values(),
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
            avgCost: true,
            costPrice: true,
            inventoryTracking: true,
            isLotControl: true,
          },
        }),
  ]);

  return {
    unitMap: new Map(
      units.map((unit) => [
        getSaleUnitKey(unit.productId, unit.name),
        { scale: Number(unit.scale) },
      ]),
    ),
    productMap: new Map(
      products.map((product) => [
        product.id,
        {
          avgCost: product.avgCost,
          costPrice: product.costPrice,
          inventoryTracking: product.inventoryTracking,
          isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
        },
      ]),
    ),
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

async function resolveSalePaymentMethod(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  accountId: string | undefined,
): Promise<PaymentMethod | null> {
  if (!accountId) return null;

  const account = await tx.cashBankAccount.findUnique({
    where: { id: accountId },
    select: { type: true },
  });
  if (!account) {
    throw new Error("ไม่พบบัญชีรับเงิน");
  }

  return account.type === "CASH" ? PaymentMethod.CASH : PaymentMethod.TRANSFER;
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

async function assertLotBalanceAvailable(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  productId: string,
  lots: { lotNo: string; qtyInBase: number }[],
): Promise<void> {
  const lotNos = [...new Set(lots.map((lot) => lot.lotNo))];
  if (lotNos.length === 0) return;

  const balances = await tx.lotBalance.findMany({
    where: {
      productId,
      lotNo: { in: lotNos },
    },
    select: {
      lotNo: true,
      qtyOnHand: true,
    },
  });

  const balanceMap = new Map(
    balances.map((balance) => [balance.lotNo, Number(balance.qtyOnHand)]),
  );

  for (const lot of lots) {
    const qtyOnHand = balanceMap.get(lot.lotNo) ?? 0;
    if (qtyOnHand + 0.0001 < lot.qtyInBase) {
      throw new Error(`Lot ${lot.lotNo} คงเหลือไม่พอ`);
    }
  }
}

function buildWarrantyLotSequence(lots: LotSubRow[]): string[] {
  const sequence: string[] = [];
  for (const lot of lots) {
    const lotNo = lot.lotNo.trim();
    const qty = Math.max(0, Math.ceil(lot.qty));
    for (let index = 0; index < qty; index += 1) {
      sequence.push(lotNo);
    }
  }
  return sequence;
}

async function createWarrantySnapshots(
  tx: SaleTxClient,
  input: {
    saleId: string;
    saleItemId: string;
    productId: string;
    warrantyDays: number;
    docDate: Date;
    itemQty: number;
    lotItems: LotSubRow[];
  }
): Promise<void> {
  if (input.warrantyDays <= 0) return;

  const startDate = startOfThailandDay(input.docDate);
  const endDate = addThailandDays(startDate, input.warrantyDays);

  const unitCount = Math.min(Math.ceil(input.itemQty), 999);
  const lotSequence = buildWarrantyLotSequence(input.lotItems);
  await tx.warranty.createMany({
    data: Array.from({ length: unitCount }, (_, index) => ({
      saleId: input.saleId,
      saleItemId: input.saleItemId,
      productId: input.productId,
      warrantyDays: input.warrantyDays,
      startDate,
      endDate,
      unitSeq: index + 1,
      lotNo: lotSequence[index] ?? null,
    })),
  });
}

export async function createSale(
  formData: FormData
): Promise<{ success?: boolean; saleNo?: string; error?: string }> {
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
    cashBankAccountId,
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
  if (paymentType === SalePaymentType.CASH_SALE && !cashBankAccountId) {
    return { error: "กรุณาเลือกบัญชีรับเงิน" };
  }

  const resolvedCashBankAccountId =
    paymentType === SalePaymentType.CASH_SALE ? cashBankAccountId : undefined;
  const docDate = parseDateOnlyToDate(saleDate);
  const salePrefix = paymentType === "CREDIT_SALE" ? "SAC" : "SA";
  const saleNo  = await generateSaleNo(salePrefix, docDate);
  let createdSaleId = "";

  try {
    const requestContext = await getRequestContext();
    await dbTx(async (tx) => {
      const resolvedPaymentMethod = await resolveSalePaymentMethod(
        tx,
        resolvedCashBankAccountId,
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
      for (const item of validItems) {
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
            productId:     item.productId,
            quantity:      Math.round(qtyInBase),
            salePrice:     item.salePrice,
            costPrice:     costPerBase,
            totalAmount:   itemTotal,
            subtotalAmount: itemSubtotal,
            warrantyDays:  item.warrantyDays,
            supplierId:    item.supplierId || null,
            supplierName:  item.supplierName || null,
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
        }) : null;

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

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.SALE,
        sale.id,
        paymentType === SalePaymentType.CASH_SALE && resolvedCashBankAccountId
          ? [{
              accountId: resolvedCashBankAccountId,
              txnDate: docDate,
              direction: CashBankDirection.IN,
              amount: netAmount,
              referenceNo: saleNo,
              note: note ?? null,
            }]
          : [],
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
    });

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

    revalidatePath("/admin");
    revalidatePath("/admin/sales");
    revalidatePath("/admin/products");
    return { success: true, saleNo };
  } catch (err) {
    console.error("[createSale]", err);
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
      items:       { select: { id: true, productId: true } },
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
    });

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

    revalidatePath("/admin");
    revalidatePath("/admin/sales");
    return { success: true };
  } catch (err) {
    console.error("[cancelSale]", err);
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
      items:       { select: { id: true, productId: true } },
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

  const { saleDate, customerId, saleType, paymentType, fulfillmentType, customerName, customerPhone, shippingAddress, shippingFee, destLatitude, destLongitude, saveAsCustomerDefault, discount, cashBankAccountId, note, vatType, vatRate, shippingMethod, creditTerm, items: validItems } = parsed.data;

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
  if (paymentType === SalePaymentType.CASH_SALE && !cashBankAccountId) {
    return { error: "กรุณาเลือกบัญชีรับเงิน" };
  }
  const resolvedCashBankAccountId =
    paymentType === SalePaymentType.CASH_SALE ? cashBankAccountId : undefined;
  const docDate = parseDateOnlyToDate(saleDate);

  const oldProductIds = [...new Set(existing.items.map((i) => i.productId))];

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getSaleAuditSnapshot(id);
    await dbTx(async (tx) => {
      const resolvedPaymentMethod = await resolveSalePaymentMethod(
        tx,
        resolvedCashBankAccountId,
      );
      const fallbackSignerName = existing.signerName ?? existing.user?.name ?? null;
      const fallbackSignerSignatureUrl =
        existing.signerSignatureUrl ?? existing.user?.signatureUrl ?? null;
      const fallbackSignedAt = existing.signedAt ?? (fallbackSignerName ? docDate : null);

      // 1. Reverse old stock + warranties (warranty ต้องลบก่อน saleItem เพราะมี FK)
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
      const { productMap, unitMap } = await preloadSaleDependencies(tx, validItems);

      // 3. Re-create items + stock cards + warranties
      for (const item of validItems) {
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
          data: { saleId: id, productId: item.productId, quantity: Math.round(qtyInBase), salePrice: item.salePrice, costPrice: costPerBase, totalAmount: itemTotal, subtotalAmount: itemSubtotal, warrantyDays: item.warrantyDays, supplierId: item.supplierId || null, supplierName: item.supplierName || null },
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

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.SALE,
        id,
        paymentType === SalePaymentType.CASH_SALE && resolvedCashBankAccountId
          ? [{
              accountId: resolvedCashBankAccountId,
              txnDate: docDate,
              direction: CashBankDirection.IN,
              amount: netAmount,
              referenceNo: existing.saleNo,
              note: note ?? null,
            }]
          : [],
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
    });

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

    revalidatePath("/admin");
    revalidatePath("/admin/sales");
    revalidatePath(`/admin/sales/${id}`);
    revalidatePath("/admin/products");
    return { success: true };
  } catch (err) {
    console.error("[updateSale]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// updateShippingStatus

const DELIVERY_PROOF_BUCKET = "products";
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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) {
    return { error: "ไม่พบการตั้งค่า Supabase Storage" };
  }

  const ext = DELIVERY_PROOF_EXTENSIONS[contentType];
  const safeSaleId = saleId.replace(/[^a-zA-Z0-9_-]/g, "");
  const filePath = `delivery-proofs/${safeSaleId}/${Date.now()}-${kind}-${crypto.randomUUID()}.${ext}`;
  const buffer = new Uint8Array(await file.arrayBuffer());
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const { error: uploadError } = await supabase.storage
    .from(DELIVERY_PROOF_BUCKET)
    .upload(filePath, buffer, { contentType, upsert: false });

  if (uploadError) {
    return { error: "อัปโหลดรูปหลักฐานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(DELIVERY_PROOF_BUCKET).getPublicUrl(filePath);

  return { url: publicUrl };
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
    const openQueueWhere = {
      fulfillmentType: FulfillmentType.DELIVERY,
      status: "ACTIVE" as const,
      shippingStatus: { in: [ShippingStatus.PENDING, ShippingStatus.OUT_FOR_DELIVERY] },
    };
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
  shippingStatus: z.nativeEnum(ShippingStatus),
  trackingNo:     z.string().max(100).optional(),
  shippingMethod: z.nativeEnum(ShippingMethod).optional(),
});

export async function updateShippingStatus(
  saleId: string,
  data: { shippingStatus: string; trackingNo?: string; shippingMethod?: string }
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

    const shouldStampDeliveryStaff =
      parsed.data.shippingStatus === ShippingStatus.OUT_FOR_DELIVERY ||
      (parsed.data.shippingStatus === ShippingStatus.DELIVERED && !sale.deliveryStaffId);

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
