import type { Prisma } from "@/lib/generated/prisma";
import { ProductStorefrontSyncStatus } from "@/lib/generated/prisma";
import { getProductPath } from "@/lib/product-slug";

type ProductRevision = {
  id: string;
  code: string;
  name: string;
  slug: string | null;
  updatedAt: Date;
};

export function getProductStorefrontPath(product: ProductRevision): string {
  return getProductPath({ category: "products", product });
}

/**
 * Records the latest product-master revision in the same transaction as the
 * mutation. Upsert coalesces repeated saves and also safely re-opens a previous
 * VERIFIED/FAILED state.
 */
export async function enqueueProductStorefrontSync(
  tx: Prisma.TransactionClient,
  product: ProductRevision,
): Promise<void> {
  await tx.productStorefrontSyncState.upsert({
    where: { productId: product.id },
    create: {
      productId: product.id,
      expectedUpdatedAt: product.updatedAt,
      canonicalPath: getProductStorefrontPath(product),
    },
    update: {
      expectedUpdatedAt: product.updatedAt,
      canonicalPath: getProductStorefrontPath(product),
      status: ProductStorefrontSyncStatus.PENDING,
      attempts: 0,
      nextAttemptAt: new Date(),
      lastObservedUpdatedAt: null,
      lastError: null,
      verifiedAt: null,
      failedAt: null,
      telegramNotifiedAt: null,
    },
  });
}

/** Coalescing transactional outbox used by every stock-card mutation. */
export async function enqueueStorefrontStockInvalidation(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<void> {
  await tx.productStorefrontStockInvalidation.upsert({
    where: { productId },
    create: { productId },
    update: { requestedAt: new Date() },
  });
}

export async function enqueueStorefrontStockInvalidations(
  tx: Prisma.TransactionClient,
  productIdsInput: Iterable<string>,
): Promise<void> {
  const productIds = [...new Set([...productIdsInput].filter(Boolean))];
  if (productIds.length === 0) return;
  const requestedAt = new Date();
  await tx.productStorefrontStockInvalidation.createMany({
    data: productIds.map((productId) => ({ productId, requestedAt })),
    skipDuplicates: true,
  });
  await tx.productStorefrontStockInvalidation.updateMany({
    where: { productId: { in: productIds } },
    data: { requestedAt },
  });
}
