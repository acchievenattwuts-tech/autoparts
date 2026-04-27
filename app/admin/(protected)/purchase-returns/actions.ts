"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { generatePurchaseReturnNo } from "@/lib/doc-number";
import {
  AuditAction,
  CashBankDirection,
  CashBankSourceType,
  PurchaseReturnRefundMethod,
  PurchaseReturnSettlementType,
  PurchaseReturnType,
  VatType,
} from "@/lib/generated/prisma";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
import { calcVat, calcItemSubtotal } from "@/lib/vat";
import {
  getLotAvailability,
  reversePurchaseReturnLotBalance,
  validateLotRows,
  writePurchaseReturnLots,
  writeStockMovementLots,
  type LotSubRow,
} from "@/lib/lot-control";
import { formatDateOnlyForInput } from "@/lib/th-date";
import type { LotAvailableJSON } from "@/lib/lot-control-client";
import { searchProductIds, sortProductsByIds } from "@/lib/product-search";
import { recalculatePurchaseReturnAmountRemain } from "@/lib/amount-remain";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";

const purchaseReturnProductOptionSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  avgCost: true,
  isLotControl: true,
  category: { select: { name: true } },
  brand: { select: { name: true } },
  aliases: { select: { alias: true } },
  units: {
    select: { name: true, scale: true, isBase: true },
    orderBy: { isBase: "desc" },
  },
} as const;

type PurchaseReturnProductOption = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  avgCost: number;
  isLotControl: boolean;
  categoryName: string;
  brandName: string | null;
  aliases: string[];
  units: { name: string; scale: number; isBase: boolean }[];
};

type LineData = {
  productId: string;
  unitName: string;
  qty: number;
  qtyInBase: number;
  costPerBase: number;
  isLotControl: boolean;
  totalAmount: number;
  subtotalAmount: number;
  lotItems: z.infer<typeof lotSubRowSchema>[];
};

async function preloadPurchaseReturnLineMaps(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  items: z.infer<typeof returnItemSchema>[],
): Promise<{
  unitScaleMap: Map<string, number>;
  productMap: Map<string, { avgCost: number; isLotControl: boolean }>;
}> {
  const productIds = [...new Set(items.map((item) => item.productId))];
  const [units, products] = await Promise.all([
    tx.productUnit.findMany({
      where: {
        OR: items.map((item) => ({
          productId: item.productId,
          name: item.unitName,
        })),
      },
      select: { productId: true, name: true, scale: true },
    }),
    tx.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, avgCost: true, isLotControl: true },
    }),
  ]);

  return {
    unitScaleMap: new Map(
      units.map((unit) => [`${unit.productId}::${unit.name}`, Number(unit.scale)]),
    ),
    productMap: new Map(
      products.map((product) => [
        product.id,
        { avgCost: Number(product.avgCost), isLotControl: product.isLotControl },
      ]),
    ),
  };
}

function serializePurchaseReturnProductOption(product: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  avgCost: unknown;
  isLotControl: boolean;
  category: { name: string };
  brand: { name: string } | null;
  aliases: { alias: string }[];
  units: { name: string; scale: unknown; isBase: boolean }[];
}): PurchaseReturnProductOption {
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    description: product.description,
    avgCost: Number(product.avgCost),
    isLotControl: product.isLotControl,
    categoryName: product.category.name,
    brandName: product.brand?.name ?? null,
    aliases: product.aliases.map((alias) => alias.alias),
    units: product.units.map((unit) => ({
      name: unit.name,
      scale: Number(unit.scale),
      isBase: unit.isBase,
    })),
  };
}

async function requirePurchaseReturnProductPermission() {
  const createSession = await requirePermission("purchase_returns.create").catch(() => null);
  if (createSession?.user?.id) return createSession;
  return requirePermission("purchase_returns.update").catch(() => null);
}

export async function searchPurchaseReturnProducts(query: string) {
  const session = await requirePurchaseReturnProductPermission();
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
    select: purchaseReturnProductOptionSelect,
  });

  return sortProductsByIds(products, searchResult.ids).map(serializePurchaseReturnProductOption);
}

export async function searchPurchaseReturnSuppliers(query: string) {
  const session = await requirePurchaseReturnProductPermission();
  if (!session?.user?.id) return [];

  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) return [];

  const suppliers = await db.supplier.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: normalizedQuery, mode: "insensitive" } },
        { code: { contains: normalizedQuery, mode: "insensitive" } },
        { phone: { contains: normalizedQuery, mode: "insensitive" } },
      ],
    },
    orderBy: { name: "asc" },
    take: 20,
    select: { id: true, name: true, code: true, phone: true },
  });

  return suppliers.map((supplier) => ({
    id: supplier.id,
    label: supplier.name,
    sublabel: [supplier.code, supplier.phone].filter(Boolean).join(" | ") || undefined,
  }));
}

const lotSubRowSchema = z.object({
  lotNo: z.string().min(1).max(100),
  qty: z.coerce.number().positive(),
  unitCost: z.coerce.number().min(0),
  mfgDate: z.string().default(""),
  expDate: z.string().default(""),
});

const returnItemSchema = z.object({
  productId: z.string().min(1).max(50),
  unitName: z.string().min(1).max(20),
  qty: z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  lotItems: z.array(lotSubRowSchema).default([]),
});

const returnSchema = z.object({
  returnDate: z.string().min(1, "กรุณาระบุวันที่"),
  purchaseId: z.string().max(50).optional(),
  supplierId: z.string().min(1, "กรุณาเลือกผู้จำหน่าย").max(50),
  type: z.nativeEnum(PurchaseReturnType).default(PurchaseReturnType.RETURN),
  settlementType: z.nativeEnum(PurchaseReturnSettlementType).default(PurchaseReturnSettlementType.CASH_REFUND),
  refundMethod: z.nativeEnum(PurchaseReturnRefundMethod).optional(),
  cashBankAccountId: z.string().optional(),
  note: z.string().max(500).optional(),
  vatType: z.nativeEnum(VatType).default(VatType.NO_VAT),
  vatRate: z.coerce.number().min(0).max(100).default(0),
  items: z.array(returnItemSchema).min(1, "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ").max(100),
});

async function resolvePurchaseReturnRefundMethod(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  accountId: string | undefined,
): Promise<PurchaseReturnRefundMethod | null> {
  if (!accountId) return null;

  const account = await tx.cashBankAccount.findUnique({
    where: { id: accountId },
    select: { type: true },
  });
  if (!account) {
    throw new Error("ไม่พบบัญชีรับเงิน");
  }

  return account.type === "CASH"
    ? PurchaseReturnRefundMethod.CASH
    : PurchaseReturnRefundMethod.TRANSFER;
}

async function getActiveSupplierPaymentRefs(returnId: string): Promise<string[]> {
  const refs = await db.supplierPaymentItem.findMany({
    where: {
      purchaseReturnId: returnId,
      payment: { status: "ACTIVE" },
    },
    select: {
      payment: { select: { paymentNo: true } },
    },
  });

  return [...new Set(refs.map((item) => item.payment.paymentNo))];
}

async function buildLineData(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  validItems: z.infer<typeof returnItemSchema>[],
  vatType: VatType,
  vatRate: number,
): Promise<LineData[]> {
  const { unitScaleMap, productMap } = await preloadPurchaseReturnLineMaps(tx, validItems);
  const lineData: LineData[] = [];

  for (const item of validItems) {
    const scale = unitScaleMap.get(`${item.productId}::${item.unitName}`);
    if (scale === undefined) {
      throw new Error(`????????????? ${item.unitName} ?????????`);
    }

    const qtyInBase = item.qty * scale;
    const product = productMap.get(item.productId);
    if (!product) {
      throw new Error("???????????");
    }

    const costPerBase = product.avgCost;
    const totalAmount = Math.round(qtyInBase) * costPerBase;
    const subtotalAmount = calcItemSubtotal(totalAmount, vatType, vatRate);

    lineData.push({
      productId: item.productId,
      unitName: item.unitName,
      qty: item.qty,
      qtyInBase,
      costPerBase,
      isLotControl: product.isLotControl,
      totalAmount,
      subtotalAmount,
      lotItems: item.lotItems,
    });
  }

  return lineData;
}

async function writePurchaseReturnLines(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  purchaseReturnId: string,
  returnNo: string,
  docDate: Date,
  lineData: LineData[],
  type: PurchaseReturnType,
): Promise<void> {
  const writeStock = type === PurchaseReturnType.RETURN;

  for (const line of lineData) {
    if (writeStock && line.isLotControl) {
      const lotError = validateLotRows(line.lotItems as LotSubRow[], line.qty, false);
      if (lotError) throw new Error(lotError);
    }

    const returnItem = await tx.purchaseReturnItem.create({
      data: {
        purchaseReturnId,
        productId: line.productId,
        qty: Math.round(line.qtyInBase),
        costPrice: line.costPerBase,
        amount: line.totalAmount,
        subtotalAmount: line.subtotalAmount,
        detail: `คืน ${line.qty} ${line.unitName}`,
      },
    });

    if (writeStock) {
      const stockCardId = await writeStockCard(tx, {
        productId: line.productId,
        docNo: returnNo,
        docDate,
        source: "RETURN_OUT",
        qtyIn: 0,
        qtyOut: line.qtyInBase,
        priceIn: 0,
        detail: `คืน ${line.qty} ${line.unitName}`,
        referenceId: returnItem.id,
      });

      if (line.isLotControl && line.lotItems.length > 0) {
        const lineScale = line.qty === 0 ? 1 : line.qtyInBase / line.qty;
        const lotsInBase = line.lotItems.map((lot) => ({
          lotNo: lot.lotNo.trim(),
          qtyInBase: lot.qty * lineScale,
          unitCostBase: line.costPerBase,
          mfgDate: lot.mfgDate ? new Date(lot.mfgDate) : null,
          expDate: lot.expDate ? new Date(lot.expDate) : null,
        }));

        await writePurchaseReturnLots(tx, returnItem.id, line.productId, lotsInBase);

        await writeStockMovementLots(tx, stockCardId, lotsInBase, "out");
      }
    }
  }
}

async function validatePurchaseReturnSourcePurchase(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  purchaseId: string | undefined,
  supplierId: string,
): Promise<void> {
  if (!purchaseId) return;

  const purchase = await tx.purchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      status: true,
      supplierId: true,
      purchaseNo: true,
    },
  });

  if (!purchase || purchase.status !== "ACTIVE") {
    throw new Error("ไม่พบใบซื้ออ้างอิง หรือเอกสารถูกยกเลิกแล้ว");
  }

  if (purchase.supplierId !== supplierId) {
    throw new Error(`ใบซื้อ ${purchase.purchaseNo} ไม่ได้เป็นของผู้จำหน่ายรายที่เลือก`);
  }
}

async function getPurchaseReturnAuditSnapshot(purchaseReturnId: string) {
  const purchaseReturn = await db.purchaseReturn.findUnique({
    where: { id: purchaseReturnId },
    include: {
      purchase: {
        select: {
          purchaseNo: true,
        },
      },
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
          qty: true,
          costPrice: true,
          amount: true,
          subtotalAmount: true,
          detail: true,
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

  if (!purchaseReturn) return null;

  return {
    id: purchaseReturn.id,
    returnNo: purchaseReturn.returnNo,
    returnDate: purchaseReturn.returnDate,
    status: purchaseReturn.status,
    type: purchaseReturn.type,
    settlementType: purchaseReturn.settlementType,
    refundMethod: purchaseReturn.refundMethod,
    purchaseId: purchaseReturn.purchaseId,
    purchaseNo: purchaseReturn.purchase?.purchaseNo ?? null,
    supplierId: purchaseReturn.supplierId,
    supplierRef: purchaseReturn.supplier?.code ?? purchaseReturn.supplier?.name ?? null,
    cashBankAccountId: purchaseReturn.cashBankAccountId,
    totalAmount: purchaseReturn.totalAmount,
    amountRemain: purchaseReturn.amountRemain,
    subtotalAmount: purchaseReturn.subtotalAmount,
    vatAmount: purchaseReturn.vatAmount,
    vatType: purchaseReturn.vatType,
    vatRate: purchaseReturn.vatRate,
    note: purchaseReturn.note,
    cancelNote: purchaseReturn.cancelNote,
    cancelledAt: purchaseReturn.cancelledAt,
    items: purchaseReturn.items.map((item) => ({
      productId: item.productId,
      productCode: item.product?.code ?? null,
      productName: item.product?.name ?? null,
      qty: item.qty,
      costPrice: item.costPrice,
      amount: item.amount,
      subtotalAmount: item.subtotalAmount,
      detail: item.detail,
    })),
  };
}

export async function createPurchaseReturn(
  formData: FormData,
): Promise<{ success?: boolean; returnNo?: string; error?: string }> {
  const session = await requirePermission("purchase_returns.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  let items: z.infer<typeof returnItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch {
    return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" };
  }

  const parsed = returnSchema.safeParse({
    returnDate: formData.get("returnDate"),
    purchaseId: formData.get("purchaseId") || undefined,
    supplierId: formData.get("supplierId") || undefined,
    type: (formData.get("type") as PurchaseReturnType) || PurchaseReturnType.RETURN,
    settlementType: formData.get("settlementType") || PurchaseReturnSettlementType.CASH_REFUND,
    refundMethod: (formData.get("refundMethod") as PurchaseReturnRefundMethod) || undefined,
    cashBankAccountId: formData.get("cashBankAccountId") || undefined,
    note: formData.get("note") || undefined,
    vatType: (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate: formData.get("vatRate") || 0,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const {
    returnDate,
    purchaseId,
    supplierId,
    type,
    settlementType,
    cashBankAccountId,
    note,
    vatType,
    vatRate,
    items: validItems,
  } = parsed.data;

  if (settlementType === PurchaseReturnSettlementType.CASH_REFUND && !cashBankAccountId) {
    return { error: "กรุณาเลือกบัญชีรับเงิน" };
  }

  const docDate = new Date(returnDate);
  const returnNo = await generatePurchaseReturnNo(docDate);
  let createdPurchaseReturnId = "";

  try {
    const requestContext = await getRequestContext();
    await dbTx(async (tx) => {
      await validatePurchaseReturnSourcePurchase(tx, purchaseId, supplierId);

      const lineData = await buildLineData(tx, validItems, vatType, vatRate);
      const rawTotal = lineData.reduce((sum, line) => sum + line.totalAmount, 0);
      const { subtotalAmount, vatAmount, netAmount } = calcVat(rawTotal, vatType, vatRate);
      const resolvedCashBankAccountId =
        settlementType === PurchaseReturnSettlementType.CASH_REFUND ? cashBankAccountId : undefined;
      const refundMethod = await resolvePurchaseReturnRefundMethod(tx, resolvedCashBankAccountId);

      const purchaseReturn = await tx.purchaseReturn.create({
        data: {
          returnNo,
          returnDate: docDate,
          purchaseId: purchaseId || null,
          supplierId,
          userId: session.user.id,
          totalAmount: netAmount,
          note: note?.trim() || null,
          vatType,
          vatRate,
          subtotalAmount,
          vatAmount,
          type,
          settlementType,
          refundMethod,
          cashBankAccountId: resolvedCashBankAccountId || null,
          amountRemain:
            settlementType === PurchaseReturnSettlementType.SUPPLIER_CREDIT ? netAmount : 0,
        },
      });
      createdPurchaseReturnId = purchaseReturn.id;

      await writePurchaseReturnLines(tx, purchaseReturn.id, returnNo, docDate, lineData, type);

      if (settlementType === PurchaseReturnSettlementType.SUPPLIER_CREDIT) {
        await recalculatePurchaseReturnAmountRemain(tx, purchaseReturn.id);
      }

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.CN_PURCHASE,
        purchaseReturn.id,
        settlementType === PurchaseReturnSettlementType.CASH_REFUND && resolvedCashBankAccountId
          ? [
              {
                accountId: resolvedCashBankAccountId,
                txnDate: docDate,
                direction: CashBankDirection.IN,
                amount: netAmount,
                referenceNo: returnNo,
                note: note?.trim() || null,
              },
            ]
          : [],
      );
    });

    const afterSnapshot = createdPurchaseReturnId
      ? await getPurchaseReturnAuditSnapshot(createdPurchaseReturnId)
      : null;
    if (afterSnapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "PurchaseReturn",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.returnNo,
        after: afterSnapshot,
      });
    }

    revalidatePath("/admin/purchase-returns");
    revalidatePath("/admin/products");
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    return { success: true, returnNo };
  } catch (error) {
    console.error("[createPurchaseReturn]", error);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const cancelReturnSchema = z.object({
  returnId: z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelPurchaseReturn(
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("purchase_returns.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelReturnSchema.safeParse({
    returnId: formData.get("returnId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const ret = await db.purchaseReturn.findUnique({
    where: { id: parsed.data.returnId },
    include: {
      items: { select: { id: true, productId: true } },
    },
  });
  if (!ret) return { error: "ไม่พบเอกสาร" };
  if (ret.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  const activeRefs = await getActiveSupplierPaymentRefs(ret.id);
  if (activeRefs.length > 0) {
    return {
      error: `ไม่สามารถยกเลิกได้ เนื่องจากถูกใช้ในเอกสารจ่ายชำระ: ${activeRefs.join(", ")}`,
    };
  }

  const affectedProductIds = [...new Set(ret.items.map((item) => item.productId))];
  const hadStock = ret.type === PurchaseReturnType.RETURN;

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getPurchaseReturnAuditSnapshot(ret.id);
    await dbTx(async (tx) => {
      if (hadStock) {
        for (const item of ret.items) {
          await reversePurchaseReturnLotBalance(tx, item.id, item.productId);
        }
        await tx.stockCard.deleteMany({ where: { docNo: ret.returnNo } });
        for (const productId of affectedProductIds) {
          await recalculateStockCard(tx, productId);
        }
      }

      await clearCashBankSourceMovements(tx, CashBankSourceType.CN_PURCHASE, ret.id);

      await tx.purchaseReturn.update({
        where: { id: ret.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelNote: parsed.data.cancelNote?.trim() || null,
          amountRemain: 0,
        },
      });
    });

    const afterSnapshot = await getPurchaseReturnAuditSnapshot(ret.id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CANCEL,
        entityType: "PurchaseReturn",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.returnNo,
        before: diff.before,
        after: diff.after,
        meta: { cancelNote: parsed.data.cancelNote?.trim() || null },
      });
    }

    revalidatePath("/admin/purchase-returns");
    revalidatePath(`/admin/purchase-returns/${ret.id}`);
    revalidatePath("/admin/products");
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    return { success: true };
  } catch (error) {
    console.error("[cancelPurchaseReturn]", error);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function updatePurchaseReturn(
  id: string,
  formData: FormData,
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("purchase_returns.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสเอกสารไม่ถูกต้อง" };
  }

  const existing = await db.purchaseReturn.findUnique({
    where: { id },
    include: {
      items: { select: { id: true, productId: true } },
    },
  });
  if (!existing) return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED") {
    return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };
  }

  const activeRefs = await getActiveSupplierPaymentRefs(id);
  if (activeRefs.length > 0) {
    return {
      error: `ไม่สามารถแก้ไขได้ เนื่องจากถูกใช้ในเอกสารจ่ายชำระ: ${activeRefs.join(", ")}`,
    };
  }

  let items: z.infer<typeof returnItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch {
    return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" };
  }

  const parsed = returnSchema.safeParse({
    returnDate: formData.get("returnDate"),
    purchaseId: formData.get("purchaseId") || undefined,
    supplierId: formData.get("supplierId") || undefined,
    type: (formData.get("type") as PurchaseReturnType) || PurchaseReturnType.RETURN,
    settlementType: formData.get("settlementType") || PurchaseReturnSettlementType.CASH_REFUND,
    refundMethod: (formData.get("refundMethod") as PurchaseReturnRefundMethod) || undefined,
    cashBankAccountId: formData.get("cashBankAccountId") || undefined,
    note: formData.get("note") || undefined,
    vatType: (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate: formData.get("vatRate") || 0,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const {
    returnDate,
    purchaseId,
    supplierId,
    type,
    settlementType,
    cashBankAccountId,
    note,
    vatType,
    vatRate,
    items: validItems,
  } = parsed.data;

  if (settlementType === PurchaseReturnSettlementType.CASH_REFUND && !cashBankAccountId) {
    return { error: "กรุณาเลือกบัญชีรับเงิน" };
  }

  const docDate = new Date(returnDate);
  const oldProductIds = [...new Set(existing.items.map((item) => item.productId))];
  const oldHadStock = existing.type === PurchaseReturnType.RETURN;

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getPurchaseReturnAuditSnapshot(id);
    await dbTx(async (tx) => {
      await validatePurchaseReturnSourcePurchase(tx, purchaseId, supplierId);

      if (oldHadStock) {
        for (const item of existing.items) {
          await reversePurchaseReturnLotBalance(tx, item.id, item.productId);
        }
        await tx.stockCard.deleteMany({ where: { docNo: existing.returnNo } });
        for (const productId of oldProductIds) {
          await recalculateStockCard(tx, productId);
        }
      }
      await tx.purchaseReturnItem.deleteMany({ where: { purchaseReturnId: id } });

      const lineData = await buildLineData(tx, validItems, vatType, vatRate);
      const rawTotal = lineData.reduce((sum, line) => sum + line.totalAmount, 0);
      const { subtotalAmount, vatAmount, netAmount } = calcVat(rawTotal, vatType, vatRate);
      const resolvedCashBankAccountId =
        settlementType === PurchaseReturnSettlementType.CASH_REFUND ? cashBankAccountId : undefined;
      const refundMethod = await resolvePurchaseReturnRefundMethod(tx, resolvedCashBankAccountId);

      await tx.purchaseReturn.update({
        where: { id },
        data: {
          returnDate: docDate,
          purchaseId: purchaseId || null,
          supplierId,
          totalAmount: netAmount,
          note: note?.trim() || null,
          vatType,
          vatRate,
          subtotalAmount,
          vatAmount,
          type,
          settlementType,
          refundMethod,
          cashBankAccountId: resolvedCashBankAccountId || null,
          amountRemain:
            settlementType === PurchaseReturnSettlementType.SUPPLIER_CREDIT ? netAmount : 0,
        },
      });

      await writePurchaseReturnLines(tx, id, existing.returnNo, docDate, lineData, type);

      await recalculatePurchaseReturnAmountRemain(tx, id);

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.CN_PURCHASE,
        id,
        settlementType === PurchaseReturnSettlementType.CASH_REFUND && resolvedCashBankAccountId
          ? [
              {
                accountId: resolvedCashBankAccountId,
                txnDate: docDate,
                direction: CashBankDirection.IN,
                amount: netAmount,
                referenceNo: existing.returnNo,
                note: note?.trim() || null,
              },
            ]
          : [],
      );
    });

    const afterSnapshot = await getPurchaseReturnAuditSnapshot(id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "PurchaseReturn",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.returnNo,
        before: diff.before,
        after: diff.after,
      });
    }

    revalidatePath("/admin/purchase-returns");
    revalidatePath(`/admin/purchase-returns/${id}`);
    revalidatePath("/admin/products");
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    return { success: true };
  } catch (error) {
    console.error("[updatePurchaseReturn]", error);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function getPurchasesForSupplier(
  supplierId: string,
): Promise<{ id: string; purchaseNo: string; purchaseDate: Date }[]> {
  const session = await requirePurchaseReturnProductPermission();
  if (!session?.user?.id || !supplierId) return [];

  return db.purchase.findMany({
    where: { supplierId },
    orderBy: { purchaseDate: "desc" },
    take: 200,
    select: { id: true, purchaseNo: true, purchaseDate: true },
  });
}

export type PurchaseDetailResult = {
  items: { productId: string; unitName: string; qty: number; lotItems: z.infer<typeof lotSubRowSchema>[] }[];
  products: PurchaseReturnProductOption[];
} | null;

export async function getPurchaseDetail(purchaseId: string): Promise<PurchaseDetailResult> {
  const session = await requirePurchaseReturnProductPermission();
  if (!session?.user?.id || !purchaseId) return null;

  const purchase = await db.purchase.findUnique({
    where: { id: purchaseId },
    select: {
      items: {
        select: {
          productId: true,
          quantity: true,
          product: {
            select: {
              id: true,
              code: true,
              name: true,
              description: true,
              avgCost: true,
              isLotControl: true,
              purchaseUnitName: true,
              category: { select: { name: true } },
              brand: { select: { name: true } },
              aliases: { select: { alias: true } },
              units: { select: { name: true, scale: true, isBase: true } },
            },
          },
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
    },
  });
  if (!purchase) return null;

  const productMap = new Map<string, PurchaseReturnProductOption>();
  const items = purchase.items.map((item) => {
    const unitName = item.product.purchaseUnitName ?? "";
    const unit = item.product.units.find((entry) => entry.name === unitName);
    const scale = unit ? Number(unit.scale) : 1;
    productMap.set(item.productId, serializePurchaseReturnProductOption(item.product));

    return {
      productId: item.productId,
      unitName,
      qty: Number(item.quantity) / scale,
      lotItems: item.product.isLotControl
        ? item.lotItems.map((lot) => ({
            lotNo: lot.lotNo,
            qty: Number(lot.qty) / scale,
            unitCost: Number(lot.unitCost) * scale,
            mfgDate: lot.mfgDate ? formatDateOnlyForInput(lot.mfgDate) : "",
            expDate: lot.expDate ? formatDateOnlyForInput(lot.expDate) : "",
          }))
        : [],
    };
  });

  return {
    items,
    products: [...productMap.values()],
  };
}

export async function fetchProductLots(
  productId: string,
): Promise<LotAvailableJSON[] | { error: string }> {
  const session = await requirePurchaseReturnProductPermission();
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  if (!productId) return { error: "ไม่ระบุสินค้า" };

  try {
    return await getLotAvailability(db, productId);
  } catch (error) {
    console.error("[fetchProductLots purchase-returns]", error);
    return { error: "โหลด Lot ไม่สำเร็จ" };
  }
}
