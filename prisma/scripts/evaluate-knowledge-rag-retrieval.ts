import { Pool } from "pg";
import {
  embedKnowledgeDocuments,
  embedKnowledgeQuery,
  getKnowledgeEmbeddingModelId,
  toKnowledgePgVectorLiteral,
} from "../../lib/knowledge-embeddings";
import {
  isKnowledgeCandidateAccepted,
  KNOWLEDGE_RAG_BLOCKED_SOURCE_REFS,
  KNOWLEDGE_RAG_OFFLINE_CANDIDATES,
  KNOWLEDGE_RAG_RETRIEVAL_LATENCY_BUDGET_MS,
  scoreKnowledgeCandidate,
  type KnowledgeRetrievalPolicy,
} from "../../lib/knowledge-rag-retrieval-policy";
import {
  knowledgeHardNegativeGoldenCases,
  knowledgeRetrievalGoldenCases,
} from "./knowledge-rag-golden-cases";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to evaluate Knowledge RAG retrieval.");
}

type DatabaseChunk = {
  id: string;
  source_ref: string;
  title: string;
  section_heading: string;
  content: string;
  answer_scope: string;
  search_text: string;
  embedding_text: string;
};

type CandidateChunk = {
  id: string;
  sourceRef: string;
  title: string;
  section: string;
  text: string;
  vector: number[];
};

type RankedRow = {
  source_ref: string;
  semantic_score: number;
  lexical_score: number;
  title_score: number;
  section_score: number;
  hybrid_score: number;
};

type Evaluation = {
  id: string;
  retrievalPassed: number;
  retrievalTotal: number;
  hardNegativePassed: number;
  hardNegativeTotal: number;
  meanReciprocalRank: number;
  p95Ms: number;
};

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

function splitByLength(text: string, maxChars: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];
  const sentences = clean.split(/(?<=[.!?。！？]|ค่ะ|ครับ)\s+/u);
  const chunks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) chunks.push(current);
      for (let index = 0; index < sentence.length; index += maxChars) {
        chunks.push(sentence.slice(index, index + maxChars));
      }
      current = "";
    } else if (!current) {
      current = sentence;
    } else if (`${current} ${sentence}`.length <= maxChars) {
      current = `${current} ${sentence}`;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function normalizedTrigrams(value: string): Set<string> {
  const normalized = `  ${value.toLocaleLowerCase("th-TH").replace(/[^\p{L}\p{N}]+/gu, " ").trim()}  `;
  const grams = new Set<string>();
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    grams.add(normalized.slice(index, index + 3));
  }
  return grams;
}

function trigramSimilarity(left: string, right: string): number {
  const a = normalizedTrigrams(left);
  const b = normalizedTrigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const gram of a) if (b.has(gram)) common += 1;
  return (2 * common) / (a.size + b.size);
}

function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return Math.max(0, dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
}

function parseVector(value: string): number[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "number")) {
    throw new Error("INVALID_KNOWLEDGE_VECTOR");
  }
  return parsed;
}

function toSearchText(
  title: string,
  section: string,
  content: string,
  answerScope: string,
): string {
  return `title: ${title} | section: ${section} | text: ${content} | answer scope: ${answerScope}`;
}

async function buildChunkProfiles(rows: DatabaseChunk[]): Promise<Record<string, CandidateChunk[]>> {
  const current = rows.map((row) => ({
    id: row.id,
    sourceRef: row.source_ref,
    title: row.title,
    section: row.section_heading,
    text: row.search_text,
    vector: parseVector(row.embedding_text),
  }));

  const splitDrafts = rows.flatMap((row) =>
    splitByLength(row.content, 900).map((content, index) => ({
      id: `${row.id}:split900:${index + 1}`,
      sourceRef: row.source_ref,
      title: row.title,
      section: row.section_heading,
      text: toSearchText(row.title, row.section_heading, content, row.answer_scope),
    })),
  );

  const grouped = new Map<string, DatabaseChunk[]>();
  for (const row of rows) {
    const group = grouped.get(row.source_ref) ?? [];
    group.push(row);
    grouped.set(row.source_ref, group);
  }
  const mergedDrafts = [...grouped.entries()].flatMap(([sourceRef, sourceRows]) => {
    const first = sourceRows[0];
    if (!first) return [];
    const merged = sourceRows
      .map((row) => `${row.section_heading}: ${row.content}`)
      .join("\n");
    const answerScope = [...new Set(sourceRows.map((row) => row.answer_scope))].join("; ");
    return splitByLength(merged, 1_600).map((content, index) => ({
      id: `${sourceRef}:merge1600:${index + 1}`,
      sourceRef,
      title: first.title,
      section: "รวมเนื้อหา",
      text: toSearchText(first.title, "รวมเนื้อหา", content, answerScope),
    }));
  });

  const drafts = [...splitDrafts, ...mergedDrafts];
  const vectors = await embedKnowledgeDocuments(drafts.map((draft) => draft.text));
  const split = splitDrafts.map((draft, index) => ({
    ...draft,
    vector: vectors[index] ?? [],
  }));
  const merged = mergedDrafts.map((draft, index) => ({
    ...draft,
    vector: vectors[splitDrafts.length + index] ?? [],
  }));
  return { current, "split-900": split, "merge-1600": merged };
}

function rankInMemory(
  question: string,
  queryVector: number[],
  chunks: CandidateChunk[],
  policy: KnowledgeRetrievalPolicy,
): Array<{ sourceRef: string; score: number }> {
  return chunks
    .map((chunk) => {
      const semantic = cosineSimilarity(queryVector, chunk.vector);
      const hybrid = scoreKnowledgeCandidate(
        {
          semantic,
          lexical: trigramSimilarity(chunk.text, question),
          title: trigramSimilarity(chunk.title, question),
          section: trigramSimilarity(chunk.section, question),
        },
        policy,
      );
      return { sourceRef: chunk.sourceRef, semantic, hybrid };
    })
    .filter((row) => isKnowledgeCandidateAccepted(row, policy))
    .sort((a, b) => b.hybrid - a.hybrid)
    .slice(0, policy.topK)
    .map((row) => ({ sourceRef: row.sourceRef, score: row.hybrid }));
}

async function retrieveExact(
  pool: Pool,
  question: string,
  vector: number[],
  policy: KnowledgeRetrievalPolicy,
): Promise<RankedRow[]> {
  const result = await pool.query<RankedRow>(
    `WITH scored AS (
       SELECT source_ref,
         GREATEST(0, 1 - (embedding <=> $1::vector))::double precision AS semantic_score,
         GREATEST(
           similarity(f_unaccent(lower(search_text)), f_unaccent(lower($2))),
           ts_rank_cd(search_document, plainto_tsquery('simple', f_unaccent($2)))
         )::double precision AS lexical_score,
         similarity(f_unaccent(lower(title)), f_unaccent(lower($2)))::double precision AS title_score,
         similarity(f_unaccent(lower(section_heading)), f_unaccent(lower($2)))::double precision AS section_score
       FROM knowledge_documents
       WHERE status='APPROVED'
         AND embedding IS NOT NULL
         AND embedding_model=$3
         AND NOT (source_ref = ANY($4::text[]))
         AND (valid_until IS NULL OR valid_until > now())
     )
     SELECT *, (
       semantic_score * $5 +
       LEAST(lexical_score, 1) * $6 +
       LEAST(title_score, 1) * $7 +
       LEAST(section_score, 1) * $8
     )::double precision AS hybrid_score
     FROM scored
     WHERE semantic_score >= $9
     ORDER BY hybrid_score DESC
     LIMIT $10`,
    [
      toKnowledgePgVectorLiteral(vector),
      question,
      getKnowledgeEmbeddingModelId(),
      [...KNOWLEDGE_RAG_BLOCKED_SOURCE_REFS],
      policy.semanticWeight,
      policy.lexicalWeight,
      policy.titleWeight,
      policy.sectionWeight,
      policy.minSemantic,
      policy.topK,
    ],
  );
  return result.rows.filter((row) => Number(row.hybrid_score) >= policy.minHybrid);
}

async function evaluateExact(
  pool: Pool,
  queryVectors: Map<string, number[]>,
  policy: KnowledgeRetrievalPolicy,
): Promise<Evaluation> {
  let retrievalPassed = 0;
  let hardNegativePassed = 0;
  let reciprocalRank = 0;
  const latencies: number[] = [];

  for (const golden of knowledgeRetrievalGoldenCases) {
    const startedAt = Date.now();
    const rows = await retrieveExact(pool, golden.question, queryVectors.get(golden.question) ?? [], policy);
    latencies.push(Date.now() - startedAt);
    const rank = rows.findIndex((row) => golden.expectedSourceRefs.includes(row.source_ref));
    if (rank >= 0) {
      retrievalPassed += 1;
      reciprocalRank += 1 / (rank + 1);
    }
  }
  const noRetrievalCases = knowledgeHardNegativeGoldenCases.filter(
    (item) => item.expected === "NO_RETRIEVAL",
  );
  for (const golden of noRetrievalCases) {
    const startedAt = Date.now();
    const rows = await retrieveExact(pool, golden.question, queryVectors.get(golden.question) ?? [], policy);
    latencies.push(Date.now() - startedAt);
    if (rows.length === 0) hardNegativePassed += 1;
  }
  return {
    id: policy.id,
    retrievalPassed,
    retrievalTotal: knowledgeRetrievalGoldenCases.length,
    hardNegativePassed,
    hardNegativeTotal: noRetrievalCases.length,
    meanReciprocalRank: Number(
      (reciprocalRank / knowledgeRetrievalGoldenCases.length).toFixed(4),
    ),
    p95Ms: percentile(latencies, 0.95),
  };
}

function evaluateChunkProfile(
  id: string,
  chunks: CandidateChunk[],
  queryVectors: Map<string, number[]>,
  policy: KnowledgeRetrievalPolicy,
): Evaluation {
  let retrievalPassed = 0;
  let hardNegativePassed = 0;
  let reciprocalRank = 0;
  const latencies: number[] = [];
  for (const golden of knowledgeRetrievalGoldenCases) {
    const startedAt = Date.now();
    const rows = rankInMemory(
      golden.question,
      queryVectors.get(golden.question) ?? [],
      chunks,
      policy,
    );
    latencies.push(Date.now() - startedAt);
    const rank = rows.findIndex((row) => golden.expectedSourceRefs.includes(row.sourceRef));
    if (rank >= 0) {
      retrievalPassed += 1;
      reciprocalRank += 1 / (rank + 1);
    }
  }
  const noRetrievalCases = knowledgeHardNegativeGoldenCases.filter(
    (item) => item.expected === "NO_RETRIEVAL",
  );
  for (const golden of noRetrievalCases) {
    const startedAt = Date.now();
    const rows = rankInMemory(
      golden.question,
      queryVectors.get(golden.question) ?? [],
      chunks,
      policy,
    );
    latencies.push(Date.now() - startedAt);
    if (rows.length === 0) hardNegativePassed += 1;
  }
  return {
    id,
    retrievalPassed,
    retrievalTotal: knowledgeRetrievalGoldenCases.length,
    hardNegativePassed,
    hardNegativeTotal: noRetrievalCases.length,
    meanReciprocalRank: Number(
      (reciprocalRank / knowledgeRetrievalGoldenCases.length).toFixed(4),
    ),
    p95Ms: percentile(latencies, 0.95),
  };
}

function passesGate(candidate: Evaluation, baseline: Evaluation): boolean {
  return (
    candidate.retrievalPassed >= baseline.retrievalPassed &&
    candidate.hardNegativePassed >= baseline.hardNegativePassed &&
    candidate.meanReciprocalRank >= baseline.meanReciprocalRank &&
    candidate.p95Ms <= KNOWLEDGE_RAG_RETRIEVAL_LATENCY_BUDGET_MS
  );
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const rows = await pool.query<DatabaseChunk>(
      `SELECT id, source_ref, title, section_heading, content, answer_scope, search_text,
              embedding::text AS embedding_text
       FROM knowledge_documents
       WHERE status='APPROVED'
         AND embedding IS NOT NULL
         AND embedding_model=$1
         AND NOT (source_ref = ANY($2::text[]))
         AND (valid_until IS NULL OR valid_until > now())
       ORDER BY source_ref, id`,
      [getKnowledgeEmbeddingModelId(), [...KNOWLEDGE_RAG_BLOCKED_SOURCE_REFS]],
    );
    const questions = [
      ...knowledgeRetrievalGoldenCases.map((item) => item.question),
      ...knowledgeHardNegativeGoldenCases
        .filter((item) => item.expected === "NO_RETRIEVAL")
        .map((item) => item.question),
    ];
    const queryVectors = new Map<string, number[]>();
    for (const question of [...new Set(questions)]) {
      const vector = await embedKnowledgeQuery(question);
      if (!vector) throw new Error(`KNOWLEDGE_QUERY_EMBED_FAILED:${question}`);
      queryVectors.set(question, vector);
    }

    const exact: Evaluation[] = [];
    for (const policy of KNOWLEDGE_RAG_OFFLINE_CANDIDATES) {
      exact.push(await evaluateExact(pool, queryVectors, policy));
    }
    const baseline = exact[0];
    if (!baseline) throw new Error("KNOWLEDGE_BASELINE_MISSING");
    const exactWithGate = exact.map((result) => ({
      ...result,
      passesBaselineGate:
        result.id === baseline.id ? true : passesGate(result, baseline),
    }));

    let chunkProfiles: Array<Evaluation & { chunks: number }> = [];
    if (process.argv.includes("--with-chunk-experiments")) {
      const profiles = await buildChunkProfiles(rows.rows);
      chunkProfiles = Object.entries(profiles).map(([id, chunks]) => ({
        ...evaluateChunkProfile(
          `chunk:${id}`,
          chunks,
          queryVectors,
          KNOWLEDGE_RAG_OFFLINE_CANDIDATES[0]!,
        ),
        chunks: chunks.length,
      }));
    }

    console.log(
      JSON.stringify(
        {
          mode: "read-only offline evaluation",
          corpusDocuments: rows.rowCount,
          embeddingModel: getKnowledgeEmbeddingModelId(),
          latencyBudgetMs: KNOWLEDGE_RAG_RETRIEVAL_LATENCY_BUDGET_MS,
          exactProductionCorpus: exactWithGate,
          chunkExperiments: chunkProfiles,
          rollout: "No production threshold or chunking change is applied by this script.",
        },
        null,
        2,
      ),
    );

    const requestedGate = process.argv
      .find((item) => item.startsWith("--gate="))
      ?.slice("--gate=".length);
    if (requestedGate) {
      const candidate = exactWithGate.find((item) => item.id === requestedGate);
      if (!candidate) throw new Error(`UNKNOWN_RETRIEVAL_CANDIDATE:${requestedGate}`);
      if (!candidate.passesBaselineGate) {
        throw new Error(`KNOWLEDGE_RETRIEVAL_GATE_FAILED:${requestedGate}`);
      }
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
