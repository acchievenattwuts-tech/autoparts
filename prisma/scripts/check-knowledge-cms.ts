import { Prisma } from "../../lib/generated/prisma";
import { db } from "../../lib/db";
import {
  isKnowledgeAdminOnlyPermission,
  isKnowledgeAdminUser,
  KNOWLEDGE_PERMISSION_KEYS,
  resolveUserPermissionKeys,
} from "../../lib/access-control";
import { getKnowledgeEmbeddingModelId } from "../../lib/knowledge-embeddings";
import {
  assessKnowledgeQuality,
  findKnowledgeDuplicateIssues,
} from "../../lib/knowledge-cms-quality";
import { parseKnowledgeContent } from "../../lib/knowledge-cms-types";

async function main() {
  const [activeUsers, activeUserAccess, sources, activeSources, failedRevisions, pendingRevisions, syncJobs, indexRows, productModels, marker, inventory, operationalMetrics, feedbackCount, gapCounts] = await Promise.all([
    db.user.count({ where: { isActive: true } }),
    // Effective permissions are resolved exactly like login: app role + direct
    // grants, and for a legacy ADMIN every key but knowledge (direct grants only).
    db.user.findMany({
      where: { isActive: true },
      select: {
        role: true,
        appRole: { select: { name: true, permissions: { select: { permission: { select: { key: true } } } } } },
        directPermissionGrants: { select: { permission: { select: { key: true } } } },
      },
    }),
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

  const userAccess = activeUserAccess.map((user) => ({
    isKnowledgeAdmin: isKnowledgeAdminUser({ role: user.role, appRoleName: user.appRole?.name }),
    permissions: resolveUserPermissionKeys({
      role: user.role,
      appRolePermissionKeys: user.appRole?.permissions.map((item) => item.permission.key) ?? [],
      directPermissionKeys: user.directPermissionGrants.map((item) => item.permission.key),
    }),
  }));
  const fullyGrantedAdmins = userAccess.filter(
    (user) => user.isKnowledgeAdmin && KNOWLEDGE_PERMISSION_KEYS.every((key) => user.permissions.includes(key)),
  ).length;
  // Informational: non-admins whose effective permissions still include
  // approve/sync/archive (prisma/scripts/revoke-staff-knowledge-approve.ts lists them).
  const nonAdminsWithAdminOnlyKnowledge = userAccess.filter(
    (user) => !user.isKnowledgeAdmin && user.permissions.some(isKnowledgeAdminOnlyPermission),
  ).length;

  const summary = {
    activeUsers,
    fullyGrantedAdmins,
    nonAdminsWithAdminOnlyKnowledge,
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
  // approve/sync/archive belong to knowledge admins (app role ADMIN, or legacy ADMIN
  // without an app role); the CMS stays operable while at least one active knowledge
  // admin holds the full set. Per-user access is managed on the users page.
  if (fullyGrantedAdmins < 1) throw new Error("NO_ACTIVE_ADMIN_WITH_FULL_KNOWLEDGE_GRANTS");
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
