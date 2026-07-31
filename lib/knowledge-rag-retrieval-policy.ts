export type KnowledgeRetrievalPolicy = {
  id: string;
  semanticWeight: number;
  lexicalWeight: number;
  titleWeight: number;
  sectionWeight: number;
  minSemantic: number;
  minHybrid: number;
  topK: number;
};

export const KNOWLEDGE_RAG_RETRIEVAL_VERSION = "round-c-v1";
export const KNOWLEDGE_RAG_RETRIEVAL_LATENCY_BUDGET_MS = 3_000;

export const KNOWLEDGE_RAG_BLOCKED_SOURCE_REFS = [
  "policy:return-warranty",
  "return-warranty-policy",
  "faq:storefront:6",
  "faq:storefront:7",
] as const;

export const KNOWLEDGE_RAG_BASELINE_POLICY: KnowledgeRetrievalPolicy = {
  id: "production-baseline",
  semanticWeight: 0.8,
  lexicalWeight: 0.2,
  titleWeight: 0,
  sectionWeight: 0,
  minSemantic: 0.55,
  minHybrid: 0.52,
  topK: 5,
};

export const KNOWLEDGE_RAG_OFFLINE_CANDIDATES: readonly KnowledgeRetrievalPolicy[] = [
  KNOWLEDGE_RAG_BASELINE_POLICY,
  {
    id: "title-section-rerank",
    semanticWeight: 0.7,
    lexicalWeight: 0.15,
    titleWeight: 0.1,
    sectionWeight: 0.05,
    minSemantic: 0.55,
    minHybrid: 0.5,
    topK: 5,
  },
  {
    id: "semantic-leaning",
    semanticWeight: 0.85,
    lexicalWeight: 0.15,
    titleWeight: 0,
    sectionWeight: 0,
    minSemantic: 0.55,
    minHybrid: 0.52,
    topK: 5,
  },
  {
    id: "strict-threshold",
    semanticWeight: 0.8,
    lexicalWeight: 0.2,
    titleWeight: 0,
    sectionWeight: 0,
    minSemantic: 0.58,
    minHybrid: 0.55,
    topK: 5,
  },
] as const;

function boundedNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : fallback;
}

export function getProductionKnowledgeRetrievalPolicy(
  env: Readonly<Record<string, string | undefined>> = process.env,
): KnowledgeRetrievalPolicy {
  return {
    ...KNOWLEDGE_RAG_BASELINE_POLICY,
    minSemantic: boundedNumber(
      env.KNOWLEDGE_RAG_MIN_SEMANTIC,
      KNOWLEDGE_RAG_BASELINE_POLICY.minSemantic,
    ),
    minHybrid: boundedNumber(
      env.KNOWLEDGE_RAG_MIN_HYBRID,
      KNOWLEDGE_RAG_BASELINE_POLICY.minHybrid,
    ),
  };
}

export function scoreKnowledgeCandidate(
  input: {
    semantic: number;
    lexical: number;
    title: number;
    section: number;
  },
  policy: KnowledgeRetrievalPolicy,
): number {
  return (
    input.semantic * policy.semanticWeight +
    Math.min(input.lexical, 1) * policy.lexicalWeight +
    Math.min(input.title, 1) * policy.titleWeight +
    Math.min(input.section, 1) * policy.sectionWeight
  );
}

export function isKnowledgeCandidateAccepted(
  input: { semantic: number; hybrid: number },
  policy: KnowledgeRetrievalPolicy,
): boolean {
  return input.semantic >= policy.minSemantic && input.hybrid >= policy.minHybrid;
}
