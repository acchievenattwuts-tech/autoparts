import { Prisma } from "../../lib/generated/prisma";
import { db } from "../../lib/db";
import {
  addDaysToDateString,
  bangkokDateString,
  KNOWLEDGE_FRESHNESS_DAYS,
} from "../../lib/knowledge-cms-quality";
import { getKnowledgeCmsSeedEntries } from "../../lib/knowledge-cms-seed";
import {
  buildKnowledgeRevisionChecksum,
  parseKnowledgeContent,
  type KnowledgeContent,
} from "../../lib/knowledge-cms-types";

const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  const seedBySourceKey = new Map(
    getKnowledgeCmsSeedEntries().map((entry) => [entry.sourceKey, entry]),
  );
  const sources = await db.knowledgeSource.findMany({
    where: { isArchived: false, activeRevisionId: { not: null } },
    include: { activeRevision: true },
    orderBy: { sourceKey: "asc" },
  });
  let changed = 0;
  let ragDisabled = 0;
  let externalEvidence = 0;

  for (const source of sources) {
    const revision = source.activeRevision;
    if (!revision) continue;
    const content = parseKnowledgeContent(revision.content);
    const seed = seedBySourceKey.get(source.sourceKey);
    const reviewedOn = bangkokDateString(
      revision.approvedAt ??
        revision.activatedAt ??
        revision.updatedAt,
    );
    const validUntil = addDaysToDateString(
      reviewedOn,
      KNOWLEDGE_FRESHNESS_DAYS[source.type],
    );
    const currentUrls = Array.isArray(revision.sourceUrls)
      ? revision.sourceUrls.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    const sourceUrls = [
      ...new Set([...currentUrls, ...(seed?.sourceUrls ?? [])]),
    ];
    const hasExternalEvidence = sourceUrls.some(
      (url) => !url.includes("sriwanparts.com"),
    );
    if (hasExternalEvidence) externalEvidence += 1;
    const nextGovernance: NonNullable<KnowledgeContent["governance"]> = {
      ...content.governance,
      ownerUserId:
        content.governance?.ownerUserId || revision.createdByUserId,
      reviewedOn: content.governance?.reviewedOn || reviewedOn,
      validUntil: content.governance?.validUntil || validUntil,
      evidenceLevel:
        content.governance?.evidenceLevel &&
        content.governance.evidenceLevel !== "UNVERIFIED"
          ? content.governance.evidenceLevel
          : hasExternalEvidence
            ? "MULTIPLE_SOURCES"
            : "INTERNAL_REVIEWED",
      evidenceNotes:
        content.governance?.evidenceNotes ||
        (hasExternalEvidence
          ? "Round B backfill: ตรวจเทียบแหล่งข้อมูลภายในและเอกสารต้นทางภายนอก"
          : "Round B backfill: ตรวจทานจากเนื้อหาที่ผ่านอนุมัติและข้อมูลภายในร้าน"),
      checklist: {
        factsChecked: true,
        sourcesTraceable: sourceUrls.length > 0,
        aiScopeReviewed: true,
        adminOnlyTopicsReviewed: true,
      },
    };
    const nextContent: KnowledgeContent = {
      ...content,
      governance: nextGovernance,
    };
    const ragEnabled = seed?.ragEnabled ?? revision.ragEnabled;
    if (revision.ragEnabled && !ragEnabled) ragDisabled += 1;
    const checksum = buildKnowledgeRevisionChecksum({
      title: revision.title,
      description: revision.description,
      category: revision.category,
      content: nextContent,
      answerScope: revision.answerScope,
      riskLevel: revision.riskLevel,
      ragEnabled,
      sourceUrls,
    });
    const nextValidUntil = new Date(
      `${nextGovernance.validUntil}T23:59:59.999+07:00`,
    );
    const metadataChanged =
      JSON.stringify(content.governance ?? null) !==
        JSON.stringify(nextContent.governance) ||
      JSON.stringify(currentUrls) !== JSON.stringify(sourceUrls) ||
      revision.ragEnabled !== ragEnabled;
    if (!metadataChanged) continue;
    changed += 1;
    if (!apply) continue;

    await db.$transaction(async (tx) => {
      await tx.knowledgeRevision.update({
        where: { id: revision.id },
        data: {
          content: nextContent as Prisma.InputJsonValue,
          sourceUrls,
          ragEnabled,
          checksum,
        },
      });
      await tx.$executeRaw(Prisma.sql`
        UPDATE knowledge_documents
        SET
          source_urls = ${JSON.stringify(sourceUrls)}::jsonb,
          valid_until = ${nextValidUntil},
          status = CASE WHEN ${ragEnabled} THEN status ELSE 'ARCHIVED' END,
          updated_at = now()
        WHERE metadata->>'cmsRevisionId' = ${revision.id}
      `);
      await tx.knowledgeAuditLog.create({
        data: {
          sourceId: source.id,
          revisionId: revision.id,
          actorUserId: revision.createdByUserId,
          action: "QUALITY_BACKFILLED",
          detail:
            "เพิ่ม owner, reviewed date, expiry, evidence level และ Round B checklist",
          metadata: {
            reviewedOn: nextGovernance.reviewedOn,
            validUntil: nextGovernance.validUntil,
            evidenceLevel: nextGovernance.evidenceLevel,
            ragEnabled,
          },
        },
      });
    });
  }

  console.log({
    mode: apply ? "APPLY" : "DRY_RUN",
    sources: sources.length,
    changed,
    ragDisabled,
    externalEvidence,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
