"use server";

import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
import { generateCNNo } from "@/lib/doc-number";
import { CNRefundMethod, CNSettlementType, CreditNoteType, VatType } from "@/lib/generated/prisma";
import { calcVat, calcItemSubtotal } from "@/lib/vat";
import { recalculateCNAmountRemain } from "@/lib/amount-remain";
import { reverseCreditNoteLotBalance, validateLotRows, writeCreditNoteLots, writeStockMovementLots, type LotSubRow } from "@/lib/lot-control";
import { searchProductIds, sortProductsByIds } from "@/lib/product-search";
import { CashBankDirection, CashBankSourceType } from "@/lib/generated/prisma";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";

const creditNoteProductOptionSelect = {
  id: true,
  code: true,
  name: true,
  description: true,
  salePrice: true,
  saleUnitName: true,
  isLotControl: true,
  category: { select: { name: true } },
  brand: { select: { name: true } },
  aliases: { select: { alias: true } },
  units: {
    select: { name: true, scale: true, isBase: true },
    orderBy: { isBase: "desc" },
  },
} as const;

type CreditNoteProductOption = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  salePrice: number;
  saleUnitName: string;
  isLotControl: boolean;
  categoryName: string;
  brandName: string | null;
  aliases: string[];
  units: { name: string; scale: number; isBase: boolean }[];
};

function serializeCreditNoteProductOption(product: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  salePrice: unknown;
  saleUnitName: string | null;
  isLotControl: boolean;
  category: { name: string };
  brand: { name: string } | null;
  aliases: { alias: string }[];
  units: { name: string; scale: unknown; isBase: boolean }[];
}): CreditNoteProductOption {
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    description: product.description,
    salePrice: Number(product.salePrice),
    saleUnitName: product.saleUnitName ?? "",
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

async function requireCreditNoteProductPermission() {
  const createSession = await requirePermission("credit_notes.create").catch(() => null);
  if (createSession?.user?.id) return createSession;
  return requirePermission("credit_notes.update").catch(() => null);
}

export async function searchCreditNoteProducts(query: string) {
  const session = await requireCreditNoteProductPermission();
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
    select: creditNoteProductOptionSelect,
  });

  return sortProductsByIds(products, searchResult.ids).map(serializeCreditNoteProductOption);
}

export async function searchCreditNoteCustomers(query: string) {
  const session = await requireCreditNoteProductPermission();
  if (!session?.user?.id) return [];

  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 2) return [];

  const customers = await db.customer.findMany({
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

  return customers.map((customer) => ({
    id: customer.id,
    label: customer.name,
    sublabel: [customer.code, customer.phone].filter(Boolean).join(" | ") || undefined,
  }));
}

const lotSubRowSchema = z.object({
  lotNo:       z.string().min(1).max(100),
  qty:         z.coerce.number().positive(),
  unitCost:    z.coerce.number().min(0),
  mfgDate:     z.string().default(""),
  expDate:     z.string().default(""),
  isReturnLot: z.coerce.boolean().default(false),
});

const cnItemSchema = z.object({
  productId: z.string().min(1).max(50),
  unitName:  z.string().min(1).max(20),
  qty:       z.coerce.number().positive("จำนวนต้องมากกว่า 0"),
  salePrice: z.coerce.number().min(0, "ราคาต้องไม่ติดลบ"),
  lotItems:  z.array(lotSubRowSchema).default([]),
});

const cnSchema = z.object({
  cnDate:         z.string().min(1, "กรุณาระบุวันที่"),
  customerId:     z.string().min(1, "กรุณาเลือกลูกค้า").max(50),
  customerName:   z.string().max(100).optional(),
  saleId:         z.string().max(50).optional(),
  type:           z.nativeEnum(CreditNoteType),
  settlementType: z.nativeEnum(CNSettlementType).default(CNSettlementType.CASH_REFUND),
  refundMethod:   z.nativeEnum(CNRefundMethod).optional(),
  cashBankAccountId: z.string().optional(),
  note:           z.string().max(500).optional(),
  vatType:        z.nativeEnum(VatType).default(VatType.NO_VAT),
  vatRate:        z.coerce.number().min(0).max(100).default(0),
  items:          z.array(cnItemSchema).min(1, "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ").max(100),
});

async function resolveCreditNoteRefundMethod(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  accountId: string | undefined,
): Promise<CNRefundMethod | null> {
  if (!accountId) return null;

  const account = await tx.cashBankAccount.findUnique({
    where: { id: accountId },
    select: { type: true },
  });
  if (!account) {
    throw new Error("ไม่พบบัญชีจ่ายเงิน");
  }

  return account.type === "CASH" ? CNRefundMethod.CASH : CNRefundMethod.TRANSFER;
}

async function preloadCreditNoteLineMaps(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  items: z.infer<typeof cnItemSchema>[],
): Promise<{
  unitScaleMap: Map<string, number>;
  productMap: Map<string, { isLotControl: boolean; avgCost: number }>;
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
      select: { id: true, isLotControl: true, avgCost: true },
    }),
  ]);

  return {
    unitScaleMap: new Map(
      units.map((unit) => [`${unit.productId}::${unit.name}`, Number(unit.scale)]),
    ),
    productMap: new Map(
      products.map((product) => [
        product.id,
        { isLotControl: product.isLotControl, avgCost: Number(product.avgCost) },
      ]),
    ),
  };
}

async function validateCreditNoteSourceSale(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  saleId: string | undefined,
  customerId: string,
): Promise<void> {
  if (!saleId) return;

  const sale = await tx.sale.findUnique({
    where: { id: saleId },
    select: {
      id: true,
      status: true,
      customerId: true,
      saleNo: true,
    },
  });

  if (!sale || sale.status !== "ACTIVE") {
    throw new Error("ไม่พบใบขายอ้างอิง หรือเอกสารถูกยกเลิกแล้ว");
  }

  if (sale.customerId !== customerId) {
    throw new Error(`ใบขาย ${sale.saleNo} ไม่ได้เป็นของลูกค้ารายที่เลือก`);
  }
}

export async function createCreditNote(
  formData: FormData
): Promise<{ success?: boolean; cnNo?: string; error?: string }> {
  const session = await requirePermission("credit_notes.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  let items: z.infer<typeof cnItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch {
    return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" };
  }

  const parsed = cnSchema.safeParse({
    cnDate:         formData.get("cnDate"),
    customerId:     formData.get("customerId") || undefined,
    customerName:   formData.get("customerName") || undefined,
    saleId:         formData.get("saleId") || undefined,
    type:           formData.get("type"),
    settlementType: formData.get("settlementType") || CNSettlementType.CASH_REFUND,
    refundMethod:   (formData.get("refundMethod") as CNRefundMethod) || undefined,
    cashBankAccountId: formData.get("cashBankAccountId") || undefined,
    note:           formData.get("note") || undefined,
    vatType:        (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:        formData.get("vatRate") || 0,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { cnDate, customerId, customerName, saleId, type, settlementType, cashBankAccountId, note, vatType, vatRate, items: validItems } = parsed.data;

  const totalAmount = validItems.reduce((sum, item) => sum + item.qty * item.salePrice, 0);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(totalAmount, vatType, vatRate);
  if (settlementType === CNSettlementType.CASH_REFUND && !cashBankAccountId) {
    return { error: "กรุณาเลือกบัญชีจ่ายเงิน" };
  }

  const resolvedCashBankAccountId =
    settlementType === CNSettlementType.CASH_REFUND ? cashBankAccountId : undefined;
  const docDate = new Date(cnDate);
  const cnNo    = await generateCNNo(docDate);

  try {
    await dbTx(async (tx) => {
      await validateCreditNoteSourceSale(tx, saleId, customerId);

      const resolvedRefundMethod = await resolveCreditNoteRefundMethod(
        tx,
        resolvedCashBankAccountId,
      );
      const { unitScaleMap, productMap } = await preloadCreditNoteLineMaps(tx, validItems);

      // Create CreditNote header
      const cn = await tx.creditNote.create({
        data: {
          cnNo,
          saleId:         saleId || null,
          customerId:     customerId || null,
          customerName:   customerName ?? null,
          userId:         session.user!.id!,
          type,
          settlementType,
          refundMethod:   resolvedRefundMethod,
          cashBankAccountId: resolvedCashBankAccountId || null,
          totalAmount:    netAmount,
          vatType,
          vatRate,
          subtotalAmount,
          vatAmount,
          note:           note ?? null,
          cnDate:         docDate,
        },
      });

      // Process each line item
      for (const item of validItems) {
        // Get unit scale
        const unit = await tx.productUnit.findUnique({
          where: { productId_name: { productId: item.productId, name: item.unitName } },
        });
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale     = Number(unit.scale);
        const qtyInBase = item.qty * scale;
        const itemTotal = item.qty * item.salePrice;
        const itemSubtotal = calcItemSubtotal(itemTotal, vatType, vatRate);
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { isLotControl: true, avgCost: true },
        });
        if (!product) throw new Error("Missing product");
        if (type === CreditNoteType.RETURN && product.isLotControl) {
          const lotErr = validateLotRows(item.lotItems as LotSubRow[], item.qty, false);
          if (lotErr) throw new Error(lotErr);
        }

        // Create CreditNoteItem (real DB field names: creditNoteId, qty, unitPrice, amount)
        const cnItem = await tx.creditNoteItem.create({
          data: {
            creditNoteId:  cn.id,
            productId:     item.productId,
            qty:           Math.round(qtyInBase),
            unitPrice:     item.salePrice,
            amount:        itemTotal,
            subtotalAmount: itemSubtotal,
          },
        });

        // Write StockCard only for RETURN type
        if (type === CreditNoteType.RETURN) {
          const returnAvgCost = Number(product.avgCost);
          const stockCardId = await writeStockCard(tx, {
            productId:   item.productId,
            docNo:       cnNo,
            docDate,
            source:      "RETURN_IN",
            qtyIn:       qtyInBase,
            qtyOut:      0,
            priceIn:     returnAvgCost,
            detail:      `รับคืน ${item.qty} ${item.unitName}`,
            referenceId: cnItem.id,
          });

          if (product.isLotControl && item.lotItems.length > 0) {
            const lotsInBase = item.lotItems.map((lot) => ({
              lotNo:        lot.lotNo.trim(),
              qtyInBase:    lot.qty * scale,
              unitCostBase: lot.unitCost / scale,
              mfgDate:      lot.mfgDate ? new Date(lot.mfgDate) : null,
              expDate:      lot.expDate ? new Date(lot.expDate) : null,
              isReturnLot:  lot.isReturnLot,
            }));

            await writeCreditNoteLots(tx, cnItem.id, item.productId, lotsInBase);

            await writeStockMovementLots(
              tx,
              stockCardId,
              lotsInBase.map(({ isReturnLot, ...lot }) => lot),
              "in"
            );
          }
        }
      }

      // Initialize amountRemain = totalAmount (no receipts applied yet)
      if (settlementType === CNSettlementType.CREDIT_DEBT) {
        await recalculateCNAmountRemain(tx, cn.id);
      }

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.CN_SALE,
        cn.id,
        settlementType === CNSettlementType.CASH_REFUND && resolvedCashBankAccountId
          ? [{
              accountId: resolvedCashBankAccountId,
              txnDate: docDate,
              direction: CashBankDirection.OUT,
              amount: netAmount,
              referenceNo: cnNo,
              note: note ?? null,
            }]
          : [],
      );
    });

    revalidatePath("/admin/credit-notes");
    revalidatePath("/admin/products");
    return { success: true, cnNo };
  } catch (err) {
    console.error("[createCreditNote]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const cancelCNSchema = z.object({
  cnId:       z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

export async function cancelCreditNote(
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("credit_notes.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = cancelCNSchema.safeParse({
    cnId:       formData.get("cnId"),
    cancelNote: formData.get("cancelNote") || undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { cnId, cancelNote } = parsed.data;

  const cn = await db.creditNote.findUnique({
    where: { id: cnId },
    include: { items: { select: { id: true, productId: true } } },
  });
  if (!cn)                        return { error: "ไม่พบเอกสาร" };
  if (cn.status === "CANCELLED")  return { error: "เอกสารถูกยกเลิกไปแล้ว" };

  // ตรวจสอบ receipt ที่อ้างถึง CN นี้ (เฉพาะ CREDIT_DEBT)
  if (cn.settlementType === "CREDIT_DEBT") {
    const activeReceipt = await db.receiptItem.findFirst({
      where: { cnId, receipt: { status: "ACTIVE" } },
      select: { receipt: { select: { receiptNo: true } } },
    });
    if (activeReceipt) {
      return {
        error: `ไม่สามารถยกเลิกได้ — มีใบเสร็จรับเงิน ${activeReceipt.receipt.receiptNo} อ้างอิงอยู่ กรุณายกเลิกใบเสร็จก่อน`,
      };
    }
  }

  const affectedProductIds = [
    ...new Set(cn.items.map((i) => i.productId).filter((id): id is string => id !== null)),
  ];

  try {
    await dbTx(async (tx) => {
      await clearCashBankSourceMovements(tx, CashBankSourceType.CN_SALE, cnId);

      // ถ้าเป็น RETURN ให้ reverse Lot + ลบ StockCard และ recalculate
      if (cn.type === "RETURN") {
        // Reverse Lot balances (ลบ stock ที่เคยรับคืนจากลูกค้า)
        for (const item of cn.items) {
          if (item.productId) {
            await reverseCreditNoteLotBalance(tx, item.id, item.productId);
          }
        }
        if (affectedProductIds.length > 0) {
          await tx.stockCard.deleteMany({ where: { docNo: cn.cnNo } });
          for (const productId of affectedProductIds) {
            await recalculateStockCard(tx, productId);
          }
        }
      }

      await tx.creditNote.update({
        where: { id: cnId },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelNote, amountRemain: 0 },
      });
    });
    revalidatePath("/admin/credit-notes");
    return { success: true };
  } catch (err) {
    console.error("[cancelCreditNote]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// ─────────────────────────────────────────
// updateCreditNote
// ─────────────────────────────────────────

export async function updateCreditNote(
  id: string,
  formData: FormData
): Promise<{ success?: boolean; error?: string }> {
  const session = await requirePermission("credit_notes.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสเอกสารไม่ถูกต้อง" };
  }

  const existing = await db.creditNote.findUnique({
    where: { id },
    include: { items: { select: { id: true, productId: true } } },
  });
  if (!existing)                       return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };

  // ถ้ามี Receipt อ้างถึง CN นี้อยู่ → ไม่อนุญาตให้แก้ไข
  if (existing.settlementType === "CREDIT_DEBT") {
    const activeReceipt = await db.receiptItem.findFirst({
      where: { cnId: id, receipt: { status: "ACTIVE" } },
      select: { receipt: { select: { receiptNo: true } } },
    });
    if (activeReceipt) {
      return {
        error: `ไม่สามารถแก้ไขได้ — มีใบเสร็จรับเงิน ${activeReceipt.receipt.receiptNo} อ้างอิงอยู่ กรุณายกเลิกใบเสร็จก่อน`,
      };
    }
  }

  let items: z.infer<typeof cnItemSchema>[] = [];
  try {
    const raw = formData.get("items");
    if (typeof raw === "string") items = JSON.parse(raw);
  } catch { return { error: "รูปแบบข้อมูลรายการไม่ถูกต้อง" }; }

  const parsed = cnSchema.safeParse({
    cnDate:         formData.get("cnDate"),
    customerId:     formData.get("customerId") || undefined,
    customerName:   formData.get("customerName") || undefined,
    saleId:         formData.get("saleId") || undefined,
    type:           formData.get("type"),
    settlementType: formData.get("settlementType") || CNSettlementType.CASH_REFUND,
    refundMethod:   (formData.get("refundMethod") as CNRefundMethod) || undefined,
    cashBankAccountId: formData.get("cashBankAccountId") || undefined,
    note:           formData.get("note") || undefined,
    vatType:        (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:        formData.get("vatRate") || 0,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { cnDate, customerId, customerName, saleId, type, settlementType, cashBankAccountId, note, vatType, vatRate, items: validItems } = parsed.data;

  const totalAmount = validItems.reduce((sum, item) => sum + item.qty * item.salePrice, 0);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(totalAmount, vatType, vatRate);
  if (settlementType === CNSettlementType.CASH_REFUND && !cashBankAccountId) {
    return { error: "กรุณาเลือกบัญชีจ่ายเงิน" };
  }

  const resolvedCashBankAccountId =
    settlementType === CNSettlementType.CASH_REFUND ? cashBankAccountId : undefined;
  const docDate = new Date(cnDate);
  const oldProductIds = [
    ...new Set(existing.items.map((i) => i.productId).filter((pid): pid is string => pid !== null)),
  ];

  try {
    await dbTx(async (tx) => {
      await validateCreditNoteSourceSale(tx, saleId, customerId);

      const resolvedRefundMethod = await resolveCreditNoteRefundMethod(
        tx,
        resolvedCashBankAccountId,
      );

      // 1. Reverse old stock effects (only if old type was RETURN)
      if (existing.type === "RETURN" && oldProductIds.length > 0) {
        for (const item of existing.items) {
          if (item.productId) {
            await reverseCreditNoteLotBalance(tx, item.id, item.productId);
          }
        }
        await tx.stockCard.deleteMany({ where: { docNo: existing.cnNo } });
        for (const productId of oldProductIds) {
          await recalculateStockCard(tx, productId);
        }
      }

      // 2. Delete old line items
      await tx.creditNoteItem.deleteMany({ where: { creditNoteId: id } });

      // 3. Update header
      await tx.creditNote.update({
        where: { id },
        data: {
          cnDate:         docDate,
          saleId:         saleId || null,
          customerId:     customerId || null,
          customerName:   customerName ?? null,
          type,
          settlementType,
          refundMethod:   resolvedRefundMethod,
          cashBankAccountId: resolvedCashBankAccountId || null,
          totalAmount:    netAmount,
          vatType,
          vatRate,
          subtotalAmount,
          vatAmount,
          note:           note ?? null,
        },
      });

      // 4. Re-create items + stock cards
      for (const item of validItems) {
        const unit = await tx.productUnit.findUnique({
          where: { productId_name: { productId: item.productId, name: item.unitName } },
        });
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale     = Number(unit.scale);
        const qtyInBase = item.qty * scale;
        const itemTotal = item.qty * item.salePrice;
        const itemSubtotal = calcItemSubtotal(itemTotal, vatType, vatRate);
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { isLotControl: true, avgCost: true },
        });
        if (!product) throw new Error("Missing product");
        if (type === CreditNoteType.RETURN && product.isLotControl) {
          const lotErr = validateLotRows(item.lotItems as LotSubRow[], item.qty, false);
          if (lotErr) throw new Error(lotErr);
        }

        const cnItem = await tx.creditNoteItem.create({
          data: {
            creditNoteId:   id,
            productId:      item.productId,
            qty:            Math.round(qtyInBase),
            unitPrice:      item.salePrice,
            amount:         itemTotal,
            subtotalAmount: itemSubtotal,
          },
        });

        if (type === CreditNoteType.RETURN) {
          const returnAvgCost = Number(product.avgCost);
          const stockCardId = await writeStockCard(tx, {
            productId:   item.productId,
            docNo:       existing.cnNo,
            docDate,
            source:      "RETURN_IN",
            qtyIn:       qtyInBase,
            qtyOut:      0,
            priceIn:     returnAvgCost,
            detail:      `รับคืน ${item.qty} ${item.unitName}`,
            referenceId: cnItem.id,
          });

          if (product.isLotControl && item.lotItems.length > 0) {
            const lotsInBase = item.lotItems.map((lot) => ({
              lotNo:        lot.lotNo.trim(),
              qtyInBase:    lot.qty * scale,
              unitCostBase: lot.unitCost / scale,
              mfgDate:      lot.mfgDate ? new Date(lot.mfgDate) : null,
              expDate:      lot.expDate ? new Date(lot.expDate) : null,
              isReturnLot:  lot.isReturnLot,
            }));

            await writeCreditNoteLots(tx, cnItem.id, item.productId, lotsInBase);

            await writeStockMovementLots(
              tx,
              stockCardId,
              lotsInBase.map(({ isReturnLot, ...lot }) => lot),
              "in"
            );
          }
        }
      }

      // 5. Recalculate CN amountRemain (totalAmount may have changed)
      await recalculateCNAmountRemain(tx, id);

      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.CN_SALE,
        id,
        settlementType === CNSettlementType.CASH_REFUND && resolvedCashBankAccountId
          ? [{
              accountId: resolvedCashBankAccountId,
              txnDate: docDate,
              direction: CashBankDirection.OUT,
              amount: netAmount,
              referenceNo: existing.cnNo,
              note: note ?? null,
            }]
          : [],
      );
    });

    revalidatePath("/admin/credit-notes");
    revalidatePath(`/admin/credit-notes/${id}`);
    revalidatePath("/admin/products");
    return { success: true };
  } catch (err) {
    console.error("[updateCreditNote]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// ─────────────────────────────────────────
// getSalesForCustomer — ดึงใบขายของลูกค้า
// ─────────────────────────────────────────
export async function getSalesForCustomer(
  customerId: string
): Promise<{ id: string; saleNo: string; saleDate: Date; customerName: string | null }[]> {
  const session = await requireCreditNoteProductPermission();
  if (!session?.user?.id || !customerId) return [];
  return db.sale.findMany({
    where: { customerId, status: "ACTIVE" },
    orderBy: { saleDate: "desc" },
    take: 200,
    select: { id: true, saleNo: true, saleDate: true, customerName: true },
  });
}

// ─────────────────────────────────────────
// getSaleDetail — ดึง items จากใบขาย
// ─────────────────────────────────────────
export type SaleDetailResult = {
  customerName: string | null;
  vatType: string;
  vatRate: number;
  items: { productId: string; unitName: string; qty: number; salePrice: number }[];
  products: CreditNoteProductOption[];
} | null;

export async function getSaleDetail(saleId: string): Promise<SaleDetailResult> {
  const session = await requireCreditNoteProductPermission();
  if (!session?.user?.id || !saleId) return null;
  const sale = await db.sale.findUnique({
    where: { id: saleId },
    select: {
      customerName: true,
      vatType: true,
      vatRate: true,
      items: {
        select: {
          productId: true,
          quantity:  true,
          salePrice: true,
          product: {
            select: {
              id: true,
              code: true,
              name: true,
              description: true,
              salePrice: true,
              saleUnitName: true,
              isLotControl: true,
              category: { select: { name: true } },
              brand: { select: { name: true } },
              aliases: { select: { alias: true } },
              units: { select: { name: true, scale: true, isBase: true } },
            },
          },
        },
      },
    },
  });
  if (!sale) return null;

  const productMap = new Map<string, CreditNoteProductOption>();
  const items = sale.items.map((item) => {
    const unitName = item.product.saleUnitName ?? "";
    const unit     = item.product.units.find((u) => u.name === unitName);
    const scale    = unit?.scale ?? 1;
    productMap.set(item.productId, serializeCreditNoteProductOption(item.product));
    return {
      productId: item.productId,
      unitName,
      qty:       Number(item.quantity) / scale,
      salePrice: Number(item.salePrice),
    };
  });

  return {
    customerName: sale.customerName,
    vatType:      sale.vatType,
    vatRate:      Number(sale.vatRate),
    items,
    products: [...productMap.values()],
  };
}
