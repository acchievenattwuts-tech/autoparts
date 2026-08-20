import { revalidatePath, revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { ProductStorefrontSyncStatus } from "@/lib/generated/prisma";
import { getActiveStorefrontProductById } from "@/lib/storefront-product";
import { formatDateTimeThai } from "@/lib/th-date";
import { getTelegramConfig, sendTelegramMessage } from "@/lib/telegram";

const PRODUCT_TAG_PREFIX = "storefront-product:";
const MAX_SYNC_ATTEMPTS = 3;
const SYNC_BATCH_SIZE = 20;
const STOCK_BATCH_SIZE = 100;
const PROCESSING_LEASE_MS = 5 * 60 * 1_000;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const;

type SyncCandidate = {
  productId: string;
  expectedUpdatedAt: Date;
  canonicalPath: string;
  attempts: number;
  product: {
    code: string;
    isActive: boolean;
    isStorefrontVisible: boolean;
  };
};

const truncateError = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 500);

export function isStorefrontRevisionCurrent(params: {
  shouldBeVisible: boolean;
  expectedUpdatedAt: Date | string;
  observedUpdatedAt: Date | string | null;
}): boolean {
  const { shouldBeVisible, expectedUpdatedAt, observedUpdatedAt } = params;
  if (!shouldBeVisible) return observedUpdatedAt === null;
  if (observedUpdatedAt === null) return false;
  const expectedTime = new Date(expectedUpdatedAt).getTime();
  const observedTime = new Date(observedUpdatedAt).getTime();
  return Number.isFinite(expectedTime) && Number.isFinite(observedTime) && observedTime >= expectedTime;
}

function revisionMatches(candidate: SyncCandidate, observed: { updatedAt: Date } | null): boolean {
  const shouldBeVisible = candidate.product.isActive && candidate.product.isStorefrontVisible;
  return isStorefrontRevisionCurrent({
    shouldBeVisible,
    expectedUpdatedAt: candidate.expectedUpdatedAt,
    observedUpdatedAt: observed?.updatedAt ?? null,
  });
}

export function buildStorefrontSyncFailureTelegramText(params: {
  productCode: string;
  attempts: number;
  at: Date;
  adminLink?: string | null;
}): string {
  const lines = [
    "🔄 ซิงก์ข้อมูลสินค้าหน้าร้านไม่สำเร็จ",
    "━━━━━━━━━━━━━━━",
    `รหัสสินค้า: ${params.productCode}`,
    `ลองตรวจและซ่อมแล้ว: ${params.attempts} ครั้ง`,
    "สถานะ: ตรวจยืนยันข้อมูลล่าสุดไม่สำเร็จหลังระบบลองซ่อม",
    `เวลา: ${formatDateTimeThai(params.at)} น.`,
    "",
    "🟡 ต้องตรวจสอบ",
  ];
  if (params.adminLink) lines.push(`🔗 ดูรายละเอียด: ${params.adminLink}`);
  return lines.join("\n").slice(0, 4096);
}

function resolveAppBaseUrl(): string | null {
  const raw = process.env.APP_BASE_URL ?? process.env.NEXTAUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  return raw?.trim().replace(/\/+$/, "") || null;
}

async function notifyStorefrontSyncFailure(candidate: SyncCandidate, at: Date): Promise<boolean> {
  const config = getTelegramConfig();
  if (!config.botToken || config.chatIds.length === 0) return false;

  const baseUrl = resolveAppBaseUrl();
  const relativeLink = `/admin/products/${candidate.productId}/edit`;
  const text = buildStorefrontSyncFailureTelegramText({
    productCode: candidate.product.code,
    attempts: MAX_SYNC_ATTEMPTS,
    at,
    adminLink: baseUrl ? `${baseUrl}${relativeLink}` : relativeLink,
  });
  for (const chatId of config.chatIds) {
    await sendTelegramMessage({ botToken: config.botToken, chatId, text });
  }
  return true;
}

async function expireProductCache(productId: string, canonicalPath?: string): Promise<void> {
  revalidateTag(`${PRODUCT_TAG_PREFIX}${productId}`, { expire: 0 });
  if (canonicalPath) revalidatePath(canonicalPath);
}

async function drainStockInvalidations(): Promise<number> {
  const rows = await db.productStorefrontStockInvalidation.findMany({
    orderBy: { requestedAt: "asc" },
    take: STOCK_BATCH_SIZE,
  });

  for (const row of rows) {
    await expireProductCache(row.productId);
  }
  if (rows.length > 0) {
    // One batched delete keeps DB round-trips bounded. Each timestamp predicate
    // protects a newer upsert that arrived while its cache tag was processed.
    await db.productStorefrontStockInvalidation.deleteMany({
      where: {
        OR: rows.map((row) => ({
          productId: row.productId,
          requestedAt: { lte: row.requestedAt },
        })),
      },
    });
  }
  return rows.length;
}

async function markFailedAndNotify(candidate: SyncCandidate, error: unknown, now: Date): Promise<boolean> {
  const attempts = candidate.attempts + 1;
  const updated = await db.productStorefrontSyncState.updateMany({
    where: {
      productId: candidate.productId,
      expectedUpdatedAt: candidate.expectedUpdatedAt,
      status: ProductStorefrontSyncStatus.PROCESSING,
    },
    data: {
      status: ProductStorefrontSyncStatus.FAILED,
      attempts,
      failedAt: now,
      lastError: truncateError(error),
    },
  });
  if (updated.count === 0) return false;

  try {
    const sent = await notifyStorefrontSyncFailure(candidate, now);
    if (sent) {
      await db.productStorefrontSyncState.updateMany({
        where: {
          productId: candidate.productId,
          expectedUpdatedAt: candidate.expectedUpdatedAt,
          status: ProductStorefrontSyncStatus.FAILED,
          telegramNotifiedAt: null,
        },
        data: { telegramNotifiedAt: new Date() },
      });
    }
    return sent;
  } catch (notifyError) {
    await db.productStorefrontSyncState.updateMany({
      where: {
        productId: candidate.productId,
        expectedUpdatedAt: candidate.expectedUpdatedAt,
        status: ProductStorefrontSyncStatus.FAILED,
      },
      data: { lastError: `TELEGRAM: ${truncateError(notifyError)}`.slice(0, 500) },
    });
    return false;
  }
}

async function processCandidate(candidate: SyncCandidate): Promise<"verified" | "retrying" | "failed" | "superseded"> {
  const now = new Date();
  const claimed = await db.productStorefrontSyncState.updateMany({
    where: {
      productId: candidate.productId,
      expectedUpdatedAt: candidate.expectedUpdatedAt,
      status: {
        in: [
          ProductStorefrontSyncStatus.PENDING,
          ProductStorefrontSyncStatus.RETRYING,
          ProductStorefrontSyncStatus.PROCESSING,
        ],
      },
      nextAttemptAt: { lte: now },
    },
    data: {
      status: ProductStorefrontSyncStatus.PROCESSING,
      nextAttemptAt: new Date(now.getTime() + PROCESSING_LEASE_MS),
    },
  });
  if (claimed.count === 0) return "superseded";

  try {
    // Repair first, then verify the cached projection. This avoids external page
    // requests while still proving that the Data Cache sees the committed revision.
    await expireProductCache(candidate.productId, candidate.canonicalPath);
    const observed = await getActiveStorefrontProductById(candidate.productId);
    if (revisionMatches(candidate, observed)) {
      const verifiedAt = new Date();
      const updated = await db.productStorefrontSyncState.updateMany({
        where: {
          productId: candidate.productId,
          expectedUpdatedAt: candidate.expectedUpdatedAt,
          status: ProductStorefrontSyncStatus.PROCESSING,
        },
        data: {
          status: ProductStorefrontSyncStatus.VERIFIED,
          attempts: candidate.attempts + 1,
          lastObservedUpdatedAt: observed?.updatedAt ?? null,
          lastError: null,
          verifiedAt,
          nextAttemptAt: verifiedAt,
        },
      });
      return updated.count === 1 ? "verified" : "superseded";
    }

    const mismatch = new Error("STOREFRONT_CACHE_REVISION_MISMATCH");
    const attempts = candidate.attempts + 1;
    if (attempts >= MAX_SYNC_ATTEMPTS) {
      await markFailedAndNotify(candidate, mismatch, new Date());
      return "failed";
    }

    const retryAt = new Date(Date.now() + (RETRY_DELAYS_MS[attempts - 1] ?? RETRY_DELAYS_MS.at(-1)!));
    const updated = await db.productStorefrontSyncState.updateMany({
      where: {
        productId: candidate.productId,
        expectedUpdatedAt: candidate.expectedUpdatedAt,
        status: ProductStorefrontSyncStatus.PROCESSING,
      },
      data: {
        status: ProductStorefrontSyncStatus.RETRYING,
        attempts,
        nextAttemptAt: retryAt,
        lastObservedUpdatedAt: observed?.updatedAt ?? null,
        lastError: mismatch.message,
      },
    });
    return updated.count === 1 ? "retrying" : "superseded";
  } catch (error) {
    const attempts = candidate.attempts + 1;
    if (attempts >= MAX_SYNC_ATTEMPTS) {
      await markFailedAndNotify(candidate, error, new Date());
      return "failed";
    }
    const retryAt = new Date(Date.now() + (RETRY_DELAYS_MS[attempts - 1] ?? RETRY_DELAYS_MS.at(-1)!));
    const updated = await db.productStorefrontSyncState.updateMany({
      where: {
        productId: candidate.productId,
        expectedUpdatedAt: candidate.expectedUpdatedAt,
        status: ProductStorefrontSyncStatus.PROCESSING,
      },
      data: {
        status: ProductStorefrontSyncStatus.RETRYING,
        attempts,
        nextAttemptAt: retryAt,
        lastError: truncateError(error),
      },
    });
    return updated.count === 1 ? "retrying" : "superseded";
  }
}

async function retryUnsentFailureNotifications(): Promise<number> {
  const failed = await db.productStorefrontSyncState.findMany({
    where: { status: ProductStorefrontSyncStatus.FAILED, telegramNotifiedAt: null },
    include: { product: { select: { code: true, isActive: true, isStorefrontVisible: true } } },
    take: 10,
  });
  let sentCount = 0;
  for (const row of failed) {
    try {
      if (await notifyStorefrontSyncFailure(row, new Date())) {
        const updated = await db.productStorefrontSyncState.updateMany({
          where: { productId: row.productId, expectedUpdatedAt: row.expectedUpdatedAt, telegramNotifiedAt: null },
          data: { telegramNotifiedAt: new Date() },
        });
        sentCount += updated.count;
      }
    } catch {
      // Keep telegramNotifiedAt null; the next cron run retries the existing channel.
    }
  }
  return sentCount;
}

export async function processStorefrontSyncQueue(): Promise<{
  stockInvalidated: number;
  verified: number;
  retrying: number;
  failed: number;
  telegramSent: number;
}> {
  const stockInvalidated = await drainStockInvalidations();
  const now = new Date();
  const candidates = await db.productStorefrontSyncState.findMany({
    where: {
      status: {
        in: [
          ProductStorefrontSyncStatus.PENDING,
          ProductStorefrontSyncStatus.RETRYING,
          ProductStorefrontSyncStatus.PROCESSING,
        ],
      },
      nextAttemptAt: { lte: now },
    },
    include: { product: { select: { code: true, isActive: true, isStorefrontVisible: true } } },
    orderBy: { nextAttemptAt: "asc" },
    take: SYNC_BATCH_SIZE,
  });

  const counts = { verified: 0, retrying: 0, failed: 0 };
  for (const candidate of candidates) {
    const result = await processCandidate(candidate);
    if (result === "verified" || result === "retrying" || result === "failed") counts[result] += 1;
  }
  const telegramSent = await retryUnsentFailureNotifications();
  return { stockInvalidated, ...counts, telegramSent };
}
