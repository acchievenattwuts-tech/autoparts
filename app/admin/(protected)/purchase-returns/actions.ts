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
import { reportCriticalError } from "@/lib/error-reporting";
import { requirePermission } from "@/lib/require-auth";
import { generatePurchaseReturnNo } from "@/lib/doc-number";
import { withDocNumberRetry } from "@/lib/doc-number-retry";
import {
  getDocumentMutationBlockMessage, assertDocumentMutationAllowedInTx,
  lockStockMutationProducts, DocumentMutationBlockedError,
  assertRewrittenStockRowsAllowedInTx, buildRewrittenStockRowsWhere,
  checkDocumentMutation, buildMutationBlockMessage, buildMutationBlockReferenceLinks,
} from "@/lib/document-mutation-guard";
import {
  AuditAction,
  Prisma,
  CashBankDirection,
  CashBankSourceType,
  ClaimStockMovementType,
  DocumentPaymentDocType,
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
import { formatDateOnlyForInput, isDateOnlyString, parseDateOnlyToDate } from "@/lib/th-date";
import type { LotAvailableJSON } from "@/lib/lot-control-client";
import { LotStockInsufficientError } from "@/lib/lot-stock-error";
import {
  getTransactionProductDetailRowsByIds,
  searchTransactionProductDetailRows,
  type TransactionProductDetailRow,
} from "@/lib/transaction-product-search";
import { recalculatePurchaseReturnAmountRemain } from "@/lib/amount-remain";
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
import { getOriginalClaimUnitCost, reverseClaimStockMovements, writeClaimStockMovement } from "@/lib/claim-stock";
import { isInventoryTracked } from "@/lib/inventory-tracking";
import { getPurchaseUserErrorMessage, PurchaseUserError } from "../purchases/purchase-user-error";
import { assertPeriodsUnlocked, findLockedPeriods, PeriodLockedError, type PeriodLockResult } from "@/lib/period-lock";
import type { PeriodLockView } from "@/lib/period-lock-view";
import {
  canOverridePeriodLock,
  collectLineRemarkUpdates,
  loadStoredPaymentRows,
  notifyPeriodLockOverrideUsed,
  OPEN_PERIOD_RESULT,
  periodLockAuditMeta,
  readPeriodLockOverride,
  resolveDocumentPeriodLock,
  toPeriodLockView,
} from "@/lib/period-lock-document";
import { isPurchaseReturnNonFinancialChange } from "./purchase-return-period-lock";
import { isInputVatRecoverable } from "@/lib/input-vat";
import {
  getTaxInvoiceFieldsError,
  loadVatRegisteredFromFor,
  normalizeTaxInvoiceNo,
  parseTaxInvoiceDate,
  PURCHASE_RETURN_TAX_INVOICE_MESSAGES,
  toInputVatDecision,
  type TaxDocumentVat,
} from "../purchases/purchase-tax-invoice";
import { getPurchaseReturnVatMismatchMessage, resolvePurchaseReturnTaxDocument } from "./purchase-return-vat";
import { isPurchaseReturnTypeChangeAllowed, PURCHASE_RETURN_TYPE_CHANGE_MESSAGE } from "./purchase-return-presentation";
import type { PurchaseReturnCancelPreview } from "./purchase-return-cancel-preview";
import type { PurchaseReturnEditPreview } from "./purchase-return-edit-preview";
import { formatItemQuantity, roundItemQuantity } from "@/lib/item-quantity";
import {
  allocatePurchaseAllowanceAmounts, attachAllowanceItemIds, isPurchaseAllowanceType, planPurchaseAllowanceChange,
  postPurchaseAllowanceLines, postsPurchaseAllowance, preparePurchaseAllowanceCreate, previewPurchaseAllowanceCancel,
  previewPurchaseAllowanceChange, PurchaseAllowanceError,
  repostPurchaseAllowance, reversePurchaseAllowance, summarizePurchaseAllowance, todayPurchaseAllowancePostingDate,
  type PreparedPurchaseAllowance, type PurchaseAllowanceAudit, type PurchaseAllowanceChange, type PurchaseAllowanceSourceLine,
} from "@/lib/purchase-allowance";
import { rebuildPurchaseAllowanceProfitFacts } from "@/lib/profit-fact";
import { revalidateProfitDashboardCache } from "@/lib/profit-cache";

/** updatePurchaseReturn: the document changed after the edit form loaded it. */
const PURCHASE_RETURN_STALE_MESSAGE = "เอกสารถูกแก้ไขโดยผู้อื่นระหว่างที่คุณแก้ไข กรุณาโหลดหน้าใหม่";

type PurchaseReturnProductOption = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  avgCost: number;
  costPrice: number;
  inventoryTracking: string;
  isLotControl: boolean;
  isActive: boolean;
  categoryName: string;
  brandName: string | null;
  aliases: string[];
  units: { name: string; scale: number; isBase: boolean }[];
};

type LineData = {
  productId: string;
  unitName: string;
  qty: number;
  unitScale: number;
  qtyInBase: number;
  costPerBase: number;
  showPricePerUnit: number;
  isLotControl: boolean;
  isTracked: boolean;
  totalAmount: number;
  subtotalAmount: number;
  moreDetail: string | null;
  lotItems: z.infer<typeof lotSubRowSchema>[];
};

// Build a stable signature for a purchase-return line in BASE-UNIT terms.
// Lines whose signature matches an existing DB line produce identical
// StockCard (RETURN_OUT) + lot-ledger + amount effects, so the differential
// updater can keep them untouched. PurchaseReturnItemLot stores only
// lotNo+qty (no unitCost/mfg/exp), so the lot portion is simpler than
// purchase's signature.
type PurchaseReturnSigLot = {
  lotNo:     string;
  qtyInBase: number;
};

function buildPurchaseReturnItemSignature(payload: {
  productId:   string;
  qtyInBase:   number;
  costPerBase: number;
  lots:        PurchaseReturnSigLot[];
}): string {
  const round4 = (n: number) => Math.round(n * 10000) / 10000;
  const lotsSig = payload.lots
    .map((l) => [l.lotNo, round4(l.qtyInBase)].join("|"))
    .sort()
    .join("//");
  return [
    payload.productId,
    round4(payload.qtyInBase),
    round4(payload.costPerBase),
    lotsSig,
  ].join("||");
}

async function preloadPurchaseReturnLineMaps(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  items: z.infer<typeof returnItemSchema>[],
): Promise<{
  unitScaleMap: Map<string, number>;
  productMap: Map<string, { avgCost: number; costPrice: number; inventoryTracking: string; isLotControl: boolean }>;
}> {
  const productIds = [...new Set(items.map((item) => item.productId))];
  // Sequential awaits on the single transaction connection — Promise.all here
  // triggers the pg-adapter "client.query() while already executing" warning.
  const units = await tx.productUnit.findMany({
    where: {
      OR: items.map((item) => ({
        productId: item.productId,
        name: item.unitName,
      })),
    },
    select: { productId: true, name: true, scale: true },
  });
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, avgCost: true, costPrice: true, inventoryTracking: true, isLotControl: true },
  });

  return {
    unitScaleMap: new Map(
      units.map((unit) => [`${unit.productId}::${unit.name}`, Number(unit.scale)]),
    ),
    productMap: new Map(
      products.map((product) => [
        product.id,
        {
          avgCost: Number(product.avgCost),
          costPrice: Number(product.costPrice),
          inventoryTracking: product.inventoryTracking,
          isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
        },
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
  costPrice: unknown;
  inventoryTracking: string;
  isLotControl: boolean;
  isActive: boolean;
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
    costPrice: Number(product.costPrice),
    inventoryTracking: product.inventoryTracking,
    isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
    isActive: product.isActive,
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

const serializePurchaseReturnDetailRow = (
  product: TransactionProductDetailRow,
): PurchaseReturnProductOption => ({
  id: product.id,
  code: product.code,
  name: product.name,
  description: product.description,
  avgCost: product.avgCost,
  costPrice: product.costPrice,
  inventoryTracking: product.inventoryTracking,
  isLotControl: isInventoryTracked(product.inventoryTracking) && product.isLotControl,
  isActive: product.isActive,
  categoryName: product.categoryName,
  brandName: product.brandName,
  aliases: [],
  units: product.units,
});

async function requirePurchaseReturnProductPermission() {
  const createSession = await requirePermission("purchase_returns.create").catch(() => null);
  if (createSession?.user?.id) return createSession;
  return requirePermission("purchase_returns.update").catch(() => null);
}

export async function searchPurchaseReturnProducts(query: string) {
  const session = await requirePurchaseReturnProductPermission();
  if (!session?.user?.id) return [];

  return (await searchTransactionProductDetailRows(query)).map(serializePurchaseReturnDetailRow);
}

export async function loadPurchaseReturnProductsByIds(ids: string[]) {
  const session = await requirePurchaseReturnProductPermission();
  if (!session?.user?.id) return [];
  return (await getTransactionProductDetailRowsByIds(ids)).map(serializePurchaseReturnDetailRow);
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
  costPrice: z.coerce.number().min(0).optional(),
  moreDetail: z.string().max(500).optional(),
  lotItems: z.array(lotSubRowSchema).default([]),
});

const returnSchema = z.object({
  returnDate: z.string().min(1, "กรุณาระบุวันที่").refine(isDateOnlyString, "กรุณาระบุวันที่ให้ถูกต้อง"),
  purchaseId: z.string().max(50).optional(),
  claimId: z.string().max(50).optional(),
  supplierId: z.string().min(1, "กรุณาเลือกผู้จำหน่าย").max(50),
  type: z.nativeEnum(PurchaseReturnType).default(PurchaseReturnType.RETURN),
  settlementType: z.nativeEnum(PurchaseReturnSettlementType).default(PurchaseReturnSettlementType.CASH_REFUND),
  refundMethod: z.nativeEnum(PurchaseReturnRefundMethod).optional(),
  cashBankAccountId: z.string().optional(),
  note: z.string().max(500).optional(),
  vatType: z.nativeEnum(VatType).default(VatType.NO_VAT),
  vatRate: z.coerce.number().min(0).max(100).default(0),
  // V5: the supplier's credit note — required when vatType ≠ NO_VAT.
  taxInvoiceNo: z.string().optional(),
  taxInvoiceDate: z.string().optional(),
  items: z.array(returnItemSchema).min(1, "ต้องมีรายการสินค้าอย่างน้อย 1 รายการ").max(100),
}).superRefine((data, ctx) => {
  const message = getTaxInvoiceFieldsError(data, PURCHASE_RETURN_TAX_INVOICE_MESSAGES);
  if (message) ctx.addIssue({ code: "custom", message, path: ["taxInvoiceNo"] });
});

// Payment total is checked inside the transaction because netAmount depends on the
// line costs read there; a mismatch is still the user's to fix, not a system error.
function assertRefundPaymentsMatchTotal(payments: DocumentPaymentRow[], netAmount: number): void {
  try {
    assertPaymentsMatchTotal(payments, netAmount);
  } catch (error) {
    throw new PurchaseUserError(
      error instanceof Error ? error.message : "ยอดช่องทางรับเงินไม่ตรงกับยอดเอกสาร",
    );
  }
}

// lib/lot-control checks lot balances before deducting anything; surface that
// shortage to the user. Any other error is rethrown unchanged.
function rethrowLotShortageAsUserError(error: unknown): never {
  if (error instanceof LotStockInsufficientError) {
    throw new PurchaseUserError(error.message);
  }
  throw error;
}

async function resolvePurchaseReturnRefundMethod(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  payments: DocumentPaymentRow[],
): Promise<PurchaseReturnRefundMethod | null> {
  if (payments.length === 0) return null;

  const accountIds = [...new Set(payments.map((row) => row.cashBankAccountId))];
  const accounts = await tx.cashBankAccount.findMany({
    where: { id: { in: accountIds } },
    select: { type: true },
  });
  if (accounts.length !== accountIds.length) {
    throw new PurchaseUserError("ไม่พบบัญชีรับเงิน");
  }

  const allCash = accounts.every((account) => account.type === "CASH");
  return allCash
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
      throw new PurchaseUserError(`ไม่พบหน่วย ${item.unitName} ของสินค้า`);
    }

    const qtyInBase = item.qty * scale;
    const product = productMap.get(item.productId);
    if (!product) {
      throw new PurchaseUserError("ไม่พบสินค้า");
    }

    const isTracked = isInventoryTracked(product.inventoryTracking);
    const fallbackCost = isTracked ? product.avgCost : product.costPrice;
    const costPerBase = item.costPrice && item.costPrice > 0 ? item.costPrice / scale : fallbackCost;
    // X2 (owner 2026-09-30): the exact base quantity as stored (W7, 4 decimals), never Math.round — 0.5 x 100 is 50,
    // not 100. An integer quantity (float noise removed) gives the same amount as before.
    const totalAmount = roundItemQuantity(qtyInBase) * costPerBase;
    const subtotalAmount = calcItemSubtotal(totalAmount, vatType, vatRate);

    lineData.push({
      productId: item.productId,
      unitName: item.unitName,
      qty: item.qty,
      unitScale: scale,
      qtyInBase,
      costPerBase,
      showPricePerUnit: item.costPrice && item.costPrice > 0 ? item.costPrice : fallbackCost * scale,
      isLotControl: product.isLotControl,
      isTracked,
      totalAmount,
      subtotalAmount,
      moreDetail: item.moreDetail || null,
      lotItems: item.lotItems,
    });
  }

  return lineData;
}

/**
 * V8 W3: the lines of a DISCOUNT/OTHER return as the ลดราคาซื้อ posting sees them (lineNo = form order). The cost each
 * removes follows lib/input-vat.ts on the document that decides recoverability (the referenced purchase — V3 — else
 * the return itself with its own credit-note date): recoverable → pre-VAT, otherwise VAT-inclusive.
 */
async function buildPurchaseAllowanceSourceLines(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  lineData: LineData[],
  vat: TaxDocumentVat & { vatType: VatType; vatRate: number },
  sourcePurchaseVat: TaxDocumentVat | null,
): Promise<PurchaseAllowanceSourceLine[]> {
  const taxDocument = resolvePurchaseReturnTaxDocument(vat, sourcePurchaseVat);
  const registeredFrom = await loadVatRegisteredFromFor(tx, [taxDocument]);
  const rawTotal = lineData.reduce((sum, line) => sum + line.totalAmount, 0);
  const { subtotalAmount, netAmount } = calcVat(rawTotal, vat.vatType, vat.vatRate);
  const costs = allocatePurchaseAllowanceAmounts({
    lineAmounts: lineData.map((line) => line.totalAmount), subtotalAmount, netAmount,
    vatRecoverable: isInputVatRecoverable(toInputVatDecision(taxDocument, registeredFrom)),
  });
  return lineData.map((line, index) => ({ lineNo: index + 1, productId: line.productId, qtyInBase: line.qtyInBase,
    costAmount: costs[index] ?? 0, isTracked: line.isTracked }));
}

/** A new DISCOUNT/OTHER return: coverage at today's position, read under the sorted SKU locks like a DN posting. */
async function prepareNewPurchaseAllowance(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  lineData: LineData[],
  vat: TaxDocumentVat & { vatType: VatType; vatRate: number },
  sourcePurchaseVat: TaxDocumentVat | null,
  postingDate: Date,
): Promise<PreparedPurchaseAllowance> {
  const lines = await buildPurchaseAllowanceSourceLines(tx, lineData, vat, sourcePurchaseVat);
  await lockStockMutationProducts(tx, lines.filter((line) => line.isTracked).map((line) => line.productId));
  return preparePurchaseAllowanceCreate(tx, { postingDate, lines });
}

/** Mutable holder: the transaction callback records what the audit entry reports after commit. */
type PurchaseAllowanceAuditHolder = { audit: PurchaseAllowanceAudit | null; touched: boolean };

/** Both month-lock checks of one save (return dates, then the ลดราคาซื้อ posting and restated documents). */
function mergePeriodLockResults(first: PeriodLockResult, second: PeriodLockResult): PeriodLockResult {
  const periods = new Map([...first.locked, ...second.locked].map((period) => [period.periodKey, period]));
  return {
    locked: [...periods.values()].sort((a, b) => a.periodKey.localeCompare(b.periodKey)),
    overridden: first.overridden || second.overridden,
  };
}

/**
 * Build a per-product map of the effective per-base purchase cost from the
 * source purchase's StockCard PURCHASE rows. Used by purchase returns linked
 * to a source bill so the OUT cost matches what actually hit MAVG when the
 * purchase was processed (priceIn + landedCost/qtyIn). Falls back to current
 * MAVG when a productId has no matching row in the source purchase.
 */
async function buildPurchaseReferenceCostMap(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  purchaseId: string | undefined,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!purchaseId) return map;

  const purchase = await tx.purchase.findUnique({
    where: { id: purchaseId },
    select: {
      purchaseNo: true,
      items: { orderBy: { lineNo: "asc" }, select: { id: true, productId: true } },
    },
  });
  if (!purchase || purchase.items.length === 0) return map;

  const itemIds = purchase.items.map((i) => i.id);
  const stockRows = await tx.stockCard.findMany({
    where: {
      docNo: purchase.purchaseNo,
      source: "PURCHASE",
      referenceId: { in: itemIds },
    },
    select: { productId: true, qtyIn: true, priceIn: true, landedCost: true },
  });

  // Aggregate by productId (weighted across multiple PurchaseItems with same productId)
  const totals = new Map<string, { qty: number; cost: number }>();
  for (const row of stockRows) {
    const qty = Number(row.qtyIn);
    if (qty <= 0) continue;
    const lineCost = Number(row.priceIn) * qty + Number(row.landedCost);
    const acc = totals.get(row.productId) ?? { qty: 0, cost: 0 };
    acc.qty += qty;
    acc.cost += lineCost;
    totals.set(row.productId, acc);
  }
  for (const [productId, { qty, cost }] of totals) {
    if (qty > 0) map.set(productId, cost / qty);
  }
  return map;
}

async function writePurchaseReturnLines(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  purchaseReturnId: string,
  returnNo: string,
  docDate: Date,
  lineData: { line: LineData; lineNo: number }[],
  type: PurchaseReturnType,
  sourcePurchaseId: string | undefined,
): Promise<Map<number, string>> {
  const writeStock = type === PurchaseReturnType.RETURN;
  const referenceCostMap = writeStock
    ? await buildPurchaseReferenceCostMap(tx, sourcePurchaseId)
    : new Map<string, number>();
  const itemIdsByLineNo = new Map<number, string>();

  for (const { line, lineNo } of lineData) {
    if (writeStock && line.isLotControl) {
      const lotError = validateLotRows(line.lotItems as LotSubRow[], line.qty, false);
      if (lotError) throw new PurchaseUserError(lotError);
    }
    // W7: the exact base quantity (the StockCard row's qtyOut), shown with the shared quantity format.
    const lineDetail = `คืน ${formatItemQuantity(line.qty, { useGrouping: false })} ${line.unitName}`;

    const returnItem = await tx.purchaseReturnItem.create({
      data: {
        purchaseReturnId,
        lineNo,
        productId: line.productId,
        qty: roundItemQuantity(line.qtyInBase),
        costPrice: line.costPerBase,
        amount: line.totalAmount,
        subtotalAmount: line.subtotalAmount,
        detail: lineDetail,
        showQty: line.qty,
        showUnitName: line.unitName,
        showPricePerUnit: line.showPricePerUnit,
        unitScale: line.unitScale,
        moreDetail: line.moreDetail,
      },
    });
    itemIdsByLineNo.set(lineNo, returnItem.id);

    if (writeStock && line.isTracked) {
      const referenceCost = referenceCostMap.get(line.productId);
      const usesReferenceCost = referenceCost !== undefined && referenceCost > 0;
      const stockCardId = await writeStockCard(tx, {
        productId: line.productId,
        docNo: returnNo,
        docDate,
        source: "RETURN_OUT",
        qtyIn: 0,
        qtyOut: line.qtyInBase,
        priceIn: usesReferenceCost ? referenceCost : 0,
        usesReferenceCost,
        detail: lineDetail,
        referenceId: returnItem.id,
      });

      if (line.isLotControl && line.lotItems.length > 0) {
        const lineScale = line.qty === 0 ? 1 : line.qtyInBase / line.qty;
        const lotsInBase = line.lotItems.map((lot) => ({
          lotNo: lot.lotNo.trim(),
          qtyInBase: lot.qty * lineScale,
          unitCostBase: line.costPerBase,
          mfgDate: lot.mfgDate ? parseDateOnlyToDate(lot.mfgDate) : null,
          expDate: lot.expDate ? parseDateOnlyToDate(lot.expDate) : null,
        }));

        try {
          await writePurchaseReturnLots(tx, returnItem.id, line.productId, lotsInBase);
        } catch (error) {
          rethrowLotShortageAsUserError(error);
        }

        await writeStockMovementLots(tx, stockCardId, lotsInBase, "out");
      }
    }
  }
  return itemIdsByLineNo;
}

/**
 * Checks the referenced purchase (ACTIVE, same supplier, same VAT — V3) before any write and
 * returns its VAT and tax-invoice date, which the return inherits for recoverability.
 */
async function validatePurchaseReturnSourcePurchase(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  purchaseId: string | undefined,
  supplierId: string,
  vat: { vatType: VatType; vatRate: number },
): Promise<TaxDocumentVat | null> {
  if (!purchaseId) return null;

  const purchase = await tx.purchase.findUnique({
    where: { id: purchaseId },
    select: {
      id: true,
      status: true,
      supplierId: true,
      purchaseNo: true,
      vatType: true,
      vatRate: true,
      taxInvoiceDate: true,
    },
  });

  if (!purchase || purchase.status !== "ACTIVE") {
    throw new PurchaseUserError("ไม่พบใบซื้ออ้างอิง หรือเอกสารถูกยกเลิกแล้ว");
  }

  if (purchase.supplierId !== supplierId) {
    throw new PurchaseUserError(`ใบซื้อ ${purchase.purchaseNo} ไม่ได้เป็นของผู้จำหน่ายรายที่เลือก`);
  }

  const vatMismatchMessage = getPurchaseReturnVatMismatchMessage(
    { purchaseNo: purchase.purchaseNo, vatType: purchase.vatType, vatRate: Number(purchase.vatRate) },
    vat,
  );
  if (vatMismatchMessage) throw new PurchaseUserError(vatMismatchMessage);

  return { vatType: purchase.vatType, vatRate: Number(purchase.vatRate), taxInvoiceDate: purchase.taxInvoiceDate };
}

async function validatePurchaseReturnClaim(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  claimId: string | undefined,
  supplierId: string,
): Promise<{ id: string; claimNo: string; warrantyId: string; productId: string } | null> {
  if (!claimId) return null;

  const claim = await tx.warrantyClaim.findUnique({
    where: { id: claimId },
    select: {
      id: true,
      claimNo: true,
      status: true,
      supplierId: true,
      warrantyId: true,
      warranty: { select: { productId: true } },
    },
  });

  if (!claim || claim.status === "CANCELLED") {
    throw new PurchaseUserError("ไม่พบใบเคลมที่ใช้งานได้");
  }

  if (claim.supplierId && claim.supplierId !== supplierId) {
    throw new PurchaseUserError(`ใบเคลม ${claim.claimNo} ไม่ได้เป็นของผู้จำหน่ายรายที่เลือก`);
  }

  return {
    id: claim.id,
    claimNo: claim.claimNo,
    warrantyId: claim.warrantyId,
    productId: claim.warranty.productId,
  };
}

async function getPurchaseReturnAuditSnapshot(purchaseReturnId: string) {
  const [purchaseReturn, payments] = await Promise.all([
    db.purchaseReturn.findUnique({
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
        orderBy: [{ lineNo: "asc" }, { id: "asc" }],
        select: {
          productId: true,
          qty: true,
          costPrice: true,
          amount: true,
          subtotalAmount: true,
          detail: true,
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
      where: { docType: DocumentPaymentDocType.CN_PURCHASE, docId: purchaseReturnId },
      orderBy: [{ lineNo: "asc" }, { id: "asc" }],
      select: { cashBankAccountId: true, amount: true },
    }),
  ]);

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
    claimId: purchaseReturn.claimId,
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
    taxInvoiceNo: purchaseReturn.taxInvoiceNo,
    taxInvoiceDate: purchaseReturn.taxInvoiceDate,
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
      moreDetail: item.moreDetail,
    })),
    payments: payments.map((payment) => ({
      cashBankAccountId: payment.cashBankAccountId,
      amount: payment.amount,
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
    claimId: formData.get("claimId") || undefined,
    supplierId: formData.get("supplierId") || undefined,
    type: (formData.get("type") as PurchaseReturnType) || PurchaseReturnType.RETURN,
    settlementType: formData.get("settlementType") || PurchaseReturnSettlementType.CASH_REFUND,
    refundMethod: (formData.get("refundMethod") as PurchaseReturnRefundMethod) || undefined,
    cashBankAccountId: formData.get("cashBankAccountId") || undefined,
    note: formData.get("note") || undefined,
    vatType: (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate: formData.get("vatRate") || 0,
    taxInvoiceNo: formData.get("taxInvoiceNo") ?? undefined,
    taxInvoiceDate: formData.get("taxInvoiceDate") ?? undefined,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  const {
    returnDate,
    purchaseId,
    claimId,
    supplierId,
    type,
    settlementType,
    note,
    vatType,
    vatRate,
    items: validItems,
  } = parsed.data;
  const taxInvoiceNo = normalizeTaxInvoiceNo(parsed.data.taxInvoiceNo);
  const taxInvoiceDate = parseTaxInvoiceDate(parsed.data.taxInvoiceDate);

  const isCashRefund = settlementType === PurchaseReturnSettlementType.CASH_REFUND;
  let payments: DocumentPaymentRow[] = [];
  if (isCashRefund) {
    try {
      payments = parseDocumentPaymentRows(formData.get("payments"));
    } catch {
      return { error: "รูปแบบข้อมูลช่องทางรับเงินไม่ถูกต้อง" };
    }
    if (payments.length === 0) {
      return { error: "กรุณาระบุช่องทางรับเงินอย่างน้อย 1 ช่องทาง" };
    }
  }
  const resolvedCashBankAccountId = derivePrimaryAccountId(payments) ?? undefined;

  const docDate = parseDateOnlyToDate(returnDate);
  // V8 (W1/W2): a DISCOUNT/OTHER return also lowers stock cost ("ลดราคาซื้อ") at today's Thai business date.
  const allowancePosted = postsPurchaseAllowance({ type, claimId });
  let returnNo = "";
  let createdPurchaseReturnId = "";
  const allowanceState: PurchaseAllowanceAuditHolder = { audit: null, touched: false };

  try {
    const requestContext = await getRequestContext();
    // If another save takes the same returnNo first (P2002), regenerate it and
    // retry the fully rolled-back transaction instead of failing the return.
    await withDocNumberRetry({
      uniqueField: "returnNo",
      generate: () => generatePurchaseReturnNo(docDate),
      run: async (nextReturnNo) => {
        returnNo = nextReturnNo;
        createdPurchaseReturnId = "";
        allowanceState.audit = null;
        allowanceState.touched = false;
        await dbTx(async (tx) => {
          const sourcePurchaseVat = await validatePurchaseReturnSourcePurchase(tx, purchaseId, supplierId, { vatType, vatRate });
          const linkedClaim = await validatePurchaseReturnClaim(tx, claimId, supplierId);
          const allowancePostingDate = todayPurchaseAllowancePostingDate();
          // A new return dated in a month whose profit was distributed is refused (no override on create); a
          // DISCOUNT/OTHER return also needs its ลดราคาซื้อ posting month open.
          await assertPeriodsUnlocked(tx, allowancePosted ? [docDate, allowancePostingDate] : [docDate]);

          const lineData = await buildLineData(tx, validItems, vatType, vatRate);
          const allowance = allowancePosted
            ? await prepareNewPurchaseAllowance(tx, lineData, { vatType, vatRate, taxInvoiceDate }, sourcePurchaseVat, allowancePostingDate)
            : null;
          const rawTotal = lineData.reduce((sum, line) => sum + line.totalAmount, 0);
          const { subtotalAmount, vatAmount, netAmount } = calcVat(rawTotal, vatType, vatRate);
          if (isCashRefund) {
            assertRefundPaymentsMatchTotal(payments, netAmount);
          }
          const refundMethod = await resolvePurchaseReturnRefundMethod(tx, payments);

          const purchaseReturn = await tx.purchaseReturn.create({
            data: {
              returnNo,
              returnDate: docDate,
              purchaseId: purchaseId || null,
              claimId: linkedClaim?.id ?? null,
              supplierId,
              userId: session.user.id,
              totalAmount: netAmount,
              note: note?.trim() || null,
              vatType,
              vatRate,
              taxInvoiceNo,
              taxInvoiceDate,
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

          const itemIdsByLineNo = await writePurchaseReturnLines(
            tx,
            purchaseReturn.id,
            returnNo,
            docDate,
            lineData.map((line, idx) => ({ line, lineNo: idx + 1 })),
            type,
            purchaseId,
          );

          if (allowance) {
            if (allowance.lines.length > 0) {
              await postPurchaseAllowanceLines(tx, { returnNo, positions: allowance.positions,
                lines: attachAllowanceItemIds(allowance.lines, itemIdsByLineNo) });
              await rebuildPurchaseAllowanceProfitFacts(tx, purchaseReturn.id);
            }
            allowanceState.audit = summarizePurchaseAllowance({ postingDate: allowance.postingDate, lines: allowance.lines });
            allowanceState.touched = allowance.lines.length > 0;
          }

          if (linkedClaim) {
            const originalCost = await getOriginalClaimUnitCost(tx, linkedClaim.warrantyId);
            await writeClaimStockMovement(tx, {
              claimId: linkedClaim.id,
              productId: linkedClaim.productId,
              movementType: ClaimStockMovementType.SUPPLIER_CREDIT_SETTLE,
              docNo: returnNo,
              docDate,
              qtyIn: 0,
              qtyOut: 0,
              unitCost: originalCost.unitCost,
              lotNo: originalCost.lotNo,
              purchaseReturnId: purchaseReturn.id,
              detail: `ผูกใบลดหนี้ซื้อกับใบเคลม ${linkedClaim.claimNo}`,
            });
          }

          if (settlementType === PurchaseReturnSettlementType.SUPPLIER_CREDIT) {
            await recalculatePurchaseReturnAmountRemain(tx, purchaseReturn.id);
          }

          await replaceDocumentPayments(
            tx,
            DocumentPaymentDocType.CN_PURCHASE,
            purchaseReturn.id,
            CashBankDirection.IN,
            payments,
          );
          await replaceCashBankSourceMovements(
            tx,
            CashBankSourceType.CN_PURCHASE,
            purchaseReturn.id,
            toCashBankEntries(payments, {
              txnDate: docDate,
              direction: CashBankDirection.IN,
              referenceNo: returnNo,
              note: note?.trim() || null,
            }),
          );
        }, { timeout: 180_000 });
      },
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
        ...(allowanceState.audit ? { meta: { purchaseAllowance: allowanceState.audit } } : {}),
      });
    }

    revalidatePath("/admin/purchase-returns");
    revalidatePath("/admin/products");
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    if (allowanceState.touched) revalidateProfitDashboardCache();
    return { success: true, returnNo };
  } catch (error) {
    if (error instanceof PeriodLockedError) return { error: error.message };
    if (error instanceof PurchaseAllowanceError) return { error: error.message };
    const userMessage = getPurchaseUserErrorMessage(error);
    if (userMessage) return { error: userMessage };
    await reportCriticalError(error, { scope: "purchase_returns.create" });
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

const cancelReturnSchema = z.object({
  returnId: z.string().min(1),
  cancelNote: z.string().max(200).optional(),
});

const previewReturnIdSchema = z.string().min(1).max(50);
const NO_CANCEL_PREVIEW: PurchaseReturnCancelPreview = { block: null, periodLock: null, restatement: null };

/**
 * X4 (owner 2026-09-30): the months cancelling this return would touch — its date, and for a DISCOUNT/OTHER return
 * the ลดราคาซื้อ posting month and the restated later sales / credit notes (the planner the cancel runs, reads only) —
 * so the cancel dialog can ask an owner for the override reason up front. Z1 (owner 2026-10-01): first the
 * reference-chain guard cancelPurchaseReturn runs, so the dialog (list and detail page alike) shows why a return used
 * by an active document cannot be cancelled, with the same message and links as the detail page. cancelPurchaseReturn
 * re-checks under its locks and, when it still rejects for the lock, returns the months too.
 */
export async function previewPurchaseReturnCancel(
  returnId: string,
): Promise<{ preview?: PurchaseReturnCancelPreview; error?: string }> {
  const session = await requirePermission("purchase_returns.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  const parsedId = previewReturnIdSchema.safeParse(returnId);
  if (!parsedId.success) return { error: "รหัสเอกสารไม่ถูกต้อง" };

  try {
    const ret = await db.purchaseReturn.findUnique({
      where: { id: parsedId.data },
      select: { status: true, type: true, returnNo: true, returnDate: true, createdAt: true },
    });
    if (!ret || ret.status !== "ACTIVE") return { preview: NO_CANCEL_PREVIEW };
    const guard = await checkDocumentMutation("PurchaseReturn", parsedId.data, "cancel");
    const blockMessage = buildMutationBlockMessage(guard);
    if (blockMessage) {
      return { preview: { ...NO_CANCEL_PREVIEW, block: { message: blockMessage, links: buildMutationBlockReferenceLinks(guard) } } };
    }
    const { locked, restatement } = await dbTx(async (tx) => {
      const allowance = isPurchaseAllowanceType(ret.type)
        ? await previewPurchaseAllowanceCancel(tx, { returnNo: ret.returnNo, createdAt: ret.createdAt })
        : null;
      return {
        locked: await findLockedPeriods(tx, [ret.returnDate, ...(allowance?.lockDates ?? [])]),
        restatement: allowance?.restatement ?? null,
      };
    });
    return {
      preview: { block: null, periodLock: toPeriodLockView(locked, canOverridePeriodLock(session.user.permissions)), restatement },
    };
  } catch (error) {
    console.error("[previewPurchaseReturnCancel]", error);
    return { error: "ตรวจสอบเดือนที่ประกาศปันผลแล้วไม่สำเร็จ" };
  }
}

export async function cancelPurchaseReturn(
  formData: FormData,
): Promise<{ success?: boolean; error?: string; periodLock?: PeriodLockView }> {
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
      items: { orderBy: { lineNo: "asc" }, select: { id: true, productId: true } },
    },
  });
  if (!ret) return { error: "ไม่พบเอกสาร" };
  if (ret.status === "CANCELLED") return { error: "เอกสารถูกยกเลิกไปแล้ว" };
  const mutationBlockMessage = await getDocumentMutationBlockMessage("PurchaseReturn", ret.id, "cancel");
  if (mutationBlockMessage) return { error: mutationBlockMessage };

  const activeRefs = await getActiveSupplierPaymentRefs(ret.id);
  if (activeRefs.length > 0) {
    return {
      error: `ไม่สามารถยกเลิกได้ เนื่องจากถูกใช้ในเอกสารจ่ายชำระ: ${activeRefs.join(", ")}`,
    };
  }

  const affectedProductIds = [...new Set(ret.items.map((item) => item.productId))];
  const hadStock = ret.type === PurchaseReturnType.RETURN;
  // V8: a DISCOUNT/OTHER return may hold ลดราคาซื้อ rows to reverse.
  const hadAllowance = isPurchaseAllowanceType(ret.type);
  const allowanceState: PurchaseAllowanceAuditHolder = { audit: null, touched: false };
  const lockOverride = readPeriodLockOverride(formData, session.user.permissions);
  let periodLock: PeriodLockResult = OPEN_PERIOD_RESULT;

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getPurchaseReturnAuditSnapshot(ret.id);
    await dbTx(async (tx) => {
      // Re-check the status under the row lock: a concurrent cancel/update that passed the
      // same pre-check must not reverse lot balances or rewrite RETURN_OUT rows a second time.
      const locked = await tx.$queryRaw<{ status: string; returnDate?: Date | null }[]>(Prisma.sql`SELECT "status"::text AS "status", "returnDate" FROM "PurchaseReturn" WHERE "id" = ${ret.id} FOR UPDATE`);
      if (locked[0]?.status !== "ACTIVE") throw new PurchaseUserError("เอกสารถูกยกเลิกไปแล้ว");
      await lockStockMutationProducts(tx, affectedProductIds);
      await assertDocumentMutationAllowedInTx(tx, "PurchaseReturn", ret.id, "cancel");
      // V8 (W5): reversing ลดราคาซื้อ restates later sales, so its posting month and theirs are locked too (reads only).
      const allowanceChange: PurchaseAllowanceChange | null = hadAllowance
        ? await planPurchaseAllowanceChange(tx, { returnNo: ret.returnNo, createdAt: ret.createdAt, lines: [] })
        : null;
      // Month lock on the date stored under the row lock, before any write.
      periodLock = await assertPeriodsUnlocked(tx,
        [locked[0]?.returnDate ?? ret.returnDate, ...(allowanceChange?.lockDates ?? [])], lockOverride);
      if (ret.claimId) {
        await reverseClaimStockMovements(tx, ret.claimId, {
          movementTypes: [ClaimStockMovementType.SUPPLIER_CREDIT_SETTLE],
          docNos: [ret.returnNo],
        });
      }

      if (hadStock) {
        for (const item of ret.items) {
          await reversePurchaseReturnLotBalance(tx, item.id, item.productId);
        }
        await tx.stockCard.deleteMany({ where: { docNo: ret.returnNo } });
        for (const productId of affectedProductIds) {
          await recalculateStockCard(tx, productId);
        }
      }

      if (allowanceChange && !allowanceChange.unchanged) {
        await reversePurchaseAllowance(tx, allowanceChange);
        await repostPurchaseAllowance(tx, allowanceChange, { purchaseReturnId: ret.id, itemIds: new Map(), cancelled: true });
        allowanceState.audit = summarizePurchaseAllowance({ postingDate: allowanceChange.postingDate, lines: [], change: allowanceChange });
        allowanceState.touched = true;
      }

      await clearCashBankSourceMovements(tx, CashBankSourceType.CN_PURCHASE, ret.id);
      await clearDocumentPayments(tx, DocumentPaymentDocType.CN_PURCHASE, ret.id);

      await tx.purchaseReturn.update({
        where: { id: ret.id },
        data: {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancelNote: parsed.data.cancelNote?.trim() || null,
          amountRemain: 0,
        },
      });
    }, { timeout: 180_000 });

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
        meta: { cancelNote: parsed.data.cancelNote?.trim() || null, ...periodLockAuditMeta(periodLock, lockOverride),
          ...(allowanceState.audit ? { purchaseAllowance: allowanceState.audit } : {}) },
      });
    }
    await notifyPeriodLockOverrideUsed({
      result: periodLock,
      override: lockOverride,
      entityType: "PurchaseReturn",
      entityId: ret.id,
      docNo: ret.returnNo,
      action: "ยกเลิกใบคืนสินค้า/ลดหนี้ซื้อ",
      actorName: session.user.name ?? session.user.email,
      link: `/admin/purchase-returns/${ret.id}`,
    });

    revalidatePath("/admin/purchase-returns");
    revalidatePath(`/admin/purchase-returns/${ret.id}`);
    revalidatePath("/admin/products");
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    if (allowanceState.touched) revalidateProfitDashboardCache();
    return { success: true };
  } catch (error) {
    if (error instanceof PeriodLockedError) {
      // X4: the months the lock found, so the dialog can ask for the reason even if its preview missed one.
      const periodLockView = toPeriodLockView(error.periods, lockOverride.allowed);
      return { error: error.message, ...(periodLockView ? { periodLock: periodLockView } : {}) };
    }
    if (error instanceof DocumentMutationBlockedError) return { error: error.message };
    if (error instanceof PurchaseAllowanceError) return { error: error.message };
    const userMessage = getPurchaseUserErrorMessage(error);
    if (userMessage) return { error: userMessage };
    await reportCriticalError(error, { scope: "purchase_returns.cancel" });
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

/** The stored return an edit (and its preview) compares with and rewrites. */
const purchaseReturnEditInclude = {
  items: {
    orderBy: { lineNo: "asc" },
    select: {
      id: true, productId: true, qty: true, costPrice: true, showQty: true, showUnitName: true, moreDetail: true,
      lotItems: { orderBy: { id: "asc" }, select: { lotNo: true, qty: true } },
    },
  },
  // V3: a referenced return inherits the purchase's input-VAT recoverability.
  purchase: { select: { vatType: true, vatRate: true, taxInvoiceDate: true } },
} satisfies Prisma.PurchaseReturnInclude;

type StoredPurchaseReturnEdit = Prisma.PurchaseReturnGetPayload<{ include: typeof purchaseReturnEditInclude }>;
type PurchaseReturnEditInput = z.infer<typeof returnSchema>;

const isValidPurchaseReturnId = (id: string): boolean => Boolean(id) && id.length <= 50 && /^[a-z0-9]+$/.test(id);

/** The edit form's header and lines (updatePurchaseReturn and its preview), validated by returnSchema. */
function parsePurchaseReturnEditForm(formData: FormData): { data: PurchaseReturnEditInput } | { error: string } {
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
    claimId: formData.get("claimId") || undefined,
    supplierId: formData.get("supplierId") || undefined,
    type: (formData.get("type") as PurchaseReturnType) || PurchaseReturnType.RETURN,
    settlementType: formData.get("settlementType") || PurchaseReturnSettlementType.CASH_REFUND,
    refundMethod: (formData.get("refundMethod") as PurchaseReturnRefundMethod) || undefined,
    cashBankAccountId: formData.get("cashBankAccountId") || undefined,
    note: formData.get("note") || undefined,
    vatType: (formData.get("vatType") as VatType) || VatType.NO_VAT,
    vatRate: formData.get("vatRate") || 0,
    taxInvoiceNo: formData.get("taxInvoiceNo") ?? undefined,
    taxInvoiceDate: formData.get("taxInvoiceDate") ?? undefined,
    items,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  return { data: parsed.data };
}

/** A cash refund carries at least one refund channel; a supplier credit carries none. */
function parsePurchaseReturnRefundPayments(
  formData: FormData,
  settlementType: PurchaseReturnSettlementType,
): { payments: DocumentPaymentRow[] } | { error: string } {
  if (settlementType !== PurchaseReturnSettlementType.CASH_REFUND) return { payments: [] };
  let payments: DocumentPaymentRow[];
  try {
    payments = parseDocumentPaymentRows(formData.get("payments"));
  } catch {
    return { error: "รูปแบบข้อมูลช่องทางรับเงินไม่ถูกต้อง" };
  }
  if (payments.length === 0) return { error: "กรุณาระบุช่องทางรับเงินอย่างน้อย 1 ช่องทาง" };
  return { payments };
}

/** What an edit submits, as the month-lock comparison reads it. */
type PurchaseReturnEditSubmission = {
  docDate: Date;
  input: PurchaseReturnEditInput;
  taxInvoiceDate: Date | null;
  sourcePurchaseVat: TaxDocumentVat | null;
  lineData: LineData[];
  payments: DocumentPaymentRow[];
};

/**
 * Owner decisions ก2/P4/V5 (purchase-return-period-lock.ts): does the edit change only what a locked month allows —
 * the note, line remarks and the credit-note number/date while input-VAT recoverability stays the same?
 */
async function isPurchaseReturnEditNonFinancial(
  tx: Prisma.TransactionClient,
  existing: StoredPurchaseReturnEdit,
  submitted: PurchaseReturnEditSubmission,
): Promise<boolean> {
  try {
    const { input } = submitted;
    // V5: the credit-note number/date are remarks unless the date flips recoverability.
    const storedTaxDocument = resolvePurchaseReturnTaxDocument(existing, existing.purchaseId ? existing.purchase : null);
    const submittedTaxDocument = resolvePurchaseReturnTaxDocument(
      { vatType: input.vatType, vatRate: input.vatRate, taxInvoiceDate: submitted.taxInvoiceDate },
      submitted.sourcePurchaseVat,
    );
    const registeredFrom = await loadVatRegisteredFromFor(tx, [storedTaxDocument, submittedTaxDocument]);
    return isPurchaseReturnNonFinancialChange(
      {
        returnDate: existing.returnDate,
        purchaseId: existing.purchaseId,
        claimId: existing.claimId,
        supplierId: existing.supplierId,
        type: existing.type,
        settlementType: existing.settlementType,
        vatType: existing.vatType,
        vatRate: existing.vatRate,
        inputVatRecoverable: isInputVatRecoverable(toInputVatDecision(storedTaxDocument, registeredFrom)),
        lines: existing.items.map((item) => ({
          signature: buildPurchaseReturnItemSignature({
            productId: item.productId,
            qtyInBase: Number(item.qty),
            costPerBase: Number(item.costPrice),
            lots: item.lotItems.map((lot) => ({ lotNo: lot.lotNo, qtyInBase: Number(lot.qty) })),
          }),
          showQty: item.showQty,
          showUnitName: item.showUnitName,
        })),
        payments: await loadStoredPaymentRows(tx, DocumentPaymentDocType.CN_PURCHASE, existing.id),
      },
      {
        returnDate: submitted.docDate,
        purchaseId: input.purchaseId || null,
        claimId: input.claimId || null,
        supplierId: input.supplierId,
        type: input.type,
        settlementType: input.settlementType,
        vatType: input.vatType,
        vatRate: input.vatRate,
        inputVatRecoverable: isInputVatRecoverable(toInputVatDecision(submittedTaxDocument, registeredFrom)),
        lines: submitted.lineData.map((line) => ({
          signature: buildPurchaseReturnItemSignature({
            productId: line.productId,
            qtyInBase: line.qtyInBase,
            costPerBase: line.costPerBase,
            lots: line.lotItems.map((lot) => ({ lotNo: lot.lotNo.trim(), qtyInBase: lot.qty * line.unitScale })),
          }),
          showQty: line.qty,
          showUnitName: line.unitName,
        })),
        payments: submitted.payments,
      },
    );
  } catch (error) {
    console.error("[isPurchaseReturnEditNonFinancial]", error);
    throw error;
  }
}

const NO_EDIT_PREVIEW: PurchaseReturnEditPreview = { periodLock: null, nonFinancial: false, restatement: null };

/**
 * Y2 (owner 2026-09-30): the months saving this edit would touch — the stored and new return date and, for a
 * DISCOUNT/OTHER return, the ลดราคาซื้อ posting month and the later sales / credit notes the repost restates (the
 * planner the edit runs, reads only) — so the edit form can ask an owner for the override reason up front. A change the
 * month lock treats as non-financial reports `nonFinancial` (it saves without a reason and reposts nothing) in a locked
 * return month and, on a DISCOUNT/OTHER return, in an open one too (Z3: ลดราคาซื้อ stays as posted).
 * updatePurchaseReturn re-checks everything under its locks and, when it still rejects for the lock, returns the
 * months too.
 */
export async function previewPurchaseReturnUpdate(
  id: string,
  formData: FormData,
): Promise<{ preview?: PurchaseReturnEditPreview; error?: string }> {
  const session = await requirePermission("purchase_returns.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  if (!isValidPurchaseReturnId(id)) return { error: "รหัสเอกสารไม่ถูกต้อง" };
  const form = parsePurchaseReturnEditForm(formData);
  if ("error" in form) return { error: form.error };
  const input = form.data;
  const refund = parsePurchaseReturnRefundPayments(formData, input.settlementType);
  if ("error" in refund) return { error: refund.error };

  try {
    const existing = await db.purchaseReturn.findUnique({ where: { id }, include: purchaseReturnEditInclude });
    if (!existing || existing.status !== "ACTIVE") return { preview: NO_EDIT_PREVIEW };
    if (!isPurchaseReturnTypeChangeAllowed(existing.type, input.type)) return { error: PURCHASE_RETURN_TYPE_CHANGE_MESSAGE };
    const docDate = parseDateOnlyToDate(input.returnDate);
    const taxInvoiceDate = parseTaxInvoiceDate(input.taxInvoiceDate);
    const canOverride = canOverridePeriodLock(session.user.permissions);
    const preview = await dbTx(async (tx): Promise<PurchaseReturnEditPreview> => {
      const sourcePurchaseVat = await validatePurchaseReturnSourcePurchase(tx, input.purchaseId, input.supplierId,
        { vatType: input.vatType, vatRate: input.vatRate });
      const lineData = await buildLineData(tx, input.items, input.vatType, input.vatRate);
      const returnLocked = await findLockedPeriods(tx, [existing.returnDate, docDate]);
      const allowanceInvolved = isPurchaseAllowanceType(existing.type) || postsPurchaseAllowance(input);
      // The note-only path of a locked return month, and Z3: a remark-only edit keeps ลดราคาซื้อ as posted.
      if ((returnLocked.length > 0 || allowanceInvolved) && await isPurchaseReturnEditNonFinancial(tx, existing,
        { docDate, input, taxInvoiceDate, sourcePurchaseVat, lineData, payments: refund.payments })) {
        return { periodLock: toPeriodLockView(returnLocked, canOverride), nonFinancial: true, restatement: null };
      }
      // X3 keeps RETURN vs DISCOUNT/OTHER, so a return with ลดราคาซื้อ rows never had RETURN_OUT rows.
      const allowance = allowanceInvolved
        ? await previewPurchaseAllowanceChange(tx, {
          returnNo: existing.returnNo,
          createdAt: existing.createdAt,
          lines: postsPurchaseAllowance(input)
            ? await buildPurchaseAllowanceSourceLines(tx, lineData, { vatType: input.vatType, vatRate: input.vatRate, taxInvoiceDate },
              sourcePurchaseVat)
            : [],
        })
        : null;
      const locked = allowance && allowance.lockDates.length > 0
        ? await findLockedPeriods(tx, [existing.returnDate, docDate, ...allowance.lockDates])
        : returnLocked;
      return { periodLock: toPeriodLockView(locked, canOverride), nonFinancial: false, restatement: allowance?.restatement ?? null };
    });
    return { preview };
  } catch (error) {
    if (error instanceof PurchaseAllowanceError) return { error: error.message };
    const userMessage = getPurchaseUserErrorMessage(error);
    if (userMessage) return { error: userMessage };
    console.error("[previewPurchaseReturnUpdate]", error);
    return { error: "ตรวจสอบเดือนที่ประกาศปันผลแล้วไม่สำเร็จ" };
  }
}

export async function updatePurchaseReturn(
  id: string,
  formData: FormData,
): Promise<{ success?: boolean; error?: string; periodLock?: PeriodLockView }> {
  const session = await requirePermission("purchase_returns.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!isValidPurchaseReturnId(id)) {
    return { error: "รหัสเอกสารไม่ถูกต้อง" };
  }

  const existing = await db.purchaseReturn.findUnique({ where: { id }, include: purchaseReturnEditInclude });
  if (!existing) return { error: "ไม่พบเอกสาร" };
  if (existing.status === "CANCELLED") {
    return { error: "เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้" };
  }
  const mutationBlockMessage = await getDocumentMutationBlockMessage("PurchaseReturn", id, "update");
  if (mutationBlockMessage) return { error: mutationBlockMessage };

  const activeRefs = await getActiveSupplierPaymentRefs(id);
  if (activeRefs.length > 0) {
    return {
      error: `ไม่สามารถแก้ไขได้ เนื่องจากถูกใช้ในเอกสารจ่ายชำระ: ${activeRefs.join(", ")}`,
    };
  }

  const parsed = parsePurchaseReturnEditForm(formData);
  if ("error" in parsed) return { error: parsed.error };

  const {
    returnDate,
    purchaseId,
    claimId,
    supplierId,
    type,
    settlementType,
    note,
    vatType,
    vatRate,
    items: validItems,
  } = parsed.data;
  // X3: RETURN ↔ DISCOUNT/OTHER is a different document (stock rows vs ลดราคาซื้อ rows); refused before the
  // transaction. The updatedAt re-check under the row lock below keeps `existing.type` current.
  if (!isPurchaseReturnTypeChangeAllowed(existing.type, type)) {
    return { error: PURCHASE_RETURN_TYPE_CHANGE_MESSAGE };
  }
  const taxInvoiceNo = normalizeTaxInvoiceNo(parsed.data.taxInvoiceNo);
  const taxInvoiceDate = parseTaxInvoiceDate(parsed.data.taxInvoiceDate);

  const isCashRefund = settlementType === PurchaseReturnSettlementType.CASH_REFUND;
  const refund = parsePurchaseReturnRefundPayments(formData, settlementType);
  if ("error" in refund) return { error: refund.error };
  const { payments } = refund;
  const resolvedCashBankAccountId = derivePrimaryAccountId(payments) ?? undefined;

  // Optimistic concurrency: the updatedAt the edit form loaded, compared under the row lock.
  const expectedUpdatedAt = Date.parse(String(formData.get("updatedAt") ?? ""));

  const docDate = parseDateOnlyToDate(returnDate);
  const oldProductIds = [...new Set(existing.items.map((item) => item.productId))];
  const oldHadStock = existing.type === PurchaseReturnType.RETURN;
  // V8: ลดราคาซื้อ rows to reverse (a DISCOUNT/OTHER return) and/or to post (the edited return is one).
  const oldHadAllowance = isPurchaseAllowanceType(existing.type);
  const newPostsAllowance = postsPurchaseAllowance({ type, claimId });
  const allowanceInvolved = oldHadAllowance || newPostsAllowance;
  const allowanceState: PurchaseAllowanceAuditHolder = { audit: null, touched: false };

  // ─── Differential decision (header-level triggers) ────────────────────────
  // Falls back to full reset when any of these change, because the change
  // affects every existing line:
  //   - returnDate → docDate of every StockCard row would need to change
  //   - type (DISCOUNT ↔ OTHER; RETURN ↔ DISCOUNT/OTHER is refused above — X3)
  //   - purchaseId → buildPurchaseReferenceCostMap() shifts → priceIn of
  //     every RETURN_OUT row would need to change
  // claimId change is handled separately (per-document, runs in both paths).
  const returnDateChanged =
    formatDateOnlyForInput(existing.returnDate) !== returnDate;
  const typeChanged = existing.type !== type;
  const purchaseIdChanged =
    (existing.purchaseId ?? null) !== (purchaseId || null);
  const useDifferential =
    !returnDateChanged && !typeChanged && !purchaseIdChanged;
  const lockOverride = readPeriodLockOverride(formData, session.user.permissions);
  let periodLock: PeriodLockResult = OPEN_PERIOD_RESULT;

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getPurchaseReturnAuditSnapshot(id);
    await dbTx(async (tx) => {
      // A return cancelled after the pre-check must not get RETURN_OUT rows back.
      const locked = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`SELECT "status"::text AS "status" FROM "PurchaseReturn" WHERE "id" = ${id} FOR UPDATE`);
      if (locked[0]?.status !== "ACTIVE") throw new PurchaseUserError("เอกสารถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้");
      const current = await tx.purchaseReturn.findUnique({ where: { id }, select: { updatedAt: true } });
      if (!current || current.updatedAt.getTime() !== expectedUpdatedAt) {
        throw new PurchaseUserError(PURCHASE_RETURN_STALE_MESSAGE);
      }
      await lockStockMutationProducts(tx, [...existing.items.map((item) => item.productId), ...validItems.map((item) => item.productId)]);
      await assertDocumentMutationAllowedInTx(tx, "PurchaseReturn", id, "update");
      const sourcePurchaseVat = await validatePurchaseReturnSourcePurchase(tx, purchaseId, supplierId, { vatType, vatRate });
      const linkedClaim = await validatePurchaseReturnClaim(tx, claimId, supplierId);

      // Build lineData first so we have resolved per-base costs for both the
      // header total and the signature comparison.
      const lineData = await buildLineData(tx, validItems, vatType, vatRate);

      // Month lock (owner decisions T2/ก1/ก2) — under the row lock, before any write, on the
      // stored and the new date. `existing` is current: updatedAt was re-checked above.
      let nonFinancialEdit: Promise<boolean> | null = null;
      const isNonFinancialEdit = (): Promise<boolean> => (nonFinancialEdit ??= isPurchaseReturnEditNonFinancial(tx, existing,
        { docDate, input: parsed.data, taxInvoiceDate, sourcePurchaseVat, lineData, payments }));
      const periodDecision = await resolveDocumentPeriodLock(tx, [existing.returnDate, docDate], {
        override: lockOverride,
        isNonFinancialOnly: isNonFinancialEdit,
      });
      if (periodDecision.kind === "non-financial") {
        // Locked month, note / credit-note number+date / line-detail edit (ก2/P4/V5): stock,
        // supplier credit, refunds and cash/bank stay untouched.
        await tx.purchaseReturn.update({
          where: { id },
          data: { note: note?.trim() || null, taxInvoiceNo, taxInvoiceDate },
        });
        for (const remark of collectLineRemarkUpdates(existing.items, lineData, ["moreDetail"])) {
          await tx.purchaseReturnItem.update({ where: { id: remark.id }, data: remark.data });
        }
        return;
      }
      periodLock = periodDecision.result;
      // Z3 (owner 2026-10-01): a remark-only edit of a DISCOUNT/OTHER return in an open return month keeps its
      // ลดราคาซื้อ rows as posted — not replanned, reposted or month-lock checked — even when stock was backdated before
      // the posting since then. Same comparison as the locked-month path above; every line is kept (same signatures).
      const replansAllowance = allowanceInvolved && !(await isNonFinancialEdit());

      // ─── Per-line diff (only meaningful when useDifferential) ────────────
      type ExistingPRSig = {
        existingItemId: string;
        productId:      string;
        signature:      string;
      };
      type NewPRSig = {
        newIdx:    number;
        productId: string;
        signature: string;
      };

      const oldItemSigs: ExistingPRSig[] = useDifferential
        ? existing.items.map((item) => ({
            existingItemId: item.id,
            productId:      item.productId,
            signature: buildPurchaseReturnItemSignature({
              productId:   item.productId,
              qtyInBase:   Number(item.qty),
              costPerBase: Number(item.costPrice),
              lots: item.lotItems.map((l) => ({
                lotNo:     l.lotNo,
                qtyInBase: Number(l.qty),
              })),
            }),
          }))
        : [];

      const newItemSigs: NewPRSig[] = useDifferential
        ? lineData.map((line, idx) => ({
            newIdx:    idx,
            productId: line.productId,
            signature: buildPurchaseReturnItemSignature({
              productId:   line.productId,
              qtyInBase:   line.qtyInBase,
              costPerBase: line.costPerBase,
              lots: (line.lotItems ?? []).map((l) => {
                const lineScale = line.qty === 0 ? 1 : line.qtyInBase / line.qty;
                return {
                  lotNo:     l.lotNo.trim(),
                  qtyInBase: l.qty * lineScale,
                };
              }),
            }),
          }))
        : [];

      // Greedy multiset match
      const matchedExistingIds = new Set<string>();
      const matchedByNewIdx = new Map<number, string>();
      if (useDifferential) {
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
      }
      const removedExistingItems = useDifferential
        ? oldItemSigs.filter((o) => !matchedExistingIds.has(o.existingItemId))
        : [];
      const addedNewItems = useDifferential
        ? newItemSigs.filter((n) => !matchedByNewIdx.has(n.newIdx))
        : [];
      const affectedProductIds = new Set<string>();
      removedExistingItems.forEach((r) => affectedProductIds.add(r.productId));
      addedNewItems.forEach((a) => affectedProductIds.add(a.productId));

      // Only the StockCard rows deleted below are checked against a later supplier DN,
      // under the locks above and before the first write.
      await assertRewrittenStockRowsAllowedInTx(tx, oldHadStock
        ? buildRewrittenStockRowsWhere(
            existing.returnNo,
            useDifferential ? removedExistingItems.map((r) => r.existingItemId) : "ALL",
          )
        : null);

      // V8 (W5): plan the ลดราคาซื้อ repost at its original posting date/position and the later sales it restates,
      // and check the month lock over that posting date and those documents — reads only, before any write. A
      // return that had RETURN_OUT rows is planned once they are removed below, since they change its coverage.
      const keptItemIds = new Map<number, string>();
      for (const [newIdx, itemId] of matchedByNewIdx) keptItemIds.set(newIdx + 1, itemId);
      const planAllowance = async (): Promise<PurchaseAllowanceChange> => {
        const lines = newPostsAllowance
          ? await buildPurchaseAllowanceSourceLines(tx, lineData, { vatType, vatRate, taxInvoiceDate }, sourcePurchaseVat)
          : [];
        const change = await planPurchaseAllowanceChange(tx, { returnNo: existing.returnNo, createdAt: existing.createdAt,
          lines, keptItemIds });
        if (change.lockDates.length > 0) {
          periodLock = mergePeriodLockResults(periodLock, await assertPeriodsUnlocked(tx, change.lockDates, lockOverride));
        }
        return change;
      };
      let allowanceChange: PurchaseAllowanceChange | null = replansAllowance && !oldHadStock ? await planAllowance() : null;

      if (existing.claimId) {
        await reverseClaimStockMovements(tx, existing.claimId, {
          movementTypes: [ClaimStockMovementType.SUPPLIER_CREDIT_SETTLE],
          docNos: [existing.returnNo],
        });
      }

      // ─── Drop stock effects + items for removed/all ──────────────────────
      if (useDifferential) {
        if (oldHadStock && removedExistingItems.length > 0) {
          for (const removed of removedExistingItems) {
            await reversePurchaseReturnLotBalance(tx, removed.existingItemId, removed.productId);
            await tx.stockCard.deleteMany({
              where: {
                docNo:       existing.returnNo,
                referenceId: removed.existingItemId,
              },
            });
          }
        }
        if (removedExistingItems.length > 0) {
          await tx.purchaseReturnItem.deleteMany({
            where: { id: { in: removedExistingItems.map((r) => r.existingItemId) } },
          });
        }
        if (oldHadStock) {
          for (const productId of affectedProductIds) {
            await recalculateStockCard(tx, productId);
          }
        }
      } else {
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
      }

      // V8: reverse the stored ลดราคาซื้อ rows before any new stock row of this return is written.
      if (replansAllowance) {
        allowanceChange ??= await planAllowance();
        await reversePurchaseAllowance(tx, allowanceChange);
      }

      const rawTotal = lineData.reduce((sum, line) => sum + line.totalAmount, 0);
      const { subtotalAmount, vatAmount, netAmount } = calcVat(rawTotal, vatType, vatRate);
      if (isCashRefund) {
        assertRefundPaymentsMatchTotal(payments, netAmount);
      }
      const refundMethod = await resolvePurchaseReturnRefundMethod(tx, payments);

      await tx.purchaseReturn.update({
        where: { id },
        data: {
          returnDate: docDate,
          purchaseId: purchaseId || null,
          claimId: linkedClaim?.id ?? null,
          supplierId,
          totalAmount: netAmount,
          note: note?.trim() || null,
          vatType,
          vatRate,
          taxInvoiceNo,
          taxInvoiceDate,
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

      // Sync header-derived fields on items we kept untouched in the
      // differential path. subtotalAmount = calcItemSubtotal(totalAmount,
      // vatType, vatRate) is always recomputed, so it follows header VAT
      // changes and replaces values stored by the former calcItemSubtotal bug.
      // amount too (X2): a fractional line saved before the exact-quantity fix
      // is restated with the header; an integer line keeps the same value.
      if (useDifferential && matchedByNewIdx.size > 0) {
        for (const [newIdx, existingItemId] of matchedByNewIdx) {
          const line = lineData[newIdx];
          await tx.purchaseReturnItem.update({
            where: { id: existingItemId },
            data: {
              lineNo: newIdx + 1,
              showQty: line.qty,
              showUnitName: line.unitName,
              showPricePerUnit: line.showPricePerUnit,
              unitScale: line.unitScale,
              moreDetail: line.moreDetail,
              amount: line.totalAmount,
              subtotalAmount: line.subtotalAmount,
            },
          });
        }
      }

      // Create only added (differential) or all (fallback) lines.
      const linesToWrite: { line: LineData; lineNo: number }[] = useDifferential
        ? addedNewItems.map((a) => ({ line: lineData[a.newIdx], lineNo: a.newIdx + 1 }))
        : lineData.map((line, idx) => ({ line, lineNo: idx + 1 }));
      const itemIdsByLineNo = new Map(keptItemIds);
      if (linesToWrite.length > 0) {
        const written = await writePurchaseReturnLines(tx, id, existing.returnNo, docDate, linesToWrite, type, purchaseId);
        for (const [lineNo, itemId] of written) itemIdsByLineNo.set(lineNo, itemId);
      }

      // V8: repost ลดราคาซื้อ at the original position, restate later sales and rebuild the variance facts.
      if (allowanceChange && !allowanceChange.unchanged) {
        await repostPurchaseAllowance(tx, allowanceChange, { purchaseReturnId: id, itemIds: itemIdsByLineNo });
        allowanceState.touched = true;
      }
      if (allowanceChange && (allowanceChange.oldRows.length > 0 || allowanceChange.lines.length > 0)) {
        allowanceState.audit = summarizePurchaseAllowance({ postingDate: allowanceChange.postingDate,
          lines: allowanceChange.lines, change: allowanceChange });
      }

      if (linkedClaim) {
        const originalCost = await getOriginalClaimUnitCost(tx, linkedClaim.warrantyId);
        await writeClaimStockMovement(tx, {
          claimId: linkedClaim.id,
          productId: linkedClaim.productId,
          movementType: ClaimStockMovementType.SUPPLIER_CREDIT_SETTLE,
          docNo: existing.returnNo,
          docDate,
          qtyIn: 0,
          qtyOut: 0,
          unitCost: originalCost.unitCost,
          lotNo: originalCost.lotNo,
          purchaseReturnId: id,
          detail: `ผูกใบลดหนี้ซื้อกับใบเคลม ${linkedClaim.claimNo}`,
        });
      }

      await recalculatePurchaseReturnAmountRemain(tx, id);

      await replaceDocumentPayments(
        tx,
        DocumentPaymentDocType.CN_PURCHASE,
        id,
        CashBankDirection.IN,
        payments,
      );
      await replaceCashBankSourceMovements(
        tx,
        CashBankSourceType.CN_PURCHASE,
        id,
        toCashBankEntries(payments, {
          txnDate: docDate,
          direction: CashBankDirection.IN,
          referenceNo: existing.returnNo,
          note: note?.trim() || null,
        }),
      );
    }, { timeout: 180_000 });

    const afterSnapshot = await getPurchaseReturnAuditSnapshot(id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      const updateMeta = {
        ...(periodLock.overridden ? periodLockAuditMeta(periodLock, lockOverride) : {}),
        ...(allowanceState.audit ? { purchaseAllowance: allowanceState.audit } : {}),
      };
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "PurchaseReturn",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.returnNo,
        before: diff.before,
        after: diff.after,
        ...(Object.keys(updateMeta).length > 0 ? { meta: updateMeta } : {}),
      });
    }
    await notifyPeriodLockOverrideUsed({
      result: periodLock,
      override: lockOverride,
      entityType: "PurchaseReturn",
      entityId: id,
      docNo: existing.returnNo,
      action: "แก้ไขใบคืนสินค้า/ลดหนี้ซื้อ",
      actorName: session.user.name ?? session.user.email,
      link: `/admin/purchase-returns/${id}`,
    });

    revalidatePath("/admin/purchase-returns");
    revalidatePath(`/admin/purchase-returns/${id}`);
    revalidatePath("/admin/products");
    revalidatePath("/admin/cash-bank");
    revalidatePath("/admin/reports");
    if (allowanceState.touched) revalidateProfitDashboardCache();
    return { success: true };
  } catch (error) {
    if (error instanceof PeriodLockedError) {
      // Y2: the months the lock found (return date, or the ลดราคาซื้อ posting and restated documents), so the edit
      // form asks for the reason even if its preview missed one.
      const periodLockView = toPeriodLockView(error.periods, lockOverride.allowed);
      return { error: error.message, ...(periodLockView ? { periodLock: periodLockView } : {}) };
    }
    if (error instanceof DocumentMutationBlockedError) return { error: error.message };
    if (error instanceof PurchaseAllowanceError) return { error: error.message };
    const userMessage = getPurchaseUserErrorMessage(error);
    if (userMessage) return { error: userMessage };
    await reportCriticalError(error, { scope: "purchase_returns.update" });
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function getPurchasesForSupplier(
  supplierId: string,
): Promise<{ id: string; purchaseNo: string; purchaseDate: Date }[]> {
  const session = await requirePurchaseReturnProductPermission();
  if (!session?.user?.id || !supplierId) return [];

  // Only ACTIVE purchases can be referenced (createPurchaseReturn rejects cancelled ones).
  return db.purchase.findMany({
    where: { supplierId, status: "ACTIVE" },
    orderBy: { purchaseDate: "desc" },
    take: 200,
    select: { id: true, purchaseNo: true, purchaseDate: true },
  });
}

export type PurchaseDetailResult = {
  items: { productId: string; unitName: string; qty: number; costPrice?: number; lotItems: z.infer<typeof lotSubRowSchema>[] }[];
  products: PurchaseReturnProductOption[];
  /** V3: the return uses this VAT (read-only in the form) and inherits its recoverability. */
  vat: PurchaseReturnSourceVat;
} | null;

/** Client-safe VAT basis of a referenced purchase; taxInvoiceDate is YYYY-MM-DD or "". */
export type PurchaseReturnSourceVat = { vatType: VatType; vatRate: number; taxInvoiceDate: string };

export async function getPurchaseDetail(purchaseId: string): Promise<PurchaseDetailResult> {
  const session = await requirePurchaseReturnProductPermission();
  if (!session?.user?.id || !purchaseId) return null;

  const purchase = await db.purchase.findUnique({
    where: { id: purchaseId },
    select: {
      vatType: true,
      vatRate: true,
      taxInvoiceDate: true,
      items: {
        orderBy: { lineNo: "asc" },
        select: {
          productId: true,
          quantity: true,
          costPrice: true,
          showQty: true,
          showUnitName: true,
          showPricePerUnit: true,
          unitScale: true,
          product: {
            select: {
              id: true,
              code: true,
              name: true,
              description: true,
              avgCost: true,
              costPrice: true,
              inventoryTracking: true,
              isLotControl: true,
              isActive: true,
              purchaseUnitName: true,
              category: { select: { name: true } },
              brand: { select: { name: true } },
              aliases: { select: { alias: true } },
              units: { select: { name: true, scale: true, isBase: true } },
            },
          },
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
    },
  });
  if (!purchase) return null;

  const productMap = new Map<string, PurchaseReturnProductOption>();
  const items = purchase.items.map((item) => {
    const unitName = item.product.purchaseUnitName ?? "";
    const unit = item.product.units.find((entry) => entry.name === unitName);
    const scale = Number(item.unitScale ?? unit?.scale ?? 1) || 1;
    const displayUnitName = item.showUnitName ?? unitName;
    const displayQty = item.showQty != null ? Number(item.showQty) : Number(item.quantity) / scale;
    const displayCostPrice =
      item.showPricePerUnit != null
        ? Number(item.showPricePerUnit)
        : Number(item.costPrice) * scale;
    productMap.set(item.productId, serializePurchaseReturnProductOption(item.product));

    return {
      productId: item.productId,
      unitName: displayUnitName,
      qty: displayQty,
      costPrice: displayCostPrice,
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
    vat: {
      vatType: purchase.vatType ?? VatType.NO_VAT,
      vatRate: Number(purchase.vatRate ?? 0),
      taxInvoiceDate: purchase.taxInvoiceDate ? formatDateOnlyForInput(purchase.taxInvoiceDate) : "",
    },
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
