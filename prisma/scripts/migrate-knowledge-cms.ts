import { KnowledgeRevisionStatus, Prisma } from "../../lib/generated/prisma";
import { db } from "../../lib/db";
import { ensureAccessControlSetup } from "../../lib/access-control";
import { getKnowledgeCmsSeedEntries } from "../../lib/knowledge-cms-seed";
import { buildKnowledgeRevisionChecksum } from "../../lib/knowledge-cms-types";
import { publishKnowledgeRevision } from "../../lib/knowledge-cms-publish";

const knowledgePermissionKeys = [
  "knowledge.view",
  "knowledge.create",
  "knowledge.update",
  "knowledge.approve",
  "knowledge.sync",
  "knowledge.archive",
] as const;

async function main() {
  await ensureAccessControlSetup();
  const actor = await db.user.findFirst({ where: { isActive: true }, orderBy: [{ role: "asc" }, { createdAt: "asc" }] });
  if (!actor) throw new Error("No active user is available for the Knowledge CMS migration.");

  const grantMarkerId = "cms-active-user-grant-v1";
  const grantMarker = await db.knowledgeSyncState.findUnique({ where: { id: grantMarkerId } });
  let activeUsersGranted = 0;
  if (!grantMarker) {
    const permissions = await db.permission.findMany({ where: { key: { in: [...knowledgePermissionKeys] } }, select: { id: true } });
    const activeUsers = await db.user.findMany({ where: { isActive: true }, select: { id: true } });
    await db.$transaction([
      db.userPermissionGrant.createMany({
        data: activeUsers.flatMap((user) => permissions.map((permission) => ({ userId: user.id, permissionId: permission.id }))),
        skipDuplicates: true,
      }),
      db.knowledgeSyncState.create({ data: { id: grantMarkerId, lastSuccessAt: new Date(), runCount: 1 } }),
    ]);
    activeUsersGranted = activeUsers.length;
  }

  let imported = 0;
  let skipped = 0;
  let failed = 0;
  for (const entry of getKnowledgeCmsSeedEntries()) {
    const existing = await db.knowledgeSource.findUnique({ where: { sourceKey: entry.sourceKey } });
    if (existing) {
      skipped += 1;
      continue;
    }
    const checksum = buildKnowledgeRevisionChecksum(entry);
    const source = await db.knowledgeSource.create({
      data: {
        sourceKey: entry.sourceKey,
        type: entry.type,
        slug: entry.slug,
        createdByUserId: actor.id,
        revisions: {
          create: {
            revisionNo: 1,
            title: entry.title,
            description: entry.description,
            category: entry.category,
            content: entry.content,
            answerScope: entry.answerScope,
            riskLevel: entry.riskLevel,
            ragEnabled: entry.ragEnabled,
            sourceUrls: entry.sourceUrls,
            checksum,
            status: KnowledgeRevisionStatus.SYNCING,
            createdByUserId: actor.id,
            submittedByUserId: actor.id,
            approvedByUserId: actor.id,
            submittedAt: new Date(),
            approvedAt: new Date(),
          },
        },
      },
      include: { revisions: true },
    });
    const revision = source.revisions[0];
    if (!revision) throw new Error(`Revision missing for ${entry.sourceKey}`);
    const job = await db.knowledgeSyncJob.create({ data: { revisionId: revision.id, trigger: "INITIAL_IMPORT", triggeredByUserId: actor.id } });
    try {
      await publishKnowledgeRevision(job.id);
      imported += 1;
    } catch (error) {
      failed += 1;
      console.error(`Failed to import ${entry.sourceKey}:`, error instanceof Error ? error.message : error);
    }
  }

  if (failed === 0) {
    await db.$executeRaw(Prisma.sql`
      UPDATE knowledge_documents
      SET status='ARCHIVED', updated_at=now()
      WHERE id NOT LIKE 'cms:%' AND status='APPROVED'
    `);
  }
  console.log({ activeUsersGranted, permissionSnapshotAlreadyApplied: Boolean(grantMarker), imported, skipped, failed });
  if (failed > 0) process.exitCode = 1;
}

main().finally(() => db.$disconnect());
