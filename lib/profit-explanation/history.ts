import { createHash } from "node:crypto";

import { db } from "@/lib/db";
import { Prisma, ProfitExplanationStatus } from "@/lib/generated/prisma";
import type { ProfitRevenueBasis } from "@/lib/profit-dashboard";
import {
  PROFIT_EXPLANATION_PROMPT_VERSION,
  PROFIT_EXPLANATION_RETENTION_DAYS,
  type ProfitExplanationEvidence,
  type ProfitExplanationResult,
} from "@/lib/profit-explanation/schema";

type ProfitExplanationFilterInput = {
  from: string;
  to: string;
  basis: ProfitRevenueBasis;
};

export function buildProfitExplanationFilterHash(input: ProfitExplanationFilterInput): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        basis: input.basis,
        from: input.from,
        promptVersion: PROFIT_EXPLANATION_PROMPT_VERSION,
        to: input.to,
      }),
    )
    .digest("hex");
}

export function buildProfitExplanationExpiresAt(now = new Date()): Date {
  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + PROFIT_EXPLANATION_RETENTION_DAYS);
  return expiresAt;
}

export async function pruneExpiredProfitExplanationHistory(now = new Date()): Promise<number> {
  const deleted = await db.profitExplanationHistory.deleteMany({
    where: {
      expiresAt: {
        lt: now,
      },
    },
  });
  return deleted.count;
}

export async function createProfitExplanationHistory(input: {
  filters: ProfitExplanationFilterInput;
  requestedById?: string | null;
  evidence: ProfitExplanationEvidence;
  result?: ProfitExplanationResult | null;
  keyRef?: string | null;
  status?: ProfitExplanationStatus;
  errorCode?: string | null;
  errorMessage?: string | null;
  now?: Date;
}): Promise<{ id: string }> {
  const record = await db.profitExplanationHistory.create({
    data: {
      filterHash: buildProfitExplanationFilterHash(input.filters),
      fromDate: input.filters.from,
      toDate: input.filters.to,
      basis: input.filters.basis,
      requestedById: input.requestedById ?? null,
      promptVersion: PROFIT_EXPLANATION_PROMPT_VERSION,
      keyRef: input.keyRef ?? null,
      status: input.status ?? ProfitExplanationStatus.SUCCESS,
      evidence: input.evidence as unknown as Prisma.InputJsonValue,
      result: input.result ? (input.result as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      expiresAt: buildProfitExplanationExpiresAt(input.now),
    },
    select: {
      id: true,
    },
  });

  return record;
}

export async function listRecentProfitExplanationHistory(input: {
  filters: ProfitExplanationFilterInput;
  take?: number;
}): Promise<
  Array<{
    id: string;
    createdAt: Date;
    result: ProfitExplanationResult | null;
    status: ProfitExplanationStatus;
  }>
> {
  const rows = await db.profitExplanationHistory.findMany({
    where: {
      filterHash: buildProfitExplanationFilterHash(input.filters),
      expiresAt: {
        gte: new Date(),
      },
    },
    orderBy: {
      createdAt: "desc",
    },
    take: Math.min(Math.max(input.take ?? 5, 1), 10),
    select: {
      id: true,
      createdAt: true,
      result: true,
      status: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    result: row.result as ProfitExplanationResult | null,
    status: row.status,
  }));
}
