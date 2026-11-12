/**
 * I2 (owner 2026-11-12): a RETURN purchase return that references a purchase may not send back more
 * than the purchase brought in. Same rule as the credit-note side (validateReferencedReturnItems /
 * lib/credit-note-return.ts): the quantity already returned by the source's other ACTIVE RETURN
 * documents (the one being edited excluded) plus this request, in base units, must not exceed the
 * purchased quantity, with the same 0.0001 tolerance. A purchase return line has no purchase-line id,
 * so quantities are matched per product. Products the purchase does not hold, DISCOUNT/OTHER returns
 * and returns without a referenced purchase are not checked here (unchanged).
 *
 * Kept outside the "use server" actions file because those may only export async functions.
 */
import { DocStatus, PurchaseReturnType, type Prisma } from "@/lib/generated/prisma";
import { isCreditNoteReturnQuantityAvailable } from "@/lib/credit-note-return";
import { formatItemQuantity, roundItemQuantity } from "@/lib/item-quantity";
import { PurchaseUserError } from "../purchases/purchase-user-error";

const QTY_TOLERANCE = 0.0001;

export type PurchaseReturnQuantityRequest = { productId: string; requestedBaseQty: number };

export type PurchaseReturnQuantityExcess = {
  productId: string;
  /** The first request line of the product (its unit names the remaining quantity). */
  requestIndex: number;
  remainingBaseQty: number;
};

/** First product whose cumulative return would exceed what the purchase holds; null when all fit. */
export function findPurchaseReturnQuantityExcess(input: {
  purchasedBaseQtyByProductId: ReadonlyMap<string, number>;
  returnedBaseQtyByProductId: ReadonlyMap<string, number>;
  requests: readonly PurchaseReturnQuantityRequest[];
}): PurchaseReturnQuantityExcess | null {
  const requested = new Map<string, { qty: number; index: number }>();
  input.requests.forEach((request, index) => {
    const entry = requested.get(request.productId) ?? { qty: 0, index };
    entry.qty += request.requestedBaseQty;
    requested.set(request.productId, entry);
  });
  for (const [productId, { qty, index }] of requested) {
    const purchased = input.purchasedBaseQtyByProductId.get(productId);
    if (purchased === undefined) continue;
    const returned = input.returnedBaseQtyByProductId.get(productId) ?? 0;
    if (!isCreditNoteReturnQuantityAvailable(purchased, returned, qty)) {
      return { productId, requestIndex: index, remainingBaseQty: roundItemQuantity(Math.max(0, purchased - returned)) };
    }
  }
  return null;
}

/** "สินค้า <code> <name> คืนได้อีกไม่เกิน <qty> <unit> ตามใบซื้อ <no>" — the remaining quantity in the line's unit. */
export function buildPurchaseReturnQuantityExceededMessage(input: {
  productLabel: string;
  remainingBaseQty: number;
  unitScale: number;
  unitName: string;
  purchaseNo: string;
}): string {
  const scale = input.unitScale > 0 ? input.unitScale : 1;
  const remaining = roundItemQuantity(input.remainingBaseQty / scale);
  return `สินค้า ${input.productLabel} คืนได้อีกไม่เกิน ${formatItemQuantity(remaining)} ${input.unitName} ตามใบซื้อ ${input.purchaseNo}`;
}

const sumByProduct = (rows: readonly { productId: string; qty: unknown }[]): Map<string, number> => {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.productId, (totals.get(row.productId) ?? 0) + Number(row.qty ?? 0));
  return totals;
};

/**
 * Inside the save transaction, after the referenced Purchase row is locked FOR UPDATE (so two returns of
 * the same purchase are checked one after the other). Throws the Thai PurchaseUserError before any write.
 */
export async function assertPurchaseReturnQuantitiesWithinPurchase(
  tx: Prisma.TransactionClient,
  input: {
    purchaseId: string;
    lines: readonly { productId: string; unitName: string; unitScale: number; qtyInBase: number }[];
    excludeReturnId?: string;
  },
): Promise<void> {
  // An interactive transaction owns one PostgreSQL client: keep these reads sequential.
  const purchaseItems = await tx.purchaseItem.findMany({
    where: { purchaseId: input.purchaseId },
    select: { productId: true, quantity: true, product: { select: { code: true, name: true } } },
  });
  const purchasedByProductId = sumByProduct(purchaseItems.map((item) => ({ productId: item.productId, qty: item.quantity })));
  const checkedProductIds = [...new Set(input.lines.map((line) => line.productId))]
    .filter((productId) => purchasedByProductId.has(productId));
  if (checkedProductIds.length === 0) return;

  const returnedItems = await tx.purchaseReturnItem.findMany({
    where: {
      productId: { in: checkedProductIds },
      purchaseReturn: {
        purchaseId: input.purchaseId,
        status: DocStatus.ACTIVE,
        type: PurchaseReturnType.RETURN,
        ...(input.excludeReturnId ? { id: { not: input.excludeReturnId } } : {}),
      },
    },
    select: { productId: true, qty: true },
  });
  const excess = findPurchaseReturnQuantityExcess({
    purchasedBaseQtyByProductId: purchasedByProductId,
    returnedBaseQtyByProductId: sumByProduct(returnedItems),
    requests: input.lines.map((line) => ({ productId: line.productId, requestedBaseQty: line.qtyInBase })),
  });
  if (!excess) return;

  const line = input.lines[excess.requestIndex];
  const product = purchaseItems.find((item) => item.productId === excess.productId)?.product;
  const purchase = await tx.purchase.findUnique({ where: { id: input.purchaseId }, select: { purchaseNo: true } });
  throw new PurchaseUserError(buildPurchaseReturnQuantityExceededMessage({
    productLabel: [product?.code, product?.name].filter(Boolean).join(" "),
    remainingBaseQty: excess.remainingBaseQty,
    unitScale: line?.unitScale ?? 1,
    unitName: line?.unitName ?? "",
    purchaseNo: purchase?.purchaseNo ?? "",
  }));
}

// ─── Form prefill (getPurchaseDetail) ────────────────────────────────────────

export type PurchaseLineQuantity = { productId: string; baseQty: number; lots: readonly { lotNo: string; baseQty: number }[] };

export type PurchaseLineRemaining = {
  /** Base quantity of this line already covered by earlier returns (0: the line prefills exactly as before). */
  returnedBaseQty: number;
  remainingBaseQty: number;
  /** The line's lot rows (by index) that still cover the remaining quantity, in purchase order. */
  lots: { lotIndex: number; baseQty: number }[];
};

/**
 * What each purchase line can still be returned, given the ACTIVE RETURN lines already returned against the
 * purchase. Returned quantities are matched per product and consume the purchase lines in line order; returned
 * lots consume the same lot of the line first, and the lot rows left are trimmed to the remaining quantity.
 */
export function computePurchaseLinesRemaining(
  purchaseLines: readonly PurchaseLineQuantity[],
  returnedLines: readonly PurchaseLineQuantity[],
): PurchaseLineRemaining[] {
  const returnedLeft = new Map<string, number>();
  const returnedLotLeft = new Map<string, number>();
  const lotKey = (productId: string, lotNo: string): string => `${productId}\u0000${lotNo}`;
  for (const line of returnedLines) {
    returnedLeft.set(line.productId, (returnedLeft.get(line.productId) ?? 0) + line.baseQty);
    for (const lot of line.lots) {
      const key = lotKey(line.productId, lot.lotNo);
      returnedLotLeft.set(key, (returnedLotLeft.get(key) ?? 0) + lot.baseQty);
    }
  }

  return purchaseLines.map((line) => {
    const available = returnedLeft.get(line.productId) ?? 0;
    const returnedBaseQty = Math.min(line.baseQty, Math.max(0, available));
    returnedLeft.set(line.productId, available - returnedBaseQty);
    if (returnedBaseQty <= QTY_TOLERANCE) return { returnedBaseQty: 0, remainingBaseQty: line.baseQty, lots: [] };

    let budget = roundItemQuantity(Math.max(0, line.baseQty - returnedBaseQty));
    const remainingBaseQty = budget <= QTY_TOLERANCE ? 0 : budget;
    const lots: PurchaseLineRemaining["lots"] = [];
    line.lots.forEach((lot, lotIndex) => {
      const key = lotKey(line.productId, lot.lotNo);
      const lotReturned = Math.min(lot.baseQty, Math.max(0, returnedLotLeft.get(key) ?? 0));
      returnedLotLeft.set(key, (returnedLotLeft.get(key) ?? 0) - lotReturned);
      const take = roundItemQuantity(Math.min(lot.baseQty - lotReturned, budget));
      if (remainingBaseQty === 0 || take <= QTY_TOLERANCE) return;
      lots.push({ lotIndex, baseQty: take });
      budget = roundItemQuantity(budget - take);
    });
    return { returnedBaseQty, remainingBaseQty, lots };
  });
}
