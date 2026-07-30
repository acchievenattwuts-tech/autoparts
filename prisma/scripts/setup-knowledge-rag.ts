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
