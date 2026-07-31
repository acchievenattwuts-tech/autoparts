import { Prisma } from "../../lib/generated/prisma";
import { db } from "../../lib/db";
import { KNOWLEDGE_PERMISSION_KEYS } from "../../lib/access-control";
import { getKnowledgeEmbeddingModelId } from "../../lib/knowledge-embeddings";
import {
  assessKnowledgeQuality,
  findKnowledgeDuplicateIssues,
} from "../../lib/knowledge-cms-quality";
import { parseKnowledgeContent } from "../../lib/knowledge-cms-types";

async function main() {
  const [activeUsers, fullyGrantedUsers, sources, activeSources, failedRevisions, pendingRevisions, syncJobs, indexRows, productModels, marker, inventory, operationalMetrics, feedbackCount, gapCounts] = await Promise.all([
    db.user.count({ where: { isActive: true } }),
    db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      SELECT count(*)::int AS count FROM (
        SELECT upg."userId"
        FROM "UserPermissionGrant" upg
        JOIN "Permission" p ON p.id = upg."permissionId"
        JOIN "User" u ON u.id = upg."userId"
        WHERE u."isActive" = true AND p.key = ANY(${[...KNOWLEDGE_PERMISSION_KEYS]}::text[])
        GROUP BY upg."userId"
        HAVING count(DISTINCT p.key) = ${KNOWLEDGE_PERMISSION_KEYS.length}
      ) granted
    `),
    db.knowledgeSource.count(),
    db.knowledgeSource.count({ where: { isArchived: false, activeRevisionId: { not: null } } }),
    db.knowledgeRevision.count({ where: { status: "SYNC_FAILED" } }),
    db.knowledgeRevision.count({ where: { status: { in: ["PENDING_APPROVAL", "SYNCING"] } } }),
    db.knowledgeSyncJob.groupBy({ by: ["status"], _count: { _all: true } }),
    db.$queryRaw<Array<{ cms_approved: number; legacy_approved: number; legacy_archived: number; embedded: number; missing_expiry: number; expired: number; forbidden_approved: number; model: string | null }>>(Prisma.sql`
      SELECT
        count(*) FILTER (WHERE id LIKE 'cms:%' AND status='APPROVED')::int AS cms_approved,
        count(*) FILTER (WHERE id NOT LIKE 'cms:%' AND status='APPROVED')::int AS legacy_approved,
        count(*) FILTER (WHERE id NOT LIKE 'cms:%' AND status='ARCHIVED')::int AS legacy_archived,
        count(*) FILTER (WHERE id LIKE 'cms:%' AND status='APPROVED' AND embedding IS NOT NULL)::int AS embedded,
        count(*) FILTER (WHERE id LIKE 'cms:%' AND status='APPROVED' AND valid_until IS NULL)::int AS missing_expiry,
        count(*) FILTER (WHERE id LIKE 'cms:%' AND status='APPROVED' AND valid_until <= now())::int AS expired,
        count(*) FILTER (
          WHERE status='APPROVED' AND source_ref IN (
            'policy:return-warranty',
            'faq:storefront:6',
            'faq:storefront:7',
            'faq:storefront:11',
            'faq:storefront:12'
          )
        )::int AS forbidden_approved,
        max(embedding_model) FILTER (WHERE id LIKE 'cms:%' AND status='APPROVED') AS model
      FROM knowledge_documents
    `),
    db.$queryRaw<Array<{ embedding_model: string; count: number }>>(Prisma.sql`
      SELECT embedding_model, count(*)::int AS count
      FROM product_search_documents WHERE embedding IS NOT NULL
      GROUP BY embedding_model ORDER BY embedding_model
    `),
    db.knowledgeSyncState.findUnique({ where: { id: "cms-active-user-grant-v1" } }),
    db.knowledgeSource.findMany({
      where: { isArchived: false, activeRevisionId: { not: null } },
      select: {
        id: true,
        type: true,
        activeRevision: {
          select: {
            title: true,
            content: true,
            ragEnabled: true,
            sourceUrls: true,
          },
        },
      },
    }),
    db.knowledgeRagDailyMetric.count(),
    db.knowledgeRagFeedback.count(),
    db.knowledgeRagGapSignal.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
  ]);
  const inventoryRows = inventory.flatMap((source) => {
    if (!source.activeRevision) return [];
    const content = parseKnowledgeContent(source.activeRevision.content);
    const sourceUrls = Array.isArray(source.activeRevision.sourceUrls)
      ? source.activeRevision.sourceUrls.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    return [{
      sourceId: source.id,
      type: source.type,
      title: source.activeRevision.title,
      intro: content.intro,
      content,
      ragEnabled: source.activeRevision.ragEnabled,
      sourceUrls,
    }];
  });
  const qualityFailures = inventoryRows.flatMap((row) => [
    ...assessKnowledgeQuality(row).map((issue) => ({
      sourceId: row.sourceId,
      code: issue.code,
    })),
    ...findKnowledgeDuplicateIssues({
      sourceId: row.sourceId,
      title: row.title,
      intro: row.intro,
      others: inventoryRows,
    }).map((issue) => ({ sourceId: row.sourceId, code: issue.code })),
  ]);

  const summary = {
    activeUsers,
    fullyGrantedUsers: fullyGrantedUsers[0]?.count ?? 0,
    sources,
    activeSources,
    failedRevisions,
    pendingRevisions,
    syncJobs,
    index: indexRows[0],
    productModels,
    permissionSnapshotMarker: Boolean(marker),
    corpusQuality: {
      checked: inventoryRows.length,
      failures: qualityFailures.length,
      failureCodes: [...new Set(qualityFailures.map((item) => item.code))],
    },
    operations: {
      metricBuckets: operationalMetrics,
      feedback: feedbackCount,
      gaps: gapCounts,
    },
  };
  console.log(summary);

  const index = indexRows[0];
  if (!marker) throw new Error("KNOWLEDGE_PERMISSION_SNAPSHOT_MARKER_MISSING");
  if ((fullyGrantedUsers[0]?.count ?? 0) !== activeUsers) throw new Error("ACTIVE_USER_KNOWLEDGE_GRANTS_INCOMPLETE");
  if (sources === 0 || sources !== activeSources) throw new Error("KNOWLEDGE_SOURCES_NOT_ALL_ACTIVE");
  if (failedRevisions > 0 || pendingRevisions > 0) throw new Error("KNOWLEDGE_REVISION_HEALTH_FAILED");
  if (!index || index.cms_approved === 0 || index.cms_approved !== index.embedded) throw new Error("KNOWLEDGE_CMS_INDEX_INCOMPLETE");
  if (index.legacy_approved !== 0) throw new Error("LEGACY_KNOWLEDGE_INDEX_STILL_ACTIVE");
  if (index.missing_expiry !== 0 || index.expired !== 0) throw new Error("KNOWLEDGE_DOCUMENT_EXPIRY_INVALID");
  if (index.forbidden_approved !== 0) throw new Error("ADMIN_ONLY_KNOWLEDGE_STILL_APPROVED");
  if (index.model !== getKnowledgeEmbeddingModelId()) throw new Error("KNOWLEDGE_CMS_MODEL_MISMATCH");
  if (productModels.some((row) => row.embedding_model === getKnowledgeEmbeddingModelId())) throw new Error("KNOWLEDGE_MODEL_LEAKED_INTO_PRODUCT_INDEX");
  if (qualityFailures.length > 0) throw new Error("KNOWLEDGE_CORPUS_QUALITY_GATE_FAILED");
}

main().finally(() => db.$disconnect());
