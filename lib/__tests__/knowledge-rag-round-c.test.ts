import assert from "node:assert/strict";
import test from "node:test";
import {
  getProductionKnowledgeRetrievalPolicy,
  KNOWLEDGE_RAG_BASELINE_POLICY,
  scoreKnowledgeCandidate,
} from "@/lib/knowledge-rag-retrieval-policy";
import {
  aggregateKnowledgeRagTelemetry,
  buildKnowledgeRagTelemetryEvent,
  hashKnowledgeRagQuery,
  parseKnowledgeRagTelemetryLine,
} from "@/lib/knowledge-rag-telemetry";

test("production retrieval policy preserves the pre-Round-C baseline", () => {
  const policy = getProductionKnowledgeRetrievalPolicy({});
  assert.deepEqual(policy, KNOWLEDGE_RAG_BASELINE_POLICY);
  assert.ok(
    Math.abs(
    scoreKnowledgeCandidate(
      { semantic: 0.7, lexical: 0.4, title: 1, section: 1 },
      policy,
      ) - 0.64,
    ) < 1e-9,
  );
});

test("threshold overrides stay bounded without changing ranking weights", () => {
  const policy = getProductionKnowledgeRetrievalPolicy({
    KNOWLEDGE_RAG_MIN_SEMANTIC: "2",
    KNOWLEDGE_RAG_MIN_HYBRID: "-1",
  });
  assert.equal(policy.minSemantic, 1);
  assert.equal(policy.minHybrid, 0);
  assert.equal(policy.semanticWeight, 0.8);
  assert.equal(policy.lexicalWeight, 0.2);
});

test("telemetry contains only a query hash and aggregates without exposing it", () => {
  const policy = KNOWLEDGE_RAG_BASELINE_POLICY;
  const first = buildKnowledgeRagTelemetryEvent({
    question: "รหัส OEM ดูตรงไหน",
    channel: "line",
    outcome: "ANSWERED",
    latencyMs: 121.4,
    retrievedCount: 3,
    topHybridScore: 0.67891,
    embeddingModel: "embedding-2:768",
    policy,
  });
  const second = buildKnowledgeRagTelemetryEvent({
    question: "รหัส OEM ดูตรงไหน",
    channel: "messenger",
    outcome: "UNSUPPORTED",
    latencyMs: 240,
    retrievedCount: 1,
    topHybridScore: 0.56,
    embeddingModel: "embedding-2:768",
    policy,
  });
  assert.equal(first.queryHash, hashKnowledgeRagQuery("รหัส OEM ดูตรงไหน"));
  assert.equal(JSON.stringify(first).includes("รหัส OEM"), false);

  const parsed = parseKnowledgeRagTelemetryLine(
    `[knowledge-rag] ${JSON.stringify(first)}`,
  );
  assert.deepEqual(parsed, first);

  const aggregate = aggregateKnowledgeRagTelemetry([first, second]);
  assert.equal(aggregate.events, 2);
  assert.equal(aggregate.uniqueQueryHashes, 1);
  assert.equal(aggregate.channels.line, 1);
  assert.equal(aggregate.channels.messenger, 1);
  assert.equal(aggregate.answerRate, 0.5);
  assert.equal(JSON.stringify(aggregate).includes(first.queryHash), false);
});
