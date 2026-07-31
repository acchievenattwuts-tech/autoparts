import { randomUUID } from "crypto";
import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { startOfThailandDay } from "@/lib/th-date";
import type { KnowledgeRagTelemetryEvent } from "@/lib/knowledge-rag-telemetry";

const GAP_OUTCOMES = new Set(["NO_RETRIEVAL", "UNSUPPORTED", "GENERATION_ERROR"]);

export function isKnowledgeRagOperationsPersistenceEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return (
    env.KNOWLEDGE_RAG_METRICS_ENABLED?.trim().toLowerCase() !== "off" &&
    !env.NODE_TEST_CONTEXT
  );
}

function outcomeCounters(outcome: KnowledgeRagTelemetryEvent["outcome"]) {
  return {
    answered: outcome === "ANSWERED" ? 1 : 0,
    humanOnly: outcome === "HUMAN_ONLY" ? 1 : 0,
    noRetrieval: outcome === "NO_RETRIEVAL" ? 1 : 0,
    unsupported: outcome === "UNSUPPORTED" ? 1 : 0,
    generationError: outcome === "GENERATION_ERROR" ? 1 : 0,
    disabled: outcome === "DISABLED" ? 1 : 0,
  };
}

function latencyCounters(latencyMs: number) {
  return {
    le500: latencyMs <= 500 ? 1 : 0,
    le1000: latencyMs > 500 && latencyMs <= 1_000 ? 1 : 0,
    le3000: latencyMs > 1_000 && latencyMs <= 3_000 ? 1 : 0,
    gt3000: latencyMs > 3_000 ? 1 : 0,
  };
}

export async function recordKnowledgeRagOperationalEvent(
  event: KnowledgeRagTelemetryEvent,
): Promise<void> {
  const bucketStart = startOfThailandDay(new Date());
  const outcome = outcomeCounters(event.outcome);
  const latency = latencyCounters(event.latencyMs);
  const topScore = event.topHybridScore ?? 0;
  const topScoreCount = event.topHybridScore === null ? 0 : 1;
  const statements: Prisma.Sql[] = [
    Prisma.sql`
      INSERT INTO knowledge_rag_daily_metrics (
        bucket_start, channel, policy_id, total_count, answered_count,
        human_only_count, no_retrieval_count, unsupported_count,
        generation_error_count, disabled_count, total_latency_ms,
        max_latency_ms, latency_le_500_count, latency_le_1000_count,
        latency_le_3000_count, latency_gt_3000_count, retrieved_total,
        top_score_total, top_score_count, updated_at
      ) VALUES (
        ${bucketStart}, ${event.channel}, ${event.retrievalPolicy.id}, 1,
        ${outcome.answered}, ${outcome.humanOnly}, ${outcome.noRetrieval},
        ${outcome.unsupported}, ${outcome.generationError}, ${outcome.disabled},
        ${BigInt(event.latencyMs)}, ${event.latencyMs}, ${latency.le500},
        ${latency.le1000}, ${latency.le3000}, ${latency.gt3000},
        ${event.retrievedCount}, ${topScore}, ${topScoreCount}, now()
      )
      ON CONFLICT (bucket_start, channel, policy_id) DO UPDATE SET
        total_count = knowledge_rag_daily_metrics.total_count + 1,
        answered_count = knowledge_rag_daily_metrics.answered_count + EXCLUDED.answered_count,
        human_only_count = knowledge_rag_daily_metrics.human_only_count + EXCLUDED.human_only_count,
        no_retrieval_count = knowledge_rag_daily_metrics.no_retrieval_count + EXCLUDED.no_retrieval_count,
        unsupported_count = knowledge_rag_daily_metrics.unsupported_count + EXCLUDED.unsupported_count,
        generation_error_count = knowledge_rag_daily_metrics.generation_error_count + EXCLUDED.generation_error_count,
        disabled_count = knowledge_rag_daily_metrics.disabled_count + EXCLUDED.disabled_count,
        total_latency_ms = knowledge_rag_daily_metrics.total_latency_ms + EXCLUDED.total_latency_ms,
        max_latency_ms = GREATEST(knowledge_rag_daily_metrics.max_latency_ms, EXCLUDED.max_latency_ms),
        latency_le_500_count = knowledge_rag_daily_metrics.latency_le_500_count + EXCLUDED.latency_le_500_count,
        latency_le_1000_count = knowledge_rag_daily_metrics.latency_le_1000_count + EXCLUDED.latency_le_1000_count,
        latency_le_3000_count = knowledge_rag_daily_metrics.latency_le_3000_count + EXCLUDED.latency_le_3000_count,
        latency_gt_3000_count = knowledge_rag_daily_metrics.latency_gt_3000_count + EXCLUDED.latency_gt_3000_count,
        retrieved_total = knowledge_rag_daily_metrics.retrieved_total + EXCLUDED.retrieved_total,
        top_score_total = knowledge_rag_daily_metrics.top_score_total + EXCLUDED.top_score_total,
        top_score_count = knowledge_rag_daily_metrics.top_score_count + EXCLUDED.top_score_count,
        updated_at = now()
    `,
  ];

  if (GAP_OUTCOMES.has(event.outcome)) {
    statements.push(Prisma.sql`
      INSERT INTO knowledge_rag_gap_signals (
        id, query_hash, channel, outcome, occurrences, status,
        first_seen_at, last_seen_at, created_at, updated_at
      ) VALUES (
        ${randomUUID()}, ${event.queryHash}, ${event.channel}, ${event.outcome},
        1, 'NEW', now(), now(), now(), now()
      )
      ON CONFLICT (query_hash, channel, outcome) DO UPDATE SET
        occurrences = knowledge_rag_gap_signals.occurrences + 1,
        last_seen_at = now(),
        updated_at = now(),
        status = CASE
          WHEN knowledge_rag_gap_signals.status = 'DISMISSED' THEN 'NEW'
          ELSE knowledge_rag_gap_signals.status
        END
    `);
  }

  await db.$transaction(statements.map((statement) => db.$executeRaw(statement)));
}

export type KnowledgeRagMetricSummary = {
  channel: "line" | "messenger";
  total: number;
  answered: number;
  humanOnly: number;
  noRetrieval: number;
  unsupported: number;
  generationError: number;
  averageLatencyMs: number;
  slowRate: number;
  coverageRate: number;
  handoffRate: number;
};

export type KnowledgeRagDashboardData = {
  available: boolean;
  metrics: KnowledgeRagMetricSummary[];
  feedback: {
    total: number;
    good: number;
    bad: number;
    badReasons: Array<{ reasonCode: string; count: number }>;
  };
  gaps: Array<{
    id: string;
    queryHash: string;
    channel: string;
    outcome: string;
    occurrences: number;
    status: string;
    internalTitle: string | null;
    reasonCode: string | null;
    firstSeenAt: Date;
    lastSeenAt: Date;
    sourceId: string | null;
  }>;
};

export async function getKnowledgeRagDashboardData(
  days = 30,
): Promise<KnowledgeRagDashboardData> {
  const since = new Date(Date.now() - Math.max(1, Math.min(90, days)) * 86_400_000);
  try {
    const [metrics, feedbackRows, gaps] = await Promise.all([
      db.knowledgeRagDailyMetric.groupBy({
        by: ["channel"],
        where: { bucketStart: { gte: since } },
        _sum: {
          totalCount: true,
          answeredCount: true,
          humanOnlyCount: true,
          noRetrievalCount: true,
          unsupportedCount: true,
          generationErrorCount: true,
          totalLatencyMs: true,
          latencyGt3000Count: true,
        },
      }),
      db.knowledgeRagFeedback.groupBy({
        by: ["rating", "reasonCode"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
      }),
      db.knowledgeRagGapSignal.findMany({
        orderBy: [{ status: "asc" }, { occurrences: "desc" }, { lastSeenAt: "desc" }],
        take: 100,
        select: {
          id: true,
          queryHash: true,
          channel: true,
          outcome: true,
          occurrences: true,
          status: true,
          internalTitle: true,
          reasonCode: true,
          firstSeenAt: true,
          lastSeenAt: true,
          sourceId: true,
        },
      }),
    ]);

    const metricSummaries = (["line", "messenger"] as const).map((channel) => {
      const row = metrics.find((item) => item.channel === channel);
      const total = row?._sum.totalCount ?? 0;
      const answered = row?._sum.answeredCount ?? 0;
      const humanOnly = row?._sum.humanOnlyCount ?? 0;
      const noRetrieval = row?._sum.noRetrievalCount ?? 0;
      const unsupported = row?._sum.unsupportedCount ?? 0;
      const generationError = row?._sum.generationErrorCount ?? 0;
      const noAnswer = noRetrieval + unsupported + generationError;
      return {
        channel,
        total,
        answered,
        humanOnly,
        noRetrieval,
        unsupported,
        generationError,
        averageLatencyMs:
          total === 0
            ? 0
            : Math.round(
                Number(row?._sum.totalLatencyMs ?? BigInt(0)) / total,
              ),
        slowRate:
          total === 0 ? 0 : Number(((row?._sum.latencyGt3000Count ?? 0) / total).toFixed(4)),
        coverageRate: total === 0 ? 0 : Number((answered / total).toFixed(4)),
        handoffRate:
          total === 0 ? 0 : Number(((humanOnly + noAnswer) / total).toFixed(4)),
      };
    });

    const feedbackTotal = feedbackRows.reduce(
      (sum, item) => sum + item._count._all,
      0,
    );
    const good = feedbackRows
      .filter((item) => item.rating === "GOOD")
      .reduce((sum, item) => sum + item._count._all, 0);
    const bad = feedbackRows
      .filter((item) => item.rating === "BAD")
      .reduce((sum, item) => sum + item._count._all, 0);

    return {
      available: true,
      metrics: metricSummaries,
      feedback: {
        total: feedbackTotal,
        good,
        bad,
        badReasons: feedbackRows
          .filter((item) => item.rating === "BAD")
          .map((item) => ({
            reasonCode: item.reasonCode,
            count: item._count._all,
          }))
          .sort((a, b) => b.count - a.count),
      },
      gaps,
    };
  } catch (error) {
    console.warn("[knowledge-rag] operations dashboard unavailable", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return {
      available: false,
      metrics: [],
      feedback: { total: 0, good: 0, bad: 0, badReasons: [] },
      gaps: [],
    };
  }
}
