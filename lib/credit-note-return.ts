import { MarketplaceReturnStockDisposition } from "@/lib/generated/prisma";

const QUANTITY_TOLERANCE = 0.0001;

export function returnDispositionReversesStockCost(
  disposition: MarketplaceReturnStockDisposition,
): boolean {
  return disposition === MarketplaceReturnStockDisposition.RESTOCK;
}

export function resolveReturnUnitCost(input: {
  saleItemId?: string | null;
  productId?: string | null;
  saleItemCostById: ReadonlyMap<string, number>;
  productCostById: ReadonlyMap<string, number>;
  fallbackCost?: number;
}): number | undefined {
  return (
    input.saleItemCostById.get(input.saleItemId ?? "") ??
    input.productCostById.get(input.productId ?? "") ??
    input.fallbackCost
  );
}

export function isCreditNoteReturnQuantityAvailable(
  soldBaseQty: number,
  alreadyReturnedBaseQty: number,
  requestedBaseQty: number,
): boolean {
  const remaining = soldBaseQty - alreadyReturnedBaseQty;
  return requestedBaseQty - remaining <= QUANTITY_TOLERANCE;
}

export type ReferencedReturnSaleLine = {
  id: string;
  productId: string;
  soldBaseQty: number;
};

export type ReferencedReturnRequest = {
  saleItemId?: string;
  productId: string;
  requestedBaseQty: number;
};

export function resolveReferencedReturnSaleItemIds(input: {
  saleLines: ReferencedReturnSaleLine[];
  requests: ReferencedReturnRequest[];
  linkedReturnedBySaleItemId: ReadonlyMap<string, number>;
  legacyReturnedByProductId: ReadonlyMap<string, number>;
}): string[] {
  const saleLineMap = new Map(input.saleLines.map((line) => [line.id, line]));
  const linesByProduct = new Map<string, ReferencedReturnSaleLine[]>();
  for (const line of input.saleLines) {
    const rows = linesByProduct.get(line.productId) ?? [];
    rows.push(line);
    linesByProduct.set(line.productId, rows);
  }

  const resolvedIds = input.requests.map((request) => {
    if (request.saleItemId) {
      const line = saleLineMap.get(request.saleItemId);
      if (!line || line.productId !== request.productId) {
        throw new Error("CREDIT_NOTE_RETURN_INVALID_SALE_LINE");
      }
      return line.id;
    }
    const candidates = linesByProduct.get(request.productId) ?? [];
    if (candidates.length === 0) throw new Error("CREDIT_NOTE_RETURN_INVALID_SALE_LINE");
    if (candidates.length > 1) throw new Error("CREDIT_NOTE_RETURN_AMBIGUOUS_SALE_LINE");
    return candidates[0].id;
  });

  const requestedBySaleItemId = new Map<string, number>();
  input.requests.forEach((request, index) => {
    const saleItemId = resolvedIds[index];
    requestedBySaleItemId.set(
      saleItemId,
      (requestedBySaleItemId.get(saleItemId) ?? 0) + request.requestedBaseQty,
    );
  });

  for (const [saleItemId, requestedBaseQty] of requestedBySaleItemId) {
    const line = saleLineMap.get(saleItemId);
    if (!line) throw new Error("CREDIT_NOTE_RETURN_INVALID_SALE_LINE");
    const productLines = linesByProduct.get(line.productId) ?? [];
    const legacyReturned = input.legacyReturnedByProductId.get(line.productId) ?? 0;
    if (legacyReturned > 0 && productLines.length > 1) {
      throw new Error("CREDIT_NOTE_RETURN_AMBIGUOUS_HISTORY");
    }
    const alreadyReturned =
      (input.linkedReturnedBySaleItemId.get(saleItemId) ?? 0) + legacyReturned;
    if (
      !isCreditNoteReturnQuantityAvailable(
        line.soldBaseQty,
        alreadyReturned,
        requestedBaseQty,
      )
    ) {
      throw new Error("CREDIT_NOTE_RETURN_QTY_EXCEEDED");
    }
  }

  return resolvedIds;
}
