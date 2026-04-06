"use server";

import { db, dbTx } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeStockCard, recalculateStockCard } from "@/lib/stock-card";
import { generateSaleNo } from "@/lib/doc-number";
import { FulfillmentType, PaymentMethod, Prisma, SalePaymentType, SaleType, ShippingMethod, ShippingStatus, VatType } from "@/lib/generated/prisma";
import { calcVat, calcItemSubtotal } from "@/lib/vat";
import { recalculateSaleAmountRemain } from "@/lib/amount-remain";
import { writeSaleLots, writeStockMovementLots, reverseSaleLotBalance, validateLotRows, type LotSubRow } from "@/lib/lot-control";
import type { LotAvailableJSON } from "@/lib/lot-control-client";
import { searchProductIds, sortProductsByIds } from "@/lib/product-search";
import { CashBankDirection, CashBankSourceType } from "@/lib/generated/prisma";
import { clearCashBankSourceMovements, replaceCashBankSourceMovements } from "@/lib/cash-bank";

const saleProductOptionSelect = {
  id:                  true,
  code:                true,
  name:                true,
  description:         true,
  salePrice:           true,
  saleUnitName:        true,
  warrantyDays:        true,
  preferredSupplierId: true,
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
  const session = await requirePermission("sales.create").catch(() => null);
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
    isLotControl:          product.isLotControl,
    lotIssueMethod:        product.lotIssueMethod as string,
    allowExpiredIssue:     product.allowExpiredIssue,
  }));
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
  shippingAddress: z.string().max(500).optional(),
  shippingFee:     z.coerce.number().min(0).default(0),
  discount:        z.coerce.number().min(0).default(0),
  paymentMethod:   z.nativeEnum(PaymentMethod).optional(),
  cashBankAccountId: z.string().optional(),
  note:            z.string().max(500).optional(),
  vatType:         z.nativeEnum(VatType).default(VatType.NO_VAT),
  vatRate:         z.coerce.number().min(0).max(100).default(0),
  shippingMethod:  z.nativeEnum(ShippingMethod).default(ShippingMethod.NONE),
  items:           z.array(saleItemSchema).min(1, "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ").max(100),
});

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
      throw new Error(`Lot ${lot.lotNo} à¸„à¸‡à¹€à¸«à¸¥à¸·à¸­à¹„à¸¡à¹ˆà¸žà¸­`);
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
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
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

  const startDate = new Date(input.docDate);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + input.warrantyDays);

  const unitCount = Math.min(Math.ceil(input.itemQty), 999);
  const lotSequence = buildWarrantyLotSequence(input.lotItems);

  for (let seq = 1; seq <= unitCount; seq += 1) {
    await tx.warranty.create({
      data: {
        saleId: input.saleId,
        saleItemId: input.saleItemId,
        productId: input.productId,
        warrantyDays: input.warrantyDays,
        startDate,
        endDate,
        unitSeq: seq,
        lotNo: lotSequence[seq - 1] ?? null,
      },
    });
  }
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
    shippingAddress: formData.get("shippingAddress") || undefined,
    shippingFee:     formData.get("shippingFee")     || 0,
    discount:        formData.get("discount")        || 0,
    paymentMethod:   formData.get("paymentMethod")   || undefined,
    cashBankAccountId: formData.get("cashBankAccountId") || undefined,
    note:            formData.get("note")            || undefined,
    vatType:         (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:         formData.get("vatRate")         || 0,
    shippingMethod:  (formData.get("shippingMethod") as ShippingMethod) || ShippingMethod.NONE,
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
    discount,
    paymentMethod,
    note,
    cashBankAccountId,
    vatType,
    vatRate,
    shippingMethod,
    items: validItems,
  } = parsed.data;

  // Calculate totals
  const totalAmount = validItems.reduce((sum, item) => sum + item.qty * item.salePrice, 0);
  const discountedTotal = Math.max(0, totalAmount + shippingFee - discount);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(discountedTotal, vatType, vatRate);
  if (paymentType === SalePaymentType.CASH_SALE && !cashBankAccountId) {
    return { error: "กรุณาเลือกบัญชีรับเงิน" };
  }

  const docDate = new Date(saleDate);
  const salePrefix = paymentType === "CREDIT_SALE" ? "SAC" : "SA";
  const saleNo  = await generateSaleNo(salePrefix, docDate);

  try {
    await dbTx(async (tx) => {
      // 1. Create Sale header
      const sale = await tx.sale.create({
        data: {
          saleNo,
          customerId:      customerId      ?? null,
          saleType,
          paymentType,
          fulfillmentType,
          shippingAddress: shippingAddress ?? null,
          shippingFee,
          customerName:    customerName    ?? null,
          customerPhone:   customerPhone   ?? null,
          userId:          session.user!.id!,
          totalAmount,
          discount,
          netAmount,
          vatType,
          vatRate,
          subtotalAmount,
          vatAmount,
          paymentMethod:   paymentMethod   ?? null,
          cashBankAccountId: cashBankAccountId || null,
          note:            note            ?? null,
          saleDate:        docDate,
          amountRemain:    new Prisma.Decimal(paymentType === "CREDIT_SALE" ? netAmount : 0),
          shippingMethod,
          shippingStatus:  ShippingStatus.PENDING,
        },
      });

      // 2. Process each line item
      for (const item of validItems) {
        // Get unit scale
        const unit = await tx.productUnit.findUnique({
          where: { productId_name: { productId: item.productId, name: item.unitName } },
        });
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale      = Number(unit.scale);
        const qtyInBase  = item.qty * scale;

        // Get current product avgCost for COGS
        const prod = await tx.product.findUnique({
          where: { id: item.productId },
          select: { avgCost: true },
        });
        if (!prod) throw new Error(`ไม่พบสินค้า`);
        const costPerBase = Number(prod.avgCost);

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

        // Auto-create Warranty rows — one per display-unit qty (N warranties for N pieces sold)
        // Write StockCard (outgoing)
        await writeStockCard(tx, {
          productId:   item.productId,
          docNo:       saleNo,
          docDate,
          source:      "SALE",
          qtyIn:       0,
          qtyOut:      qtyInBase,
          priceIn:     0,
          detail:      `ขาย ${item.qty} ${item.unitName}`,
          referenceId: saleItem.id,
        });

        // Lot Control — only if product has isLotControl=true
        if (item.lotItems.length > 0) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { isLotControl: true },
          });
          if (product?.isLotControl) {
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

            const sc = await tx.stockCard.findFirst({
              where: { referenceId: saleItem.id, source: "SALE" },
              select: { id: true },
            });
            if (sc) await writeStockMovementLots(tx, sc.id, lotsInBase, "out");
          }
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
        paymentType === SalePaymentType.CASH_SALE && cashBankAccountId
          ? [{
              accountId: cashBankAccountId,
              txnDate: docDate,
              direction: CashBankDirection.IN,
              amount: netAmount,
              referenceNo: saleNo,
              note: note ?? null,
            }]
          : [],
      );
    });

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
    return { error: `ไม่สามารถยกเลิกได้ มีใบลดหนี้ที่อ้างอิงอยู่: ${nos} — กรุณายกเลิก CN ก่อน` };
  }

  // Reference chain: ตรวจใบเสร็จที่ยัง active
  const activeReceipts = sale.receipts
    .filter((ri) => ri.receipt.status === "ACTIVE")
    .map((ri) => ri.receipt);
  if (activeReceipts.length > 0) {
    const nos = activeReceipts.map((r) => r.receiptNo).join(", ");
    return { error: `ไม่สามารถยกเลิกได้ มีใบเสร็จรับเงินที่อ้างอิงอยู่: ${nos} — กรุณายกเลิกใบเสร็จก่อน` };
  }

  // Reference chain: ตรวจใบเคลมที่ยัง active
  const activeClaims = sale.warranties.flatMap((w) => w.claims);
  if (activeClaims.length > 0) {
    const nos = activeClaims.map((c) => c.claimNo).join(", ");
    return { error: `ไม่สามารถยกเลิกได้ มีใบเคลมที่อ้างอิงอยู่: ${nos} — กรุณายกเลิกใบเคลมก่อน` };
  }

  const affectedProductIds = [...new Set(sale.items.map((i) => i.productId))];

  try {
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
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelNote, amountRemain: new Prisma.Decimal(0) },
      });
    });
    revalidatePath("/admin/sales");
    return { success: true };
  } catch (err) {
    console.error("[cancelSale]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// ─────────────────────────────────────────
// updateSale
// ─────────────────────────────────────────

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
    return { error: `ไม่สามารถแก้ไขได้ มีใบเคลมที่อ้างอิงอยู่: ${nos} — กรุณายกเลิกใบเคลมก่อน` };
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
    shippingAddress: formData.get("shippingAddress") || undefined,
    shippingFee:     formData.get("shippingFee")     || 0,
    discount:        formData.get("discount")        || 0,
    paymentMethod:   formData.get("paymentMethod")   || undefined,
    note:            formData.get("note")            || undefined,
    vatType:         (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate:         formData.get("vatRate")         || 0,
    shippingMethod:  (formData.get("shippingMethod") as ShippingMethod) || ShippingMethod.NONE,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { saleDate, customerId, saleType, paymentType, fulfillmentType, customerName, customerPhone, shippingAddress, shippingFee, discount, paymentMethod, cashBankAccountId, note, vatType, vatRate, shippingMethod, items: validItems } = parsed.data;

  const totalAmount     = validItems.reduce((sum, item) => sum + item.qty * item.salePrice, 0);
  const discountedTotal = Math.max(0, totalAmount + shippingFee - discount);
  const { subtotalAmount, vatAmount, netAmount } = calcVat(discountedTotal, vatType, vatRate);
  if (paymentType === SalePaymentType.CASH_SALE && !cashBankAccountId) {
    return { error: "กรุณาเลือกบัญชีรับเงิน" };
  }
  const docDate = new Date(saleDate);

  const oldProductIds = [...new Set(existing.items.map((i) => i.productId))];

  try {
    await dbTx(async (tx) => {
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
          shippingAddress: shippingAddress ?? null,
          shippingFee,
          discount,
          paymentMethod:   paymentMethod   ?? null,
          cashBankAccountId: cashBankAccountId || null,
          note:            note            ?? null,
          vatType,
          vatRate,
          totalAmount,
          subtotalAmount,
          vatAmount,
          netAmount,
          amountRemain:    new Prisma.Decimal(paymentType === "CREDIT_SALE" ? netAmount : 0),
          shippingMethod,
        },
      });

      // 3. Re-create items + stock cards + warranties
      for (const item of validItems) {
        const unit = await tx.productUnit.findUnique({
          where: { productId_name: { productId: item.productId, name: item.unitName } },
        });
        if (!unit) throw new Error(`ไม่พบหน่วยนับ ${item.unitName} ของสินค้า`);

        const scale     = Number(unit.scale);
        const qtyInBase = item.qty * scale;
        const prod = await tx.product.findUnique({ where: { id: item.productId }, select: { avgCost: true } });
        if (!prod) throw new Error("ไม่พบสินค้า");
        const costPerBase  = Number(prod.avgCost);
        const itemTotal    = item.qty * item.salePrice;
        const itemSubtotal = calcItemSubtotal(itemTotal, vatType, vatRate);

        const saleItem = await tx.saleItem.create({
          data: { saleId: id, productId: item.productId, quantity: Math.round(qtyInBase), salePrice: item.salePrice, costPrice: costPerBase, totalAmount: itemTotal, subtotalAmount: itemSubtotal, warrantyDays: item.warrantyDays, supplierId: item.supplierId || null, supplierName: item.supplierName || null },
        });

        await writeStockCard(tx, {
          productId:   item.productId,
          docNo:       existing.saleNo,
          docDate,
          source:      "SALE",
          qtyIn:       0,
          qtyOut:      qtyInBase,
          priceIn:     0,
          detail:      `ขาย ${item.qty} ${item.unitName}`,
          referenceId: saleItem.id,
        });

        if (item.lotItems.length > 0) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
            select: { isLotControl: true },
          });
          if (product?.isLotControl) {
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

            const sc = await tx.stockCard.findFirst({
              where: { referenceId: saleItem.id, source: "SALE" },
              select: { id: true },
            });
            if (sc) await writeStockMovementLots(tx, sc.id, lotsInBase, "out");
          }
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
        paymentType === SalePaymentType.CASH_SALE && cashBankAccountId
          ? [{
              accountId: cashBankAccountId,
              txnDate: docDate,
              direction: CashBankDirection.IN,
              amount: netAmount,
              referenceNo: existing.saleNo,
              note: note ?? null,
            }]
          : [],
      );
    });

    revalidatePath("/admin/sales");
    revalidatePath(`/admin/sales/${id}`);
    revalidatePath("/admin/products");
    return { success: true };
  } catch (err) {
    console.error("[updateSale]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// ─────────────────────────────────────────
// updateShippingStatus
// ─────────────────────────────────────────

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
    await db.sale.update({
      where: { id: saleId },
      data: {
        shippingStatus: parsed.data.shippingStatus,
        ...(parsed.data.trackingNo !== undefined ? { trackingNo: parsed.data.trackingNo } : {}),
        ...(parsed.data.shippingMethod !== undefined ? { shippingMethod: parsed.data.shippingMethod } : {}),
      },
    });
    revalidatePath("/admin/delivery");
    revalidatePath(`/admin/sales/${saleId}`);
    return { success: true };
  } catch (err) {
    console.error("[updateShippingStatus]", err);
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

// ─────────────────────────────────────────
// fetchProductLots — for SaleForm auto-allocate
// ─────────────────────────────────────────

export async function fetchProductLots(
  productId: string,
  lotIssueMethod: string
): Promise<LotAvailableJSON[] | { error: string }> {
  if (!productId) return { error: "ไม่ระบุสินค้า" };
  try {
    const balances = await db.lotBalance.findMany({
      where: { productId, qtyOnHand: { gt: 0 } },
      select: { lotNo: true, qtyOnHand: true },
    });
    const lots: LotAvailableJSON[] = await Promise.all(
      balances.map(async (b) => {
        const master = await db.productLot.findUnique({
          where: { productId_lotNo: { productId, lotNo: b.lotNo } },
          select: { unitCost: true, expDate: true, mfgDate: true },
        });
        return {
          lotNo:     b.lotNo,
          qtyOnHand: Number(b.qtyOnHand),
          unitCost:  Number(master?.unitCost ?? 0),
          expDate:   master?.expDate ? master.expDate.toISOString().slice(0, 10) : null,
          mfgDate:   master?.mfgDate ? master.mfgDate.toISOString().slice(0, 10) : null,
        };
      })
    );
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
