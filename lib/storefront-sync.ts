import { revalidatePath, revalidateTag } from "next/cache";
import { db } from "@/lib/db";
import { ProductStorefrontSyncStatus, type Prisma } from "@/lib/generated/prisma";
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
  repairCount: number;
  product: {
    code: string;
    stock: number;
    isActive: boolean;
    isStorefrontVisible: boolean;
  };
};

type StorefrontCacheSnapshot = {
  updatedAt: Date | string;
  stock: number;
};

export type StorefrontMismatchReason =
  | "VISIBLE_PRODUCT_CACHE_MISSING"
  | "EXPECTED_HIDDEN_CACHE_PRESENT"
  | "CACHED_REVISION_INVALID"
  | "CACHED_REVISION_BEHIND"
  | "CACHED_STOCK_MISMATCH";

type AuditExpected = {
  shouldBeVisible: boolean;
  updatedAt: Date | string;
  stock: number;
};

export type StorefrontCacheAuditResult = {
  outcome: "current" | "repaired" | "mismatch" | "error";
  initialObserved: StorefrontCacheSnapshot | null | undefined;
  finalObserved: StorefrontCacheSnapshot | null | undefined;
  initialMismatchReason: StorefrontMismatchReason | null;
  finalMismatchReason: StorefrontMismatchReason | null;
  mismatchDetectedAt: Date | null;
  didExpire: boolean;
  error?: unknown;
  errorPhase?: "INITIAL_READ" | "EXPIRE" | "VERIFICATION_READ";
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

export function getStorefrontMismatchReason(
  expected: AuditExpected,
  observed: StorefrontCacheSnapshot | null,
): StorefrontMismatchReason | null {
  if (!expected.shouldBeVisible) {
    return observed === null ? null : "EXPECTED_HIDDEN_CACHE_PRESENT";
  }
  if (observed === null) return "VISIBLE_PRODUCT_CACHE_MISSING";

  const expectedTime = new Date(expected.updatedAt).getTime();
  const observedTime = new Date(observed.updatedAt).getTime();
  if (!Number.isFinite(expectedTime) || !Number.isFinite(observedTime)) return "CACHED_REVISION_INVALID";
  if (observedTime < expectedTime) return "CACHED_REVISION_BEHIND";
  if (observed.stock !== expected.stock) return "CACHED_STOCK_MISMATCH";
  return null;
}

/**
 * Reads before invalidating. An initial read error deliberately returns without
 * expiring anything, preserving the last usable storefront cache.
 */
export async function auditThenRepairStorefrontCache(params: {
  expected: AuditExpected;
  readCache: () => Promise<StorefrontCacheSnapshot | null>;
  expireCache: () => Promise<void>;
  now?: () => Date;
}): Promise<StorefrontCacheAuditResult> {
  let initialObserved: StorefrontCacheSnapshot | null;
  try {
    initialObserved = await params.readCache();
  } catch (error) {
    return {
      outcome: "error",
      initialObserved: undefined,
      finalObserved: undefined,
      initialMismatchReason: null,
      finalMismatchReason: null,
      mismatchDetectedAt: null,
      didExpire: false,
      error,
      errorPhase: "INITIAL_READ",
    };
  }

  const initialMismatchReason = getStorefrontMismatchReason(params.expected, initialObserved);
  if (!initialMismatchReason) {
    return {
      outcome: "current",
      initialObserved,
      finalObserved: initialObserved,
      initialMismatchReason: null,
      finalMismatchReason: null,
      mismatchDetectedAt: null,
      didExpire: false,
    };
  }

  const mismatchDetectedAt = (params.now ?? (() => new Date()))();
  try {
    await params.expireCache();
  } catch (error) {
    return {
      outcome: "error",
      initialObserved,
      finalObserved: undefined,
      initialMismatchReason,
      finalMismatchReason: null,
      mismatchDetectedAt,
      didExpire: false,
      error,
      errorPhase: "EXPIRE",
    };
  }

  let finalObserved: StorefrontCacheSnapshot | null;
  try {
    finalObserved = await params.readCache();
  } catch (error) {
    return {
      outcome: "error",
      initialObserved,
      finalObserved: undefined,
      initialMismatchReason,
      finalMismatchReason: null,
      mismatchDetectedAt,
      didExpire: true,
      error,
      errorPhase: "VERIFICATION_READ",
    };
  }

  const finalMismatchReason = getStorefrontMismatchReason(params.expected, finalObserved);
  return {
    outcome: finalMismatchReason ? "mismatch" : "repaired",
    initialObserved,
    finalObserved,
    initialMismatchReason,
    finalMismatchReason,
    mismatchDetectedAt,
    didExpire: true,
  };
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

function validDateOrNull(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function buildAuditEvidence(
  candidate: SyncCandidate,
  audit: StorefrontCacheAuditResult,
): Prisma.ProductStorefrontSyncStateUpdateManyMutationInput {
  const lastObserved = audit.finalObserved !== undefined ? audit.finalObserved : audit.initialObserved;
  const data: Prisma.ProductStorefrontSyncStateUpdateManyMutationInput = {
    expectedStockAtAudit: candidate.product.stock,
    lastObservedUpdatedAt: validDateOrNull(lastObserved?.updatedAt),
    repairCount: candidate.repairCount + (audit.didExpire ? 1 : 0),
  };
  if (audit.initialObserved !== undefined) {
    data.initialObservedAt = validDateOrNull(audit.initialObserved?.updatedAt);
    data.initialObservedStock = audit.initialObserved?.stock ?? null;
  }
  if (audit.initialMismatchReason) {
    data.mismatchDetectedAt = audit.mismatchDetectedAt;
    data.mismatchReason = audit.initialMismatchReason;
  }
  return data;
}

async function markFailedAndNotify(
  candidate: SyncCandidate,
  error: unknown,
  now: Date,
  auditEvidence: Prisma.ProductStorefrontSyncStateUpdateManyMutationInput,
): Promise<boolean> {
  const attempts = candidate.attempts + 1;
  const updated = await db.productStorefrontSyncState.updateMany({
    where: {
      productId: candidate.productId,
      expectedUpdatedAt: candidate.expectedUpdatedAt,
      status: ProductStorefrontSyncStatus.PROCESSING,
    },
    data: {
      ...auditEvidence,
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

async function processCandidate(
  candidate: SyncCandidate,
): Promise<"current" | "repaired" | "retrying" | "failed" | "superseded"> {
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

  const audit = await auditThenRepairStorefrontCache({
    expected: {
      shouldBeVisible: candidate.product.isActive && candidate.product.isStorefrontVisible,
      updatedAt: candidate.expectedUpdatedAt,
      stock: candidate.product.stock,
    },
    readCache: () => getActiveStorefrontProductById(candidate.productId),
    expireCache: () => expireProductCache(candidate.productId, candidate.canonicalPath),
  });
  const auditEvidence = buildAuditEvidence(candidate, audit);
  const attempts = candidate.attempts + 1;

  if (audit.outcome === "current" || audit.outcome === "repaired") {
    const verifiedAt = new Date();
    const updated = await db.productStorefrontSyncState.updateMany({
      where: {
        productId: candidate.productId,
        expectedUpdatedAt: candidate.expectedUpdatedAt,
        status: ProductStorefrontSyncStatus.PROCESSING,
      },
      data: {
        ...auditEvidence,
        status: ProductStorefrontSyncStatus.VERIFIED,
        attempts,
        lastError: null,
        verifiedAt,
        nextAttemptAt: verifiedAt,
      },
    });
    return updated.count === 1 ? audit.outcome : "superseded";
  }

  const failure = audit.outcome === "mismatch"
    ? new Error(`STOREFRONT_CACHE_${audit.finalMismatchReason ?? "MISMATCH"}`)
    : new Error(`${audit.errorPhase ?? "AUDIT"}: ${truncateError(audit.error)}`);
  if (attempts >= MAX_SYNC_ATTEMPTS) {
    await markFailedAndNotify(candidate, failure, new Date(), auditEvidence);
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
      ...auditEvidence,
      status: ProductStorefrontSyncStatus.RETRYING,
      attempts,
      nextAttemptAt: retryAt,
      lastError: failure.message.slice(0, 500),
    },
  });
  return updated.count === 1 ? "retrying" : "superseded";
}

async function retryUnsentFailureNotifications(): Promise<number> {
  const failed = await db.productStorefrontSyncState.findMany({
    where: { status: ProductStorefrontSyncStatus.FAILED, telegramNotifiedAt: null },
    include: { product: { select: { code: true, stock: true, isActive: true, isStorefrontVisible: true } } },
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
  current: number;
  repaired: number;
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
    include: { product: { select: { code: true, stock: true, isActive: true, isStorefrontVisible: true } } },
    orderBy: { nextAttemptAt: "asc" },
    take: SYNC_BATCH_SIZE,
  });

  const counts = { current: 0, repaired: 0, retrying: 0, failed: 0 };
  for (const candidate of candidates) {
    const result = await processCandidate(candidate);
    if (result === "current" || result === "repaired" || result === "retrying" || result === "failed") {
      counts[result] += 1;
    }
  }
  const telegramSent = await retryUnsentFailureNotifications();
  return { stockInvalidated, verified: counts.current + counts.repaired, ...counts, telegramSent };
}
