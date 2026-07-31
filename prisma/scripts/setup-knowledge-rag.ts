import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to set up Knowledge RAG.");

const setupSql = `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE OR REPLACE FUNCTION f_unaccent(text)
  RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $func$ SELECT public.unaccent('public.unaccent', $1) $func$;

CREATE TABLE IF NOT EXISTS knowledge_documents (
  id text PRIMARY KEY,
  source_type text NOT NULL,
  source_ref text NOT NULL,
  title text NOT NULL,
  section_heading text NOT NULL DEFAULT '',
  content text NOT NULL,
  answer_scope text NOT NULL,
  risk_level text NOT NULL,
  status text NOT NULL DEFAULT 'APPROVED',
  source_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_text text NOT NULL DEFAULT '',
  search_document tsvector NOT NULL DEFAULT ''::tsvector,
  embedding vector(768),
  embedding_model text,
  embedding_source_hash text,
  embedded_at timestamptz(3),
  valid_until timestamptz(3),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_documents_status_check CHECK (status IN ('APPROVED', 'ARCHIVED')),
  CONSTRAINT knowledge_documents_risk_check CHECK (risk_level IN ('LOW', 'MEDIUM'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_documents_active
  ON knowledge_documents (status, valid_until);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_search_document
  ON knowledge_documents USING GIN (search_document);
CREATE INDEX IF NOT EXISTS idx_knowledge_documents_search_text_trgm
  ON knowledge_documents USING GIN (search_text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS knowledge_sync_state (
  id text PRIMARY KEY,
  lease_until timestamptz(3),
  last_started_at timestamptz(3),
  last_finished_at timestamptz(3),
  last_success_at timestamptz(3),
  last_error text,
  run_count integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS knowledge_rag_daily_metrics (
  bucket_start timestamptz(3) NOT NULL,
  channel text NOT NULL,
  policy_id text NOT NULL,
  total_count integer NOT NULL DEFAULT 0,
  answered_count integer NOT NULL DEFAULT 0,
  human_only_count integer NOT NULL DEFAULT 0,
  no_retrieval_count integer NOT NULL DEFAULT 0,
  unsupported_count integer NOT NULL DEFAULT 0,
  generation_error_count integer NOT NULL DEFAULT 0,
  disabled_count integer NOT NULL DEFAULT 0,
  total_latency_ms bigint NOT NULL DEFAULT 0,
  max_latency_ms integer NOT NULL DEFAULT 0,
  latency_le_500_count integer NOT NULL DEFAULT 0,
  latency_le_1000_count integer NOT NULL DEFAULT 0,
  latency_le_3000_count integer NOT NULL DEFAULT 0,
  latency_gt_3000_count integer NOT NULL DEFAULT 0,
  retrieved_total integer NOT NULL DEFAULT 0,
  top_score_total double precision NOT NULL DEFAULT 0,
  top_score_count integer NOT NULL DEFAULT 0,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_start, channel, policy_id),
  CONSTRAINT knowledge_rag_daily_metrics_channel_check
    CHECK (channel IN ('line', 'messenger'))
);
CREATE INDEX IF NOT EXISTS idx_knowledge_rag_daily_metrics_bucket
  ON knowledge_rag_daily_metrics (bucket_start, channel);

CREATE TABLE IF NOT EXISTS knowledge_rag_feedback (
  id text PRIMARY KEY,
  query_hash varchar(16) NOT NULL,
  channel text NOT NULL,
  outcome text NOT NULL,
  rating text NOT NULL,
  reason_code text NOT NULL,
  citation_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by_user_id text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_rag_feedback_channel_check
    CHECK (channel IN ('line', 'messenger')),
  CONSTRAINT knowledge_rag_feedback_rating_check
    CHECK (rating IN ('GOOD', 'BAD'))
);
CREATE INDEX IF NOT EXISTS idx_knowledge_rag_feedback_created
  ON knowledge_rag_feedback (created_at, channel);
CREATE INDEX IF NOT EXISTS idx_knowledge_rag_feedback_hash
  ON knowledge_rag_feedback (query_hash, created_at);

CREATE TABLE IF NOT EXISTS knowledge_rag_gap_signals (
  id text PRIMARY KEY,
  query_hash varchar(16) NOT NULL,
  channel text NOT NULL,
  outcome text NOT NULL,
  occurrences integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'NEW',
  internal_title text,
  reason_code text,
  reviewed_by_user_id text REFERENCES "User"(id) ON DELETE SET NULL,
  reviewed_at timestamptz(3),
  source_id text REFERENCES "KnowledgeSource"(id) ON DELETE SET NULL,
  first_seen_at timestamptz(3) NOT NULL DEFAULT now(),
  last_seen_at timestamptz(3) NOT NULL DEFAULT now(),
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  updated_at timestamptz(3) NOT NULL DEFAULT now(),
  CONSTRAINT knowledge_rag_gap_channel_check
    CHECK (channel IN ('line', 'messenger')),
  CONSTRAINT knowledge_rag_gap_status_check
    CHECK (status IN ('NEW', 'REVIEWED', 'DISMISSED', 'DRAFT_CREATED')),
  CONSTRAINT uq_knowledge_rag_gap_signal
    UNIQUE (query_hash, channel, outcome)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_rag_gap_status
  ON knowledge_rag_gap_signals (status, occurrences DESC, last_seen_at DESC);
`;

async function main(): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await pool.query(setupSql);
    console.log("Knowledge RAG schema is ready.");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
