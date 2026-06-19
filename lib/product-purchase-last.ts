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
  $executeRaw: (query: Prisma.Sql) => Promise<number>;
};

function safeSqlNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

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

  // Apply every product in ONE bulk UPDATE instead of one round-trip per id.
  // Values match the per-row update exactly: products with a snapshot get
  // price/date/unit set; products without get price/date nulled and unit left
  // unchanged (COALESCE keeps the existing value when NULL is supplied).
  const values = Prisma.join(
    productIds.map((productId) => {
      const snapshot = snapshotByProduct.get(productId);
      const price = snapshot
        ? Prisma.sql`${safeSqlNumber(snapshot.purchaseLastPrice)}::numeric`
        : Prisma.sql`NULL::numeric`;
      const date = snapshot
        ? Prisma.sql`${snapshot.purchaseLastDate.toISOString()}::timestamptz`
        : Prisma.sql`NULL::timestamptz`;
      const unit = snapshot
        ? Prisma.sql`${snapshot.purchaseUnitName}::text`
        : Prisma.sql`NULL::text`;
      return Prisma.sql`(${productId}, ${price}, ${date}, ${unit})`;
    }),
  );
  await tx.$executeRaw(Prisma.sql`
    UPDATE "Product" AS p
    SET
      "purchaseLastPrice" = d."purchaseLastPrice",
      "purchaseLastDate" = d."purchaseLastDate",
      "purchaseUnitName" = COALESCE(d."purchaseUnitName", p."purchaseUnitName")
    FROM (VALUES ${values}) AS d("id","purchaseLastPrice","purchaseLastDate","purchaseUnitName")
    WHERE p."id" = d."id"
  `);
}
