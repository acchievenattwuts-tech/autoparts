import type { dbTx } from "@/lib/db";
import { CreditNoteType, DocStatus, MarketplaceReturnStockDisposition } from "@/lib/generated/prisma";
import { creditNoteSourceLotNo, matchSaleLotNo, type SaleLotOption } from "@/lib/credit-note-return-lots";
import { formatDateOnlyForInput } from "@/lib/th-date";

type CreditNoteTxClient = Parameters<Parameters<typeof dbTx>[0]>[0];
type SaleLotsClient = Pick<CreditNoteTxClient, "saleItemLot" | "creditNoteItemLot" | "productLot">;

const QTY_PRECISION = 10000;
const QTY_TOLERANCE = 0.0001;

const roundQty = (value: number): number => Math.round(value * QTY_PRECISION) / QTY_PRECISION;

/** One lot a sale line sold, in base units, with what ACTIVE RETURN credit notes already brought back. */
export interface SaleLineLotBalance {
  lotNo: string;
  soldBaseQty: number;
  returnedBaseQty: number;
  unitCostBase: number;
  mfgDate: Date | null;
  expDate: Date | null;
}

/** A credit-note RETURN lot that is not in the sale or exceeds what the sale line sold of it. */
export class CreditNoteReturnLotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CreditNoteReturnLotError";
  }
}

/**
 * Lots each sale line sold (SaleItemLot, in sale order) and how much of each lot ACTIVE
 * RETURN credit notes of this sale already returned. RET- lots count against their
 * source lot. Legacy CN lines without saleItemId count only when the product has one
 * sale line, matching validateReferencedReturnItems. Lines sold without lots are absent.
 * Reads run one after another so a transaction client never queues queries.
 */
export async function loadSaleLineLotBalances(
  client: SaleLotsClient,
  params: {
    saleId: string;
    saleLines: { id: string; productId: string }[];
    excludeCreditNoteId?: string;
  },
): Promise<Map<string, SaleLineLotBalance[]>> {
  const balancesBySaleItemId = new Map<string, SaleLineLotBalance[]>();
  if (params.saleLines.length === 0) return balancesBySaleItemId;

  const soldLots = await client.saleItemLot.findMany({
    where: { saleItemId: { in: params.saleLines.map((line) => line.id) } },
    orderBy: { id: "asc" },
    select: { saleItemId: true, lotNo: true, qty: true, unitCost: true },
  });
  if (soldLots.length === 0) return balancesBySaleItemId;

  const productIdBySaleItemId = new Map(params.saleLines.map((line) => [line.id, line.productId]));
  const lotNos = [...new Set(soldLots.map((lot) => lot.lotNo))];
  const lottedProductIds = [
    ...new Set(soldLots.map((lot) => productIdBySaleItemId.get(lot.saleItemId) ?? "")),
  ].filter(Boolean);
  const productLots = await client.productLot.findMany({
    where: { productId: { in: lottedProductIds }, lotNo: { in: lotNos } },
    select: { productId: true, lotNo: true, mfgDate: true, expDate: true },
  });
  const productLotByKey = new Map(productLots.map((lot) => [`${lot.productId}::${lot.lotNo}`, lot]));

  for (const sold of soldLots) {
    const lines = balancesBySaleItemId.get(sold.saleItemId) ?? [];
    const qty = Number(sold.qty);
    const existing = lines.find((line) => line.lotNo === sold.lotNo);
    if (existing) {
      // The same lot twice on one sale line: one row, quantity-weighted cost.
      const totalQty = existing.soldBaseQty + qty;
      existing.unitCostBase =
        totalQty > 0 ? (existing.unitCostBase * existing.soldBaseQty + Number(sold.unitCost) * qty) / totalQty : 0;
      existing.soldBaseQty = roundQty(totalQty);
    } else {
      const productLot = productLotByKey.get(`${productIdBySaleItemId.get(sold.saleItemId)}::${sold.lotNo}`);
      lines.push({
        lotNo: sold.lotNo,
        soldBaseQty: roundQty(qty),
        returnedBaseQty: 0,
        unitCostBase: Number(sold.unitCost),
        mfgDate: productLot?.mfgDate ?? null,
        expDate: productLot?.expDate ?? null,
      });
    }
    balancesBySaleItemId.set(sold.saleItemId, lines);
  }

  const lineCountByProductId = new Map<string, number>();
  for (const line of params.saleLines) {
    lineCountByProductId.set(line.productId, (lineCountByProductId.get(line.productId) ?? 0) + 1);
  }
  const singleSaleItemIdByProductId = new Map(
    params.saleLines
      .filter((line) => lineCountByProductId.get(line.productId) === 1)
      .map((line) => [line.productId, line.id]),
  );

  const returnedLots = await client.creditNoteItemLot.findMany({
    where: {
      creditNoteItem: {
        creditNote: {
          saleId: params.saleId,
          status: DocStatus.ACTIVE,
          type: CreditNoteType.RETURN,
          ...(params.excludeCreditNoteId ? { id: { not: params.excludeCreditNoteId } } : {}),
        },
        OR: [
          { saleItemId: { in: [...balancesBySaleItemId.keys()] } },
          { saleItemId: null, productId: { in: [...singleSaleItemIdByProductId.keys()] } },
        ],
      },
    },
    select: {
      creditNoteItemId: true,
      lotNo: true,
      qty: true,
      isReturnLot: true,
      creditNoteItem: { select: { saleItemId: true, productId: true } },
    },
  });

  for (const returned of returnedLots) {
    const saleItemId =
      returned.creditNoteItem.saleItemId ??
      singleSaleItemIdByProductId.get(returned.creditNoteItem.productId ?? "");
    const lines = saleItemId ? balancesBySaleItemId.get(saleItemId) : undefined;
    if (!lines) continue;
    const sourceLotNo = creditNoteSourceLotNo(returned.lotNo, returned.isReturnLot, returned.creditNoteItemId);
    const matchedLotNo = matchSaleLotNo(sourceLotNo, lines.map((line) => line.lotNo));
    const line = lines.find((candidate) => candidate.lotNo === matchedLotNo);
    if (line) line.returnedBaseQty = roundQty(line.returnedBaseQty + Number(returned.qty));
  }

  return balancesBySaleItemId;
}

/** The lots a sale line can still return (base units), for the form. */
export function toSaleLotOptions(balances: readonly SaleLineLotBalance[]): SaleLotOption[] {
  return balances.flatMap((balance) => {
    const remainingBaseQty = roundQty(balance.soldBaseQty - balance.returnedBaseQty);
    if (remainingBaseQty <= QTY_TOLERANCE) return [];
    return [{
      lotNo: balance.lotNo,
      baseQty: remainingBaseQty,
      unitCostBase: balance.unitCostBase,
      mfgDate: balance.mfgDate ? formatDateOnlyForInput(balance.mfgDate) : "",
      expDate: balance.expDate ? formatDateOnlyForInput(balance.expDate) : "",
    }];
  });
}

type ReturnLotLine = {
  productId: string;
  unitName: string;
  stockDisposition: MarketplaceReturnStockDisposition;
  lotItems: { lotNo: string; qty: number }[];
};

/**
 * Server guard for RETURN lines linked to a sale line that sold lots: every restocked
 * lot must be one of that line's lots, and per lot the quantity across this credit
 * note plus other ACTIVE returns must not exceed what the line sold. Sale lines sold
 * without lots (before lot control) keep free lot entry.
 */
export async function assertReturnLotsWithinSale(
  tx: CreditNoteTxClient,
  params: {
    saleId: string;
    items: ReturnLotLine[];
    resolvedSaleItemIds: Map<number, string>;
    excludeCreditNoteId?: string;
  },
): Promise<void> {
  const checkedLines = params.items.flatMap((item, index) => {
    const saleItemId = params.resolvedSaleItemIds.get(index);
    if (
      !saleItemId ||
      item.stockDisposition !== MarketplaceReturnStockDisposition.RESTOCK ||
      item.lotItems.length === 0
    ) {
      return [];
    }
    return [{ item, saleItemId }];
  });
  if (checkedLines.length === 0) return;

  const saleLines = await tx.saleItem.findMany({
    where: { saleId: params.saleId },
    select: { id: true, productId: true },
  });
  const balancesBySaleItemId = await loadSaleLineLotBalances(tx, {
    saleId: params.saleId,
    saleLines,
    excludeCreditNoteId: params.excludeCreditNoteId,
  });
  const units = await tx.productUnit.findMany({
    where: { OR: checkedLines.map(({ item }) => ({ productId: item.productId, name: item.unitName })) },
    select: { productId: true, name: true, scale: true },
  });
  const scaleByKey = new Map(units.map((unit) => [`${unit.productId}::${unit.name}`, Number(unit.scale)]));

  const requested = new Map<string, { baseQty: number; scale: number; unitName: string }>();
  for (const { item, saleItemId } of checkedLines) {
    const balances = balancesBySaleItemId.get(saleItemId);
    if (!balances) continue;
    const scale = scaleByKey.get(`${item.productId}::${item.unitName}`) ?? 1;
    for (const lot of item.lotItems) {
      const lotNo = lot.lotNo.trim();
      if (!balances.some((balance) => balance.lotNo === lotNo)) {
        throw new CreditNoteReturnLotError(`Lot ${lotNo} ไม่อยู่ในรายการขายของใบขายต้นทาง กรุณาเลือก Lot จากใบขาย`);
      }
      const key = `${saleItemId}::${lotNo}`;
      const entry = requested.get(key) ?? { baseQty: 0, scale, unitName: item.unitName };
      entry.baseQty = roundQty(entry.baseQty + lot.qty * scale);
      requested.set(key, entry);
    }
  }

  for (const [key, entry] of requested) {
    // saleItemId is a cuid, so the first separator splits it from a lot number that may contain one.
    const separatorIndex = key.indexOf("::");
    const saleItemId = key.slice(0, separatorIndex);
    const lotNo = key.slice(separatorIndex + 2);
    const balance = balancesBySaleItemId.get(saleItemId)?.find((candidate) => candidate.lotNo === lotNo);
    if (!balance) continue;
    const remainingBaseQty = roundQty(Math.max(0, balance.soldBaseQty - balance.returnedBaseQty));
    if (entry.baseQty > remainingBaseQty + QTY_TOLERANCE) {
      const remainingInUnit = roundQty(remainingBaseQty / (entry.scale > 0 ? entry.scale : 1));
      throw new CreditNoteReturnLotError(
        `Lot ${lotNo} คืนได้อีกไม่เกิน ${remainingInUnit} ${entry.unitName} ตามใบขายต้นทาง`,
      );
    }
  }
}
