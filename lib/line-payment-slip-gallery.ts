import { db } from "@/lib/db";
import { Prisma, PaymentSlipVerificationStatus } from "@/lib/generated/prisma";
import {
  createPaymentSlipSignedUrlsBatch,
  GALLERY_SIGNED_URL_REFRESH_BUFFER_MS,
  GALLERY_SIGNED_URL_TTL_SECONDS,
} from "@/lib/line-payment-slip-storage";
import { isDateOnlyString, parseDateOnlyToEndOfDay, parseDateOnlyToStartOfDay } from "@/lib/th-date";

/**
 * Read model for the payment-slip gallery (browse many slips by date/status/bank).
 * Slips are PII, so this is view-only — it never confirms a payment or touches
 * receipts/AR/stock. Image URLs are short-lived signed URLs cached in the DB to
 * keep Supabase Storage calls near zero per page render.
 */

export const GALLERY_PAGE_SIZE = 60;

export type PaymentSlipGalleryFilters = {
  from?: string | null; // YYYY-MM-DD (effective date: transfer date, else received date)
  to?: string | null; // YYYY-MM-DD
  status?: PaymentSlipVerificationStatus | null;
  bank?: string | null;
  sender?: string | null;
  /** Substring match on the slip's reference number. */
  reference?: string | null;
  /** Exact match on the detected transfer amount (baht). */
  amount?: number | null;
};

/** Plain serializable item sent to the client gallery/lightbox. */
export type PaymentSlipGalleryItem = {
  id: string;
  imageUrl: string | null;
  amount: number | null;
  /** ISO string of the effective date (transfer date, else received date). */
  effectiveDate: string;
  /** True when OCR had no transfer date and the system received-date was used. */
  usedFallbackDate: boolean;
  bank: string | null;
  senderName: string | null;
  status: PaymentSlipVerificationStatus;
  customerName: string | null;
};

export type PaymentSlipGalleryPage = {
  items: PaymentSlipGalleryItem[];
  hasMore: boolean;
  nextSkip: number;
};

const VALID_STATUSES = new Set<string>(Object.values(PaymentSlipVerificationStatus));

/** Narrows an arbitrary string to a valid verification status (else null). */
export function normalizeGalleryStatus(value?: string | null): PaymentSlipVerificationStatus | null {
  return value && VALID_STATUSES.has(value) ? (value as PaymentSlipVerificationStatus) : null;
}

function buildGalleryWhere(filters: PaymentSlipGalleryFilters): Prisma.PaymentSlipWhereInput {
  const and: Prisma.PaymentSlipWhereInput[] = [];

  const from = filters.from && isDateOnlyString(filters.from) ? parseDateOnlyToStartOfDay(filters.from) : null;
  const to = filters.to && isDateOnlyString(filters.to) ? parseDateOnlyToEndOfDay(filters.to) : null;
  if (from || to) {
    const range: Prisma.DateTimeFilter = {};
    if (from) range.gte = from;
    if (to) range.lte = to;
    // Effective date = transfer date when present, else the received (createdAt) date.
    and.push({
      OR: [{ detectedTransferDatetime: range }, { detectedTransferDatetime: null, createdAt: range }],
    });
  }

  const status = normalizeGalleryStatus(filters.status);
  if (status) and.push({ verificationStatus: status });

  if (filters.bank?.trim()) and.push({ detectedBank: filters.bank.trim() });

  if (filters.sender?.trim()) {
    and.push({ detectedSenderName: { contains: filters.sender.trim(), mode: "insensitive" } });
  }

  if (filters.reference?.trim()) {
    and.push({ detectedReferenceNo: { contains: filters.reference.trim(), mode: "insensitive" } });
  }

  if (typeof filters.amount === "number" && Number.isFinite(filters.amount)) {
    and.push({ detectedAmount: filters.amount });
  }

  return and.length > 0 ? { AND: and } : {};
}

type GalleryRow = {
  id: string;
  imageUrl: string | null;
  imageSignedUrl: string | null;
  imageSignedUrlExpiresAt: Date | null;
  detectedAmount: Prisma.Decimal | null;
  detectedTransferDatetime: Date | null;
  detectedBank: string | null;
  detectedSenderName: string | null;
  verificationStatus: PaymentSlipVerificationStatus;
  createdAt: Date;
  conversation: { displayName: string | null; customer: { name: string } | null } | null;
};

/**
 * Resolves each row's viewable image URL, refreshing the cached signed URL in
 * batch (one Supabase call) only for rows whose cache is missing or near expiry,
 * then persisting the refreshed URLs so later renders are zero-call.
 */
async function resolveGalleryImageUrls(rows: GalleryRow[]): Promise<Map<string, string | null>> {
  const now = Date.now();
  const refreshThreshold = new Date(now + GALLERY_SIGNED_URL_REFRESH_BUFFER_MS);

  const needsRefresh = rows.filter(
    (row) =>
      row.imageUrl &&
      (!row.imageSignedUrl ||
        !row.imageSignedUrlExpiresAt ||
        row.imageSignedUrlExpiresAt <= refreshThreshold),
  );

  let freshByPath = new Map<string, string>();
  if (needsRefresh.length > 0) {
    const paths = needsRefresh.map((row) => row.imageUrl as string);
    freshByPath = await createPaymentSlipSignedUrlsBatch(paths, GALLERY_SIGNED_URL_TTL_SECONDS);

    if (freshByPath.size > 0) {
      const newExpiresAt = new Date(now + GALLERY_SIGNED_URL_TTL_SECONDS * 1000);
      await Promise.all(
        needsRefresh
          .filter((row) => freshByPath.has(row.imageUrl as string))
          .map((row) =>
            db.paymentSlip
              .update({
                where: { id: row.id },
                data: {
                  imageSignedUrl: freshByPath.get(row.imageUrl as string),
                  imageSignedUrlExpiresAt: newExpiresAt,
                },
                select: { id: true },
              })
              .catch(() => null),
          ),
      );
    }
  }

  const resolved = new Map<string, string | null>();
  for (const row of rows) {
    if (!row.imageUrl) {
      resolved.set(row.id, null);
      continue;
    }
    resolved.set(row.id, freshByPath.get(row.imageUrl) ?? row.imageSignedUrl ?? null);
  }
  return resolved;
}

function toGalleryItem(row: GalleryRow, resolvedImageUrl: string | null): PaymentSlipGalleryItem {
  const usedFallbackDate = row.detectedTransferDatetime === null;
  const effective = row.detectedTransferDatetime ?? row.createdAt;
  return {
    id: row.id,
    imageUrl: resolvedImageUrl,
    amount: row.detectedAmount !== null ? Number(row.detectedAmount.toString()) : null,
    effectiveDate: effective.toISOString(),
    usedFallbackDate,
    bank: row.detectedBank,
    senderName: row.detectedSenderName,
    status: row.verificationStatus,
    customerName: row.conversation?.customer?.name ?? row.conversation?.displayName ?? null,
  };
}

/**
 * Fetches one page of gallery slips (newest received first). Fetches one extra row
 * to determine `hasMore` without a second count query.
 */
export async function fetchPaymentSlipGalleryPage(
  filters: PaymentSlipGalleryFilters,
  skip: number,
): Promise<PaymentSlipGalleryPage> {
  const safeSkip = Number.isFinite(skip) && skip > 0 ? Math.trunc(skip) : 0;
  const rows = (await db.paymentSlip.findMany({
    where: buildGalleryWhere(filters),
    select: {
      id: true,
      imageUrl: true,
      imageSignedUrl: true,
      imageSignedUrlExpiresAt: true,
      detectedAmount: true,
      detectedTransferDatetime: true,
      detectedBank: true,
      detectedSenderName: true,
      verificationStatus: true,
      createdAt: true,
      conversation: { select: { displayName: true, customer: { select: { name: true } } } },
    },
    orderBy: { createdAt: "desc" },
    skip: safeSkip,
    take: GALLERY_PAGE_SIZE + 1,
  })) as GalleryRow[];

  const hasMore = rows.length > GALLERY_PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, GALLERY_PAGE_SIZE) : rows;

  const resolved = await resolveGalleryImageUrls(pageRows);
  const items = pageRows.map((row) => toGalleryItem(row, resolved.get(row.id) ?? null));

  return { items, hasMore, nextSkip: safeSkip + pageRows.length };
}

export type PaymentSlipGallerySummary = {
  count: number;
  totalAmount: number;
};

/** Count + summed amount for the current filter (shown above the grid). */
export async function getPaymentSlipGallerySummary(
  filters: PaymentSlipGalleryFilters,
): Promise<PaymentSlipGallerySummary> {
  const aggregate = await db.paymentSlip.aggregate({
    where: buildGalleryWhere(filters),
    _count: { _all: true },
    _sum: { detectedAmount: true },
  });
  return {
    count: aggregate._count._all,
    totalAmount: aggregate._sum.detectedAmount !== null ? Number(aggregate._sum.detectedAmount.toString()) : 0,
  };
}

/** Distinct banks detected across slips, for the bank filter dropdown. */
export async function listPaymentSlipBanks(): Promise<string[]> {
  const rows = await db.paymentSlip.findMany({
    where: { detectedBank: { not: null } },
    select: { detectedBank: true },
    distinct: ["detectedBank"],
    orderBy: { detectedBank: "asc" },
    take: 50,
  });
  return rows.map((row) => row.detectedBank).filter((bank): bank is string => Boolean(bank));
}
