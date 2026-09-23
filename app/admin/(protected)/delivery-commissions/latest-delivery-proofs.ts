import type { Prisma } from "@/lib/generated/prisma";

export type LatestDeliveryProofRow = { saleId: string; capturedAt: Date };

type RawQueryClient = {
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]): Prisma.PrismaPromise<T>;
};

/**
 * Latest delivery-proof time per sale. Same result as
 * `deliveryProof.findMany({ orderBy: [saleId asc, capturedAt desc], distinct: ["saleId"] })`,
 * but Prisma 7 applies `distinct` in memory after fetching every proof row, so the
 * de-duplication is done in Postgres with DISTINCT ON (uses @@index([saleId, capturedAt])).
 */
export const getLatestDeliveryProofTimes = async (
  client: RawQueryClient,
  saleIds: string[],
): Promise<LatestDeliveryProofRow[]> => {
  if (saleIds.length === 0) return [];
  return client.$queryRaw<LatestDeliveryProofRow[]>`
    SELECT DISTINCT ON ("saleId") "saleId", "capturedAt"
    FROM "DeliveryProof"
    WHERE "saleId" = ANY(${saleIds}::text[])
    ORDER BY "saleId" ASC, "capturedAt" DESC
  `;
};
