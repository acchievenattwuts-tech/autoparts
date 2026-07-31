import { createHash } from "crypto";
import type { KnowledgeRetrievalPolicy } from "@/lib/knowledge-rag-retrieval-policy";
import { KNOWLEDGE_RAG_RETRIEVAL_VERSION } from "@/lib/knowledge-rag-retrieval-policy";

export type KnowledgeRagTelemetryOutcome =
  | "DISABLED"
  | "HUMAN_ONLY"
  | "NO_RETRIEVAL"
  | "ANSWERED"
  | "UNSUPPORTED"
  | "GENERATION_ERROR";

export type KnowledgeRagTelemetryEvent = {
  event: "KNOWLEDGE_RAG_QUERY";
  version: string;
  channel: "line" | "messenger";
  queryHash: string;
  outcome: KnowledgeRagTelemetryOutcome;
  latencyMs: number;
  retrievedCount: number;
  topHybridScore: number | null;
  embeddingModel: string;
  retrievalPolicy: {
    id: string;
    minSemantic: number;
    minHybrid: number;
  };
};

export type KnowledgeRagTelemetryAggregate = {
  events: number;
  uniqueQueryHashes: number;
  channels: Record<string, number>;
  outcomes: Record<string, number>;
  latencyMs: { p50: number; p95: number; max: number };
  averageRetrievedCount: number;
  answerRate: number;
  handoffOrNoAnswerRate: number;
};

export function hashKnowledgeRagQuery(question: string): string {
  return createHash("sha256")
    .update(question.trim().toLocaleLowerCase("th-TH"))
    .digest("hex")
    .slice(0, 16);
}

export function buildKnowledgeRagTelemetryEvent(input: {
  question: string;
  channel: "line" | "messenger";
  outcome: KnowledgeRagTelemetryOutcome;
  latencyMs: number;
  retrievedCount: number;
  topHybridScore: number | null;
  embeddingModel: string;
  policy: KnowledgeRetrievalPolicy;
}): KnowledgeRagTelemetryEvent {
  return {
    event: "KNOWLEDGE_RAG_QUERY",
    version: KNOWLEDGE_RAG_RETRIEVAL_VERSION,
    channel: input.channel,
    queryHash: hashKnowledgeRagQuery(input.question),
    outcome: input.outcome,
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    retrievedCount: Math.max(0, Math.round(input.retrievedCount)),
    topHybridScore:
      input.topHybridScore === null
        ? null
        : Number(Number(input.topHybridScore).toFixed(4)),
    embeddingModel: input.embeddingModel,
    retrievalPolicy: {
      id: input.policy.id,
      minSemantic: input.policy.minSemantic,
      minHybrid: input.policy.minHybrid,
    },
  };
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

export function aggregateKnowledgeRagTelemetry(
  events: readonly KnowledgeRagTelemetryEvent[],
): KnowledgeRagTelemetryAggregate {
  const channels: Record<string, number> = {};
  const outcomes: Record<string, number> = {};
  const hashes = new Set<string>();
  const latencies: number[] = [];
  let retrievedTotal = 0;

  for (const event of events) {
    channels[event.channel] = (channels[event.channel] ?? 0) + 1;
    outcomes[event.outcome] = (outcomes[event.outcome] ?? 0) + 1;
    hashes.add(event.queryHash);
    latencies.push(event.latencyMs);
    retrievedTotal += event.retrievedCount;
  }
  latencies.sort((a, b) => a - b);
  const answered = outcomes.ANSWERED ?? 0;
  const handoffOrNoAnswer =
    (outcomes.HUMAN_ONLY ?? 0) +
    (outcomes.NO_RETRIEVAL ?? 0) +
    (outcomes.UNSUPPORTED ?? 0) +
    (outcomes.GENERATION_ERROR ?? 0);
  const count = events.length;

  return {
    events: count,
    uniqueQueryHashes: hashes.size,
    channels,
    outcomes,
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.at(-1) ?? 0,
    },
    averageRetrievedCount:
      count === 0 ? 0 : Number((retrievedTotal / count).toFixed(2)),
    answerRate: count === 0 ? 0 : Number((answered / count).toFixed(4)),
    handoffOrNoAnswerRate:
      count === 0 ? 0 : Number((handoffOrNoAnswer / count).toFixed(4)),
  };
}

export function parseKnowledgeRagTelemetryLine(
  line: string,
): KnowledgeRagTelemetryEvent | null {
  const jsonStart = line.indexOf("{");
  if (jsonStart < 0) return null;
  try {
    const value = JSON.parse(line.slice(jsonStart)) as Partial<KnowledgeRagTelemetryEvent>;
    if (
      value.event !== "KNOWLEDGE_RAG_QUERY" ||
      (value.channel !== "line" && value.channel !== "messenger") ||
      typeof value.queryHash !== "string" ||
      typeof value.outcome !== "string" ||
      typeof value.latencyMs !== "number" ||
      typeof value.retrievedCount !== "number"
    ) {
      return null;
    }
    return value as KnowledgeRagTelemetryEvent;
  } catch {
    return null;
  }
}
