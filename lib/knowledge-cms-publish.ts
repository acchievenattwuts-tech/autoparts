import { Prisma, KnowledgeRevisionStatus, KnowledgeSyncJobStatus } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { parseKnowledgeContent } from "@/lib/knowledge-cms-types";
import { findKnowledgeRagPolicyViolations } from "@/lib/chat-core/admin-only-knowledge";
import {
  assessKnowledgeQuality,
  findKnowledgeDuplicateIssues,
} from "@/lib/knowledge-cms-quality";
import {
  embedKnowledgeDocuments,
  getKnowledgeEmbeddingModelId,
  toKnowledgePgVectorLiteral,
} from "@/lib/knowledge-embeddings";
import { notifyKnowledgeRagFailure } from "@/lib/notifications";

type PublishChunk = {
  id: string;
  heading: string;
  content: string;
  searchText: string;
  sourceUrls: string[];
};

function sourceType(type: "ARTICLE" | "FAQ" | "POLICY"): string {
  if (type === "ARTICLE") return "TECHNICAL_GUIDE";
  if (type === "POLICY") return "SHOP_POLICY";
  return "FAQ";
}

function buildChunks(revision: {
  id: string;
  title: string;
  content: unknown;
  answerScope: string;
  ragEnabled: boolean;
  sourceUrls: unknown;
}): PublishChunk[] {
  if (!revision.ragEnabled) return [];
  const content = parseKnowledgeContent(revision.content);
  const violations = findKnowledgeRagPolicyViolations({
    title: revision.title,
    content,
    ragEnabled: revision.ragEnabled,
  });
  const sourceBlocked = violations.some((violation) => violation.scope === "SOURCE");
  const blockedSections = new Set(
    violations
      .filter(
        (violation): violation is typeof violation & { sectionIndex: number } =>
          violation.scope === "SECTION" && violation.sectionIndex !== undefined,
      )
      .map((violation) => violation.sectionIndex),
  );
  if (sourceBlocked) return [];
  const chunks: PublishChunk[] = [];
  const revisionUrls = Array.isArray(revision.sourceUrls)
    ? revision.sourceUrls.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const overview = [content.intro, ...content.highlights].filter(Boolean).join("\n");
  if (overview) {
    chunks.push({
      id: `cms:${revision.id}:overview`,
      heading: "สรุป",
      content: overview,
      searchText: `title: ${revision.title} | section: สรุป | text: ${overview} | answer scope: ${revision.answerScope}`,
      sourceUrls: revisionUrls,
    });
  }
  content.sections.forEach((section, index) => {
    if (!section.aiEnabled || blockedSections.has(index) || section.body.length === 0) return;
    const text = section.body.join("\n");
    chunks.push({
      id: `cms:${revision.id}:section:${index + 1}`,
      heading: section.heading,
      content: text,
      searchText: `title: ${revision.title} | section: ${section.heading} | text: ${text} | answer scope: ${revision.answerScope}`,
      sourceUrls: [...new Set([...(section.evidenceUrls ?? []), ...revisionUrls])],
    });
  });
  return chunks;
}

async function stageChunks(input: {
  source: { id: string; sourceKey: string; type: "ARTICLE" | "FAQ" | "POLICY"; slug: string | null };
  revision: {
    id: string;
    title: string;
    content: unknown;
    answerScope: string;
    riskLevel: "LOW" | "MEDIUM";
    ragEnabled: boolean;
    sourceUrls: unknown;
    checksum: string;
  };
}): Promise<string[]> {
  const chunks = buildChunks(input.revision);
  if (chunks.length === 0) return [];
  const vectors = await embedKnowledgeDocuments(chunks.map((chunk) => chunk.searchText));
  if (vectors.length !== chunks.length) throw new Error("KNOWLEDGE_EMBED_RESULT_COUNT_MISMATCH");
  const parsedContent = parseKnowledgeContent(input.revision.content);
  const validUntil = parsedContent.governance?.validUntil
    ? new Date(`${parsedContent.governance.validUntil}T23:59:59.999+07:00`)
    : null;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const vector = vectors[index];
    if (!vector) throw new Error(`KNOWLEDGE_EMBED_FAILED:${chunk.id}`);
    const urls = JSON.stringify(chunk.sourceUrls);
    const metadata = JSON.stringify({
      cmsSourceId: input.source.id,
      cmsRevisionId: input.revision.id,
      sourceKey: input.source.sourceKey,
      slug: input.source.slug,
    });
    await db.$executeRaw(Prisma.sql`
      INSERT INTO knowledge_documents (
        id, source_type, source_ref, title, section_heading, content, answer_scope,
        risk_level, status, source_urls, metadata, search_text, search_document,
        embedding, embedding_model, embedding_source_hash, valid_until, embedded_at, updated_at
      ) VALUES (
        ${chunk.id}, ${sourceType(input.source.type)}, ${input.source.sourceKey}, ${input.revision.title},
        ${chunk.heading}, ${chunk.content}, ${input.revision.answerScope}, ${input.revision.riskLevel},
        'ARCHIVED', ${urls}::jsonb, ${metadata}::jsonb, ${chunk.searchText},
        to_tsvector('simple', f_unaccent(${chunk.searchText})),
        ${toKnowledgePgVectorLiteral(vector)}::vector, ${getKnowledgeEmbeddingModelId()},
        ${input.revision.checksum}, ${validUntil}, now(), now()
      )
      ON CONFLICT (id) DO UPDATE SET
        source_type=EXCLUDED.source_type, source_ref=EXCLUDED.source_ref,
        title=EXCLUDED.title, section_heading=EXCLUDED.section_heading,
        content=EXCLUDED.content, answer_scope=EXCLUDED.answer_scope,
        risk_level=EXCLUDED.risk_level, status='ARCHIVED', source_urls=EXCLUDED.source_urls,
        metadata=EXCLUDED.metadata, search_text=EXCLUDED.search_text,
        search_document=EXCLUDED.search_document, embedding=EXCLUDED.embedding,
        embedding_model=EXCLUDED.embedding_model,
        embedding_source_hash=EXCLUDED.embedding_source_hash,
        valid_until=EXCLUDED.valid_until,
        embedded_at=EXCLUDED.embedded_at, updated_at=now()
    `);
  }
  return chunks.map((chunk) => chunk.id);
}

async function assertKnowledgePublishQuality(input: {
  id: string;
  sourceId: string;
  title: string;
  content: unknown;
  ragEnabled: boolean;
  sourceUrls: unknown;
  source: { type: "ARTICLE" | "FAQ" | "POLICY" };
}): Promise<void> {
  const content = parseKnowledgeContent(input.content);
  const sourceUrls = Array.isArray(input.sourceUrls)
    ? input.sourceUrls.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const issues = assessKnowledgeQuality({
    type: input.source.type,
    content,
    ragEnabled: input.ragEnabled,
    sourceUrls,
  });
  const ownerUserId = content.governance?.ownerUserId;
  if (ownerUserId) {
    const owner = await db.user.findFirst({
      where: { id: ownerUserId, isActive: true },
      select: { id: true },
    });
    if (!owner) {
      issues.unshift({
        code: "OWNER_MISSING",
        severity: "BLOCKING",
        message: "ผู้รับผิดชอบเนื้อหาไม่ได้อยู่ในสถานะใช้งาน",
      });
    }
  }
  const otherSources = await db.knowledgeSource.findMany({
    where: { id: { not: input.sourceId }, isArchived: false },
    select: {
      id: true,
      revisions: {
        orderBy: { revisionNo: "desc" },
        take: 1,
        select: { title: true, content: true },
      },
    },
  });
  issues.push(
    ...findKnowledgeDuplicateIssues({
      sourceId: input.sourceId,
      title: input.title,
      intro: content.intro,
      others: otherSources.flatMap((source) => {
        const revision = source.revisions[0];
        if (!revision) return [];
        try {
          return [
            {
              sourceId: source.id,
              title: revision.title,
              intro: parseKnowledgeContent(revision.content).intro,
            },
          ];
        } catch {
          return [];
        }
      }),
    }),
  );
  if (issues[0]) {
    throw new Error(`KNOWLEDGE_QUALITY_GATE:${issues[0].code}`);
  }
}

export async function publishKnowledgeRevision(jobId: string): Promise<void> {
  const job = await db.knowledgeSyncJob.findUnique({
    where: { id: jobId },
    include: { revision: { include: { source: true } } },
  });
  if (!job) throw new Error("KNOWLEDGE_SYNC_JOB_NOT_FOUND");
  if (!(job.status === KnowledgeSyncJobStatus.PENDING || job.status === KnowledgeSyncJobStatus.FAILED)) return;

  const claimed = await db.knowledgeSyncJob.updateMany({
    where: { id: job.id, status: { in: [KnowledgeSyncJobStatus.PENDING, KnowledgeSyncJobStatus.FAILED] } },
    data: {
      status: KnowledgeSyncJobStatus.RUNNING,
      startedAt: new Date(),
      finishedAt: null,
      lastError: null,
      attemptCount: { increment: 1 },
    },
  });
  if (claimed.count !== 1) return;

  try {
    await assertKnowledgePublishQuality(job.revision);
    const stagedIds = await stageChunks({
      source: job.revision.source,
      revision: job.revision,
    });
    await db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        UPDATE knowledge_documents
        SET status='ARCHIVED', updated_at=now()
        WHERE metadata->>'cmsSourceId' = ${job.revision.sourceId}
      `);
      if (stagedIds.length > 0) {
        await tx.$executeRaw(Prisma.sql`
          UPDATE knowledge_documents
          SET status='APPROVED', updated_at=now()
          WHERE id = ANY(${stagedIds}::text[])
        `);
      }
      await tx.knowledgeRevision.updateMany({
        where: { sourceId: job.revision.sourceId, status: KnowledgeRevisionStatus.ACTIVE },
        data: { status: KnowledgeRevisionStatus.ARCHIVED },
      });
      await tx.knowledgeRevision.update({
        where: { id: job.revisionId },
        data: { status: KnowledgeRevisionStatus.ACTIVE, activatedAt: new Date(), syncError: null },
      });
      await tx.knowledgeSource.update({
        where: { id: job.revision.sourceId },
        data: { activeRevisionId: job.revisionId, isArchived: false },
      });
      await tx.knowledgeSyncJob.update({
        where: { id: job.id },
        data: { status: KnowledgeSyncJobStatus.SUCCEEDED, finishedAt: new Date(), lastError: null },
      });
      await tx.knowledgeAuditLog.create({
        data: {
          sourceId: job.revision.sourceId,
          revisionId: job.revisionId,
          actorUserId: job.triggeredByUserId,
          action: "PUBLISHED",
          detail: `เผยแพร่ revision ${job.revision.revisionNo} และเปิดใช้ ${stagedIds.length} AI chunks`,
        },
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000);
    await db.$transaction([
      db.knowledgeSyncJob.update({
        where: { id: job.id },
        data: { status: KnowledgeSyncJobStatus.FAILED, finishedAt: new Date(), lastError: message },
      }),
      db.knowledgeRevision.update({
        where: { id: job.revisionId },
        data: { status: KnowledgeRevisionStatus.SYNC_FAILED, syncError: message },
      }),
    ]);
    await notifyKnowledgeRagFailure({
      sourceId: job.revision.sourceId,
      revisionId: job.revisionId,
      jobId: job.id,
      title: job.revision.title,
      failureType: message.startsWith("KNOWLEDGE_QUALITY_GATE:")
        ? "QUALITY_GATE"
        : "SYNC",
      errorCode: message,
    }).catch((notificationError) => {
      console.error("[knowledge-rag] failure notification failed", {
        jobId: job.id,
        errorName:
          notificationError instanceof Error
            ? notificationError.name
            : "UnknownError",
      });
    });
    throw error;
  }
}

export async function processPendingKnowledgePublishJobs(maxJobs = 2): Promise<{ processed: number; failed: number }> {
  const jobs = await db.knowledgeSyncJob.findMany({
    where: {
      status: { in: [KnowledgeSyncJobStatus.PENDING, KnowledgeSyncJobStatus.FAILED] },
      attemptCount: { lt: 5 },
    },
    orderBy: { createdAt: "asc" },
    take: Math.max(1, Math.min(10, maxJobs)),
    select: { id: true },
  });
  let failed = 0;
  for (const job of jobs) {
    try {
      await publishKnowledgeRevision(job.id);
    } catch {
      failed += 1;
    }
  }
  return { processed: jobs.length, failed };
}
