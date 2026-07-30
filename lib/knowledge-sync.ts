import { Prisma } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import {
  buildKnowledgeDocumentText,
  buildKnowledgeSourceHash,
  getApprovedKnowledgeDocuments,
  type ApprovedKnowledgeDocument,
} from "@/lib/knowledge-corpus";
import {
  embedKnowledgeDocuments,
  getKnowledgeEmbeddingModelId,
  toKnowledgePgVectorLiteral,
} from "@/lib/knowledge-embeddings";

const SYNC_STATE_ID = "approved-corpus";
const DEFAULT_MAX_DOCUMENTS = 8;

export type CurrentKnowledgeRow = {
  id: string;
  source_type: string;
  source_ref: string;
  title: string;
  section_heading: string;
  content: string;
  answer_scope: string;
  risk_level: string;
  status: string;
  source_urls: unknown;
  metadata: unknown;
  search_text: string;
  embedding_model: string | null;
  embedding_source_hash: string | null;
  has_embedding: boolean;
};

export type KnowledgeSyncResult = {
  acquired: boolean;
  desired: number;
  changed: number;
  synced: number;
  archived: number;
  pending: number;
};

function normalizedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(normalizedJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${normalizedJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function isKnowledgeDocumentStale(
  document: ApprovedKnowledgeDocument,
  current: CurrentKnowledgeRow | undefined,
  modelId = getKnowledgeEmbeddingModelId(),
): boolean {
  if (!current) return true;
  const searchText = buildKnowledgeDocumentText(document);
  return (
    current.source_type !== document.sourceType ||
    current.source_ref !== document.sourceRef ||
    current.title !== document.title ||
    current.section_heading !== document.sectionHeading ||
    current.content !== document.content ||
    current.answer_scope !== document.answerScope ||
    current.risk_level !== document.riskLevel ||
    current.status !== "APPROVED" ||
    normalizedJson(current.source_urls) !== normalizedJson(document.sourceUrls) ||
    normalizedJson(current.metadata) !== normalizedJson(document.metadata) ||
    current.search_text !== searchText ||
    !current.has_embedding ||
    current.embedding_model !== modelId ||
    current.embedding_source_hash !== buildKnowledgeSourceHash(document)
  );
}

async function acquireLease(): Promise<boolean> {
  await db.$executeRaw(Prisma.sql`
    INSERT INTO knowledge_sync_state (id)
    VALUES (${SYNC_STATE_ID})
    ON CONFLICT (id) DO NOTHING
  `);
  const claimed = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE knowledge_sync_state
    SET lease_until = now() + interval '75 seconds',
        last_started_at = now(),
        run_count = run_count + 1,
        last_error = NULL
    WHERE id = ${SYNC_STATE_ID}
      AND (lease_until IS NULL OR lease_until < now())
    RETURNING id
  `);
  return claimed.length === 1;
}

async function finishLease(error: string | null): Promise<void> {
  await db.$executeRaw(Prisma.sql`
    UPDATE knowledge_sync_state
    SET lease_until = NULL,
        last_finished_at = now(),
        last_success_at = CASE WHEN ${error}::text IS NULL THEN now() ELSE last_success_at END,
        last_error = ${error}
    WHERE id = ${SYNC_STATE_ID}
  `);
}

async function upsertKnowledgeDocument(document: ApprovedKnowledgeDocument): Promise<void> {
  const searchText = buildKnowledgeDocumentText(document);
  const sourceHash = buildKnowledgeSourceHash(document);
  const [vector] = await embedKnowledgeDocuments([searchText]);
  if (!vector) throw new Error(`KNOWLEDGE_EMBED_FAILED:${document.id}`);
  const vectorLiteral = toKnowledgePgVectorLiteral(vector);
  const sourceUrls = JSON.stringify(document.sourceUrls);
  const metadata = JSON.stringify(document.metadata);

  await db.$executeRaw(Prisma.sql`
    INSERT INTO knowledge_documents (
      id, source_type, source_ref, title, section_heading, content, answer_scope,
      risk_level, status, source_urls, metadata, search_text, search_document,
      embedding, embedding_model, embedding_source_hash, embedded_at, updated_at
    ) VALUES (
      ${document.id}, ${document.sourceType}, ${document.sourceRef}, ${document.title},
      ${document.sectionHeading}, ${document.content}, ${document.answerScope},
      ${document.riskLevel}, 'APPROVED', ${sourceUrls}::jsonb, ${metadata}::jsonb,
      ${searchText}, to_tsvector('simple', f_unaccent(${searchText})),
      ${vectorLiteral}::vector, ${getKnowledgeEmbeddingModelId()}, ${sourceHash}, now(), now()
    )
    ON CONFLICT (id) DO UPDATE SET
      source_type=EXCLUDED.source_type, source_ref=EXCLUDED.source_ref,
      title=EXCLUDED.title, section_heading=EXCLUDED.section_heading,
      content=EXCLUDED.content, answer_scope=EXCLUDED.answer_scope,
      risk_level=EXCLUDED.risk_level, status='APPROVED',
      source_urls=EXCLUDED.source_urls, metadata=EXCLUDED.metadata,
      search_text=EXCLUDED.search_text, search_document=EXCLUDED.search_document,
      embedding=EXCLUDED.embedding, embedding_model=EXCLUDED.embedding_model,
      embedding_source_hash=EXCLUDED.embedding_source_hash,
      embedded_at=EXCLUDED.embedded_at, updated_at=now()
  `);
}

export async function syncKnowledgeRag(options?: {
  maxDocuments?: number;
}): Promise<KnowledgeSyncResult> {
  const desiredDocuments = getApprovedKnowledgeDocuments();
  const acquired = await acquireLease();
  if (!acquired) {
    return {
      acquired: false,
      desired: desiredDocuments.length,
      changed: 0,
      synced: 0,
      archived: 0,
      pending: 0,
    };
  }

  try {
    const currentRows = await db.$queryRaw<CurrentKnowledgeRow[]>(Prisma.sql`
      SELECT id, source_type, source_ref, title, section_heading, content,
             answer_scope, risk_level, status, source_urls, metadata, search_text,
             embedding_model, embedding_source_hash, (embedding IS NOT NULL) AS has_embedding
      FROM knowledge_documents
    `);
    const currentById = new Map(currentRows.map((row) => [row.id, row]));
    const changedDocuments = desiredDocuments.filter((document) =>
      isKnowledgeDocumentStale(document, currentById.get(document.id)),
    );
    const changedExistingIds = changedDocuments
      .map((document) => document.id)
      .filter((id) => currentById.has(id));
    // Fail closed during re-embedding: once deployed source differs from the
    // indexed row, stop serving the old version immediately. Successful upserts
    // approve each new vector; a Gemini failure leaves the stale row archived and
    // the next cron retries it instead of answering from outdated policy text.
    if (changedExistingIds.length > 0) {
      await db.$executeRaw(Prisma.sql`
        UPDATE knowledge_documents
        SET status='ARCHIVED', updated_at=now()
        WHERE id = ANY(${changedExistingIds}::text[])
      `);
    }
    const maxDocuments = Math.max(1, Math.floor(options?.maxDocuments ?? DEFAULT_MAX_DOCUMENTS));
    const batch = changedDocuments.slice(0, maxDocuments);

    for (const document of batch) await upsertKnowledgeDocument(document);

    const pending = changedDocuments.length - batch.length;
    let archived = 0;
    if (pending === 0) {
      const activeIds = desiredDocuments.map((document) => document.id);
      const result = await db.$executeRaw(Prisma.sql`
        UPDATE knowledge_documents
        SET status='ARCHIVED', updated_at=now()
        WHERE status='APPROVED' AND NOT (id = ANY(${activeIds}::text[]))
      `);
      archived = Number(result);
    }

    await finishLease(null);
    return {
      acquired: true,
      desired: desiredDocuments.length,
      changed: changedDocuments.length,
      synced: batch.length,
      archived,
      pending,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
    await finishLease(message).catch(() => undefined);
    throw error;
  }
}
