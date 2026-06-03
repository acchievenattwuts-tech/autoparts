import { Prisma } from "@/lib/generated/prisma";

export type ProductPurchaseLastCandidate = {
  productId: string;
  purchaseDate: Date;
  purchaseNo: string;
  lineNo: number;
  id: string;
  costPrice: number;
  showPricePerUnit: number | null;
  showUnitName: string | null;
  productPurchaseUnitName: string;
};

export type ProductPurchaseLastSnapshot = {
  productId: string;
  purchaseLastPrice: number;
  purchaseLastDate: Date;
  purchaseUnitName: string;
};

function compareLatestPurchaseCandidate(
  a: ProductPurchaseLastCandidate,
  b: ProductPurchaseLastCandidate,
): number {
  const dateDiff = a.purchaseDate.getTime() - b.purchaseDate.getTime();
  if (dateDiff !== 0) return dateDiff;

  const purchaseNoDiff = a.purchaseNo.localeCompare(b.purchaseNo);
  if (purchaseNoDiff !== 0) return purchaseNoDiff;

  const lineNoDiff = a.lineNo - b.lineNo;
  if (lineNoDiff !== 0) return lineNoDiff;

  return a.id.localeCompare(b.id);
}

export function buildProductPurchaseLastSnapshots(
  candidates: ProductPurchaseLastCandidate[],
): ProductPurchaseLastSnapshot[] {
  const latestByProduct = new Map<string, ProductPurchaseLastCandidate>();

  for (const candidate of candidates) {
    const current = latestByProduct.get(candidate.productId);
    if (!current || compareLatestPurchaseCandidate(candidate, current) > 0) {
      latestByProduct.set(candidate.productId, candidate);
    }
  }

  return [...latestByProduct.values()].map((candidate) => ({
    productId: candidate.productId,
    purchaseLastPrice: candidate.showPricePerUnit ?? candidate.costPrice,
    purchaseLastDate: candidate.purchaseDate,
    purchaseUnitName: candidate.showUnitName ?? candidate.productPurchaseUnitName,
  }));
}

type PurchaseLastTxClient = {
  purchaseItem: {
    findMany: (args: {
      where: {
        productId: { in: string[] };
        purchase: { status: "ACTIVE" };
      };
      orderBy: Array<
        | { productId: "asc" }
        | { purchase: { purchaseDate: "desc" } }
        | { purchase: { purchaseNo: "desc" } }
        | { lineNo: "desc" }
        | { id: "desc" }
      >;
      select: {
        id: true;
        productId: true;
        lineNo: true;
        costPrice: true;
        showPricePerUnit: true;
        showUnitName: true;
        purchase: { select: { purchaseDate: true; purchaseNo: true } };
        product: { select: { purchaseUnitName: true } };
      };
    }) => Promise<
      Array<{
        id: string;
        productId: string;
        lineNo: number;
        costPrice: Prisma.Decimal;
        showPricePerUnit: Prisma.Decimal | null;
        showUnitName: string | null;
        purchase: { purchaseDate: Date; purchaseNo: string };
        product: { purchaseUnitName: string };
      }>
    >;
  };
  product: {
    update: (args: {
      where: { id: string };
      data: {
        purchaseLastPrice?: Prisma.Decimal | null;
        purchaseLastDate?: Date | null;
        purchaseUnitName?: string;
      };
    }) => Promise<unknown>;
  };
};

export async function refreshProductPurchaseLastFields(
  tx: PurchaseLastTxClient,
  productIdsInput: Iterable<string>,
): Promise<void> {
  const productIds = [...new Set([...productIdsInput].filter(Boolean))];
  if (productIds.length === 0) return;

  const rows = await tx.purchaseItem.findMany({
    where: {
      productId: { in: productIds },
      purchase: { status: "ACTIVE" },
    },
    orderBy: [
      { productId: "asc" },
      { purchase: { purchaseDate: "desc" } },
      { purchase: { purchaseNo: "desc" } },
      { lineNo: "desc" },
      { id: "desc" },
    ],
    select: {
      id: true,
      productId: true,
      lineNo: true,
      costPrice: true,
      showPricePerUnit: true,
      showUnitName: true,
      purchase: { select: { purchaseDate: true, purchaseNo: true } },
      product: { select: { purchaseUnitName: true } },
    },
  });

  const snapshots = buildProductPurchaseLastSnapshots(
    rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      purchaseDate: row.purchase.purchaseDate,
      purchaseNo: row.purchase.purchaseNo,
      lineNo: row.lineNo,
      costPrice: Number(row.costPrice),
      showPricePerUnit: row.showPricePerUnit == null ? null : Number(row.showPricePerUnit),
      showUnitName: row.showUnitName,
      productPurchaseUnitName: row.product.purchaseUnitName,
    })),
  );
  const snapshotByProduct = new Map(snapshots.map((snapshot) => [snapshot.productId, snapshot]));

  for (const productId of productIds) {
    const snapshot = snapshotByProduct.get(productId);
    await tx.product.update({
      where: { id: productId },
      data: snapshot
        ? {
            purchaseLastPrice: new Prisma.Decimal(snapshot.purchaseLastPrice),
            purchaseLastDate: snapshot.purchaseLastDate,
            purchaseUnitName: snapshot.purchaseUnitName,
          }
        : {
            purchaseLastPrice: null,
            purchaseLastDate: null,
          },
    });
  }
}
