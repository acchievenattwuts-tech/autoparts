import { db } from "@/lib/db";
import { PaymentSlipVerificationStatus } from "@/lib/generated/prisma";
import { parseDateOnlyToEndOfDay, parseDateOnlyToStartOfDay } from "@/lib/th-date";

/**
 * Reviewer productivity stats for LINE payment slips (read-only). Aggregates slips
 * an admin has acted on (reviewedById set, reviewedAt in range): how many they
 * reviewed, the outcome breakdown, and the average time from slip arrival
 * (createdAt) to decision (reviewedAt). Never mutates anything.
 */

export type ReviewerStatsRow = {
  reviewerId: string;
  reviewerName: string;
  total: number;
  confirmed: number;
  rejected: number;
  needsMoreInfo: number;
  other: number;
  /** Average (reviewedAt − createdAt) across this reviewer's slips, in minutes. */
  avgReviewMinutes: number | null;
};

export type ReviewerStatsTotals = {
  total: number;
  confirmed: number;
  rejected: number;
  needsMoreInfo: number;
  other: number;
};

export type ReviewerStatsReport = {
  rows: ReviewerStatsRow[]; // most slips reviewed first
  totals: ReviewerStatsTotals;
};

type ReviewerAccumulator = {
  reviewerId: string;
  reviewerName: string;
  total: number;
  confirmed: number;
  rejected: number;
  needsMoreInfo: number;
  other: number;
  reviewMinutesSum: number;
  reviewMinutesCount: number;
};

export async function getPaymentSlipReviewerStats(input: {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}): Promise<ReviewerStatsReport> {
  const fromDate = parseDateOnlyToStartOfDay(input.from);
  const toDate = parseDateOnlyToEndOfDay(input.to);

  const slips = await db.paymentSlip.findMany({
    where: {
      reviewedById: { not: null },
      reviewedAt: { gte: fromDate, lte: toDate },
    },
    select: {
      reviewedById: true,
      verificationStatus: true,
      createdAt: true,
      reviewedAt: true,
      reviewedBy: { select: { name: true } },
    },
  });

  const byReviewer = new Map<string, ReviewerAccumulator>();

  for (const slip of slips) {
    if (!slip.reviewedById) continue;
    const existing = byReviewer.get(slip.reviewedById);
    const acc: ReviewerAccumulator =
      existing ?? {
        reviewerId: slip.reviewedById,
        reviewerName: slip.reviewedBy?.name ?? "ไม่ทราบผู้ตรวจ",
        total: 0,
        confirmed: 0,
        rejected: 0,
        needsMoreInfo: 0,
        other: 0,
        reviewMinutesSum: 0,
        reviewMinutesCount: 0,
      };
    if (!existing) byReviewer.set(slip.reviewedById, acc);

    acc.total += 1;
    switch (slip.verificationStatus) {
      case PaymentSlipVerificationStatus.CONFIRMED_BY_ADMIN:
        acc.confirmed += 1;
        break;
      case PaymentSlipVerificationStatus.REJECTED:
        acc.rejected += 1;
        break;
      case PaymentSlipVerificationStatus.NEEDS_MORE_INFO:
        acc.needsMoreInfo += 1;
        break;
      default:
        acc.other += 1;
        break;
    }

    if (slip.reviewedAt) {
      const minutes = (slip.reviewedAt.getTime() - slip.createdAt.getTime()) / 60_000;
      if (Number.isFinite(minutes) && minutes >= 0) {
        acc.reviewMinutesSum += minutes;
        acc.reviewMinutesCount += 1;
      }
    }
  }

  const rows: ReviewerStatsRow[] = Array.from(byReviewer.values())
    .map((acc) => ({
      reviewerId: acc.reviewerId,
      reviewerName: acc.reviewerName,
      total: acc.total,
      confirmed: acc.confirmed,
      rejected: acc.rejected,
      needsMoreInfo: acc.needsMoreInfo,
      other: acc.other,
      avgReviewMinutes:
        acc.reviewMinutesCount > 0 ? acc.reviewMinutesSum / acc.reviewMinutesCount : null,
    }))
    .sort((a, b) => b.total - a.total);

  const totals: ReviewerStatsTotals = rows.reduce<ReviewerStatsTotals>(
    (acc, row) => ({
      total: acc.total + row.total,
      confirmed: acc.confirmed + row.confirmed,
      rejected: acc.rejected + row.rejected,
      needsMoreInfo: acc.needsMoreInfo + row.needsMoreInfo,
      other: acc.other + row.other,
    }),
    { total: 0, confirmed: 0, rejected: 0, needsMoreInfo: 0, other: 0 },
  );

  return { rows, totals };
}
