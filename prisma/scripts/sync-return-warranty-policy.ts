import { KnowledgeRevisionStatus, Prisma } from "../../lib/generated/prisma";
import { db } from "../../lib/db";
import { getLegacyPolicySeedEntry } from "../../lib/knowledge-cms-seed";
import { buildKnowledgeRevisionChecksum } from "../../lib/knowledge-cms-types";
import { publishKnowledgeRevision } from "../../lib/knowledge-cms-publish";

/**
 * Republishes the return/warranty policy from the code seed.
 *
 * The storefront page reads the ACTIVE KnowledgeRevision first and only falls
 * back to the seed, so editing `lib/knowledge-cms-seed.ts` alone does not
 * change what customers see once `migrate:knowledge-cms` has run. This script
 * creates the next revision from the seed and publishes it through the normal
 * sync job, so quality gates and the CMS audit trail still apply.
 */
async function resolveOwnerUserId(currentOwnerUserId: string | undefined): Promise<string> {
  if (currentOwnerUserId) {
    const owner = await db.user.findFirst({ where: { id: currentOwnerUserId, isActive: true }, select: { id: true } });
    if (owner) return owner.id;
  }
  const fallback = await db.user.findFirst({
    where: { isActive: true },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (!fallback) throw new Error("No active user is available to own the policy revision.");
  return fallback.id;
}

async function main(): Promise<void> {
  const entry = getLegacyPolicySeedEntry();
  const source = await db.knowledgeSource.findUnique({
    where: { sourceKey: entry.sourceKey },
    include: {
      activeRevision: true,
      revisions: { orderBy: { revisionNo: "desc" }, take: 1 },
    },
  });
  if (!source) {
    throw new Error(`Knowledge source ${entry.sourceKey} not found. Run "npm run migrate:knowledge-cms" first.`);
  }

  const currentGovernanceOwner =
    entry.content.governance?.ownerUserId ??
    (source.activeRevision?.content as { governance?: { ownerUserId?: string } } | null)?.governance?.ownerUserId;
  const ownerUserId = await resolveOwnerUserId(currentGovernanceOwner);

  const content = {
    ...entry.content,
    governance: { ...entry.content.governance, ownerUserId },
  };
  const checksum = buildKnowledgeRevisionChecksum({ ...entry, content });
  if (source.activeRevision?.checksum === checksum) {
    console.log({ sourceKey: entry.sourceKey, skipped: true, reason: "ACTIVE_REVISION_ALREADY_MATCHES_SEED" });
    return;
  }

  const revisionNo = (source.revisions[0]?.revisionNo ?? source.activeRevision?.revisionNo ?? 0) + 1;
  const now = new Date();
  const job = await db.$transaction(async (tx) => {
    const revision = await tx.knowledgeRevision.create({
      data: {
        sourceId: source.id,
        revisionNo,
        title: entry.title,
        description: entry.description,
        category: entry.category,
        content: content as unknown as Prisma.InputJsonValue,
        answerScope: entry.answerScope,
        riskLevel: entry.riskLevel,
        ragEnabled: entry.ragEnabled,
        sourceUrls: entry.sourceUrls as unknown as Prisma.InputJsonValue,
        checksum,
        status: KnowledgeRevisionStatus.SYNCING,
        createdByUserId: ownerUserId,
        submittedByUserId: ownerUserId,
        approvedByUserId: ownerUserId,
        submittedAt: now,
        approvedAt: now,
      },
    });
    await tx.knowledgeAuditLog.create({
      data: {
        sourceId: source.id,
        revisionId: revision.id,
        actorUserId: ownerUserId,
        action: "REVISION_CREATED",
        detail: `สร้าง revision ${revisionNo} จากเอกสารเงื่อนไขการรับประกันสินค้า (seed sync)`,
      },
    });
    return tx.knowledgeSyncJob.create({ data: { revisionId: revision.id, trigger: "SEED_POLICY_SYNC", triggeredByUserId: ownerUserId } });
  });

  await publishKnowledgeRevision(job.id);
  const published = await db.knowledgeRevision.findUnique({
    where: { id: job.revisionId },
    select: { revisionNo: true, status: true, syncError: true },
  });
  console.log({ sourceKey: entry.sourceKey, ...published });
  if (published?.status !== KnowledgeRevisionStatus.ACTIVE) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
