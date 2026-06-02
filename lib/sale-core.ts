import { PaymentMethod, Prisma } from "@/lib/generated/prisma";
import { isInventoryTracked } from "@/lib/inventory-tracking";
import type { LotSubRow } from "@/lib/lot-control";
import { addThailandDays, startOfThailandDay } from "@/lib/th-date";

/**
 * Shared Sale building blocks (extracted verbatim from sales/actions.ts so both
 * the manual sale flow and the Shopee importer use IDENTICAL logic).
 *
 * Behavior is unchanged — these are relocated helpers, not a re-implementation.
 * `tx` is the Prisma transaction client (same type the sale action passes).
 */

export type SaleCoreTxClient = Prisma.TransactionClient;

/** Minimal item shape preload needs (productId + unitName). */
export type SaleCoreItemInput = { productId: string; unitName: string };

export type SaleProductSnapshot = {
  avgCost: Prisma.Decimal;
  costPrice: Prisma.Decimal;
  inventoryTracking: string;
  isLotControl: boolean;
};

export const getSaleUnitKey = (productId: string, unitName: string): string =>
  `${productId}::${unitName}`;

export async function preloadSaleDependencies(
  tx: SaleCoreTxClient,
  items: SaleCoreItemInput[],
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
          select: { productId: true, name: true, scale: true },
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
      units.map((unit) => [getSaleUnitKey(unit.productId, unit.name), { scale: Number(unit.scale) }]),
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

export async function resolveSalePaymentMethod(
  tx: SaleCoreTxClient,
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

export async function assertLotBalanceAvailable(
  tx: SaleCoreTxClient,
  productId: string,
  lots: { lotNo: string; qtyInBase: number }[],
): Promise<void> {
  const lotNos = [...new Set(lots.map((lot) => lot.lotNo))];
  if (lotNos.length === 0) return;

  const balances = await tx.lotBalance.findMany({
    where: { productId, lotNo: { in: lotNos } },
    select: { lotNo: true, qtyOnHand: true },
  });

  const balanceMap = new Map(balances.map((balance) => [balance.lotNo, Number(balance.qtyOnHand)]));

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

export async function createWarrantySnapshots(
  tx: SaleCoreTxClient,
  input: {
    saleId: string;
    saleItemId: string;
    productId: string;
    warrantyDays: number;
    docDate: Date;
    itemQty: number;
    lotItems: LotSubRow[];
  },
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
      createdVia: "AUTO_FROM_SALE" as const,
    })),
  });
}
