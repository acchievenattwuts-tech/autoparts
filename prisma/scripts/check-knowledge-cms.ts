import { Prisma } from "../../lib/generated/prisma";
import { db } from "../../lib/db";
import { KNOWLEDGE_PERMISSION_KEYS } from "../../lib/access-control";
import { getKnowledgeEmbeddingModelId } from "../../lib/knowledge-embeddings";

async function main() {
  const [activeUsers, fullyGrantedUsers, sources, activeSources, failedRevisions, pendingRevisions, syncJobs, indexRows, productModels, marker] = await Promise.all([
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
    db.$queryRaw<Array<{ cms_approved: number; legacy_approved: number; legacy_archived: number; embedded: number; model: string | null }>>(Prisma.sql`
      SELECT
        count(*) FILTER (WHERE id LIKE 'cms:%' AND status='APPROVED')::int AS cms_approved,
        count(*) FILTER (WHERE id NOT LIKE 'cms:%' AND status='APPROVED')::int AS legacy_approved,
        count(*) FILTER (WHERE id NOT LIKE 'cms:%' AND status='ARCHIVED')::int AS legacy_archived,
        count(*) FILTER (WHERE id LIKE 'cms:%' AND status='APPROVED' AND embedding IS NOT NULL)::int AS embedded,
        max(embedding_model) FILTER (WHERE id LIKE 'cms:%' AND status='APPROVED') AS model
      FROM knowledge_documents
    `),
    db.$queryRaw<Array<{ embedding_model: string; count: number }>>(Prisma.sql`
      SELECT embedding_model, count(*)::int AS count
      FROM product_search_documents WHERE embedding IS NOT NULL
      GROUP BY embedding_model ORDER BY embedding_model
    `),
    db.knowledgeSyncState.findUnique({ where: { id: "cms-active-user-grant-v1" } }),
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
  };
  console.log(summary);

  const index = indexRows[0];
  if (!marker) throw new Error("KNOWLEDGE_PERMISSION_SNAPSHOT_MARKER_MISSING");
  if ((fullyGrantedUsers[0]?.count ?? 0) !== activeUsers) throw new Error("ACTIVE_USER_KNOWLEDGE_GRANTS_INCOMPLETE");
  if (sources === 0 || sources !== activeSources) throw new Error("KNOWLEDGE_SOURCES_NOT_ALL_ACTIVE");
  if (failedRevisions > 0 || pendingRevisions > 0) throw new Error("KNOWLEDGE_REVISION_HEALTH_FAILED");
  if (!index || index.cms_approved === 0 || index.cms_approved !== index.embedded) throw new Error("KNOWLEDGE_CMS_INDEX_INCOMPLETE");
  if (index.legacy_approved !== 0) throw new Error("LEGACY_KNOWLEDGE_INDEX_STILL_ACTIVE");
  if (index.model !== getKnowledgeEmbeddingModelId()) throw new Error("KNOWLEDGE_CMS_MODEL_MISMATCH");
  if (productModels.some((row) => row.embedding_model === getKnowledgeEmbeddingModelId())) throw new Error("KNOWLEDGE_MODEL_LEAKED_INTO_PRODUCT_INDEX");
}

main().finally(() => db.$disconnect());
