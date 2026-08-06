"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma, KnowledgeApprovalStatus, KnowledgeRevisionStatus } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import {
  buildKnowledgeRevisionChecksum,
  knowledgeContentSchema,
} from "@/lib/knowledge-cms-types";
import { publishKnowledgeRevision } from "@/lib/knowledge-cms-publish";
import { requirePermission } from "@/lib/require-auth";
import { answerFromKnowledgeRag, retrieveKnowledgeDocuments } from "@/lib/chat-core/knowledge-rag";
import { knowledgeRagPolicyError } from "@/lib/chat-core/admin-only-knowledge";
import {
  assessKnowledgeQuality,
  findKnowledgeDuplicateIssues,
} from "@/lib/knowledge-cms-quality";
import { hashKnowledgeRagQuery } from "@/lib/knowledge-rag-telemetry";

export type KnowledgeActionState = { success?: boolean; id?: string; error?: string };

const sourceSchema = z.object({
  type: z.enum(["ARTICLE", "FAQ", "POLICY"]),
  slug: z.string().trim().max(180).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug ใช้ได้เฉพาะ a-z, 0-9 และขีดกลาง").or(z.literal("")),
  title: z.string().trim().min(3, "กรุณาระบุชื่อเรื่อง").max(240),
  description: z.string().trim().max(1_000).optional(),
  category: z.string().trim().max(120).optional(),
  content: knowledgeContentSchema,
  answerScope: z.string().trim().min(10, "กรุณาระบุขอบเขตคำตอบ AI").max(3_000),
  riskLevel: z.enum(["LOW", "MEDIUM"]),
  ragEnabled: z.boolean(),
  sourceUrls: z.array(z.string().url("URL แหล่งอ้างอิงไม่ถูกต้อง")).max(20),
  expectedUpdatedAt: z.string().datetime().optional(),
});

function readPayload(formData: FormData) {
  let content: unknown;
  let sourceUrls: unknown;
  try {
    content = JSON.parse(String(formData.get("content") ?? "{}"));
    sourceUrls = JSON.parse(String(formData.get("sourceUrls") ?? "[]"));
  } catch {
    return { success: false as const, error: "รูปแบบข้อมูลเนื้อหาไม่ถูกต้อง" };
  }
  const parsed = sourceSchema.safeParse({
    type: formData.get("type"),
    slug: formData.get("slug") ?? "",
    title: formData.get("title"),
    description: formData.get("description") || undefined,
    category: formData.get("category") || undefined,
    content,
    answerScope: formData.get("answerScope"),
    riskLevel: formData.get("riskLevel"),
    ragEnabled: formData.get("ragEnabled") === "true",
    sourceUrls,
    expectedUpdatedAt: formData.get("expectedUpdatedAt") || undefined,
  });
  if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  if (parsed.data.type === "ARTICLE" && !parsed.data.slug) {
    return { success: false as const, error: "บทความต้องมี slug สำหรับ URL หน้าเว็บ" };
  }
  const policyError = knowledgeRagPolicyError(parsed.data);
  if (policyError) return { success: false as const, error: policyError };
  return { success: true as const, data: parsed.data };
}

function storedRevisionPolicyError(revision: {
  title: string;
  description: string | null;
  content: unknown;
  ragEnabled: boolean;
}): string | null {
  const content = knowledgeContentSchema.safeParse(revision.content);
  if (!content.success) return "รูปแบบข้อมูลเนื้อหาไม่ถูกต้อง";
  return knowledgeRagPolicyError({
    title: revision.title,
    description: revision.description,
    content: content.data,
    ragEnabled: revision.ragEnabled,
  });
}

async function storedRevisionQualityError(revision: {
  id: string;
  sourceId: string;
  title: string;
  content: unknown;
  ragEnabled: boolean;
  sourceUrls: unknown;
  source: { type: "ARTICLE" | "FAQ" | "POLICY" };
}): Promise<string | null> {
  const parsedContent = knowledgeContentSchema.safeParse(revision.content);
  if (!parsedContent.success) return "รูปแบบข้อมูลเนื้อหาไม่ถูกต้อง";
  const sourceUrls = Array.isArray(revision.sourceUrls)
    ? revision.sourceUrls.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const qualityIssues = assessKnowledgeQuality({
    type: revision.source.type,
    content: parsedContent.data,
    ragEnabled: revision.ragEnabled,
    sourceUrls,
  });
  const ownerUserId = parsedContent.data.governance?.ownerUserId;
  if (ownerUserId) {
    const owner = await db.user.findFirst({
      where: { id: ownerUserId, isActive: true },
      select: { id: true },
    });
    if (!owner) {
      qualityIssues.unshift({
        code: "OWNER_MISSING",
        severity: "BLOCKING",
        message: "ผู้รับผิดชอบเนื้อหาต้องเป็นผู้ใช้ที่มีสถานะใช้งาน",
      });
    }
  }

  const otherSources = await db.knowledgeSource.findMany({
    where: { id: { not: revision.sourceId }, isArchived: false },
    select: {
      id: true,
      revisions: {
        orderBy: { revisionNo: "desc" },
        take: 1,
        select: { title: true, content: true },
      },
    },
  });
  const duplicateIssues = findKnowledgeDuplicateIssues({
    sourceId: revision.sourceId,
    title: revision.title,
    intro: parsedContent.data.intro,
    others: otherSources.flatMap((source) => {
      const otherRevision = source.revisions[0];
      if (!otherRevision) return [];
      const otherContent = knowledgeContentSchema.safeParse(
        otherRevision.content,
      );
      if (!otherContent.success) return [];
      return [
        {
          sourceId: source.id,
          title: otherRevision.title,
          intro: otherContent.data.intro,
        },
      ];
    }),
  });
  return [...qualityIssues, ...duplicateIssues][0]?.message ?? null;
}

function revalidateKnowledge(sourceSlug?: string | null) {
  revalidatePath("/admin/knowledge");
  revalidatePath("/admin/knowledge/approval");
  revalidatePath("/admin/knowledge/sync");
  revalidatePath("/admin/knowledge/quality");
  revalidatePath("/knowledge");
  revalidatePath("/faq");
  revalidatePath("/return-warranty-policy");
  revalidatePath("/sitemap.xml");
  if (sourceSlug) revalidatePath(`/knowledge/${sourceSlug}`);
}

export async function createKnowledgeDraft(formData: FormData): Promise<KnowledgeActionState> {
  const session = await requirePermission("knowledge.create");
  const payload = readPayload(formData);
  if (!payload.success) return { error: payload.error };
  const data = payload.data;
  const sourceKey = `${data.type.toLowerCase()}:${data.slug || randomUUID()}`;
  const checksum = buildKnowledgeRevisionChecksum(data);
  try {
    const source = await db.knowledgeSource.create({
      data: {
        sourceKey,
        type: data.type,
        slug: data.slug || null,
        createdByUserId: session.user.id,
        revisions: {
          create: {
            revisionNo: 1,
            title: data.title,
            description: data.description || null,
            category: data.category || null,
            content: data.content,
            answerScope: data.answerScope,
            riskLevel: data.riskLevel,
            ragEnabled: data.ragEnabled,
            sourceUrls: data.sourceUrls,
            checksum,
            createdByUserId: session.user.id,
          },
        },
      },
      include: { revisions: { orderBy: { revisionNo: "desc" }, take: 1 } },
    });
    const revision = source.revisions[0];
    if (revision) {
      await db.knowledgeAuditLog.create({
        data: { sourceId: source.id, revisionId: revision.id, actorUserId: session.user.id, action: "CREATED" },
      });
    }
    revalidateKnowledge(source.slug);
    return { success: true, id: source.id };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "Slug หรือรหัสแหล่งข้อมูลนี้มีอยู่แล้ว" };
    }
    console.error("[createKnowledgeDraft]", error);
    return { error: "สร้างร่างไม่สำเร็จ กรุณาลองใหม่" };
  }
}

export async function updateKnowledgeDraft(revisionId: string, formData: FormData): Promise<KnowledgeActionState> {
  const session = await requirePermission("knowledge.update");
  const payload = readPayload(formData);
  if (!payload.success) return { error: payload.error };
  const existing = await db.knowledgeRevision.findUnique({ where: { id: revisionId }, include: { source: true } });
  if (!existing) return { error: "ไม่พบ revision" };
  if (!(existing.status === KnowledgeRevisionStatus.DRAFT || existing.status === KnowledgeRevisionStatus.REJECTED || existing.status === KnowledgeRevisionStatus.SYNC_FAILED)) {
    return { error: "สถานะปัจจุบันไม่อนุญาตให้แก้ไข กรุณาสร้าง revision ใหม่" };
  }
  if (payload.data.expectedUpdatedAt && existing.updatedAt.toISOString() !== payload.data.expectedUpdatedAt) {
    return { error: "มีผู้ใช้อื่นแก้ไขข้อมูลนี้แล้ว กรุณารีเฟรชหน้าเพื่อตรวจสอบเวอร์ชันล่าสุด" };
  }
  const checksum = buildKnowledgeRevisionChecksum(payload.data);
  try {
    await db.$transaction([
      db.knowledgeRevision.update({
        where: { id: revisionId },
        data: {
          title: payload.data.title,
          description: payload.data.description || null,
          category: payload.data.category || null,
          content: payload.data.content,
          answerScope: payload.data.answerScope,
          riskLevel: payload.data.riskLevel,
          ragEnabled: payload.data.ragEnabled,
          sourceUrls: payload.data.sourceUrls,
          checksum,
          status: KnowledgeRevisionStatus.DRAFT,
          rejectionReason: null,
          syncError: null,
        },
      }),
      db.knowledgeAuditLog.create({
        data: { sourceId: existing.sourceId, revisionId, actorUserId: session.user.id, action: "UPDATED" },
      }),
    ]);
    revalidateKnowledge(existing.source.slug);
    return { success: true, id: existing.sourceId };
  } catch (error) {
    console.error("[updateKnowledgeDraft]", error);
    return { error: "บันทึกร่างไม่สำเร็จ กรุณาลองใหม่" };
  }
}

export async function createKnowledgeRevision(sourceId: string): Promise<KnowledgeActionState> {
  const session = await requirePermission("knowledge.update");
  const source = await db.knowledgeSource.findUnique({ where: { id: sourceId }, include: { activeRevision: true, revisions: { orderBy: { revisionNo: "desc" }, take: 1 } } });
  if (!source?.activeRevision) return { error: "ไม่พบเวอร์ชันที่กำลังใช้งาน" };
  const existingDraft = await db.knowledgeRevision.findFirst({
    where: { sourceId, status: { in: [KnowledgeRevisionStatus.DRAFT, KnowledgeRevisionStatus.REJECTED, KnowledgeRevisionStatus.SYNC_FAILED] } },
    orderBy: { revisionNo: "desc" },
  });
  if (existingDraft) return { success: true, id: sourceId };
  const revisionNo = (source.revisions[0]?.revisionNo ?? source.activeRevision.revisionNo) + 1;
  const revision = await db.knowledgeRevision.create({
    data: {
      sourceId,
      revisionNo,
      title: source.activeRevision.title,
      description: source.activeRevision.description,
      category: source.activeRevision.category,
      content: source.activeRevision.content as Prisma.InputJsonValue,
      answerScope: source.activeRevision.answerScope,
      riskLevel: source.activeRevision.riskLevel,
      ragEnabled: source.activeRevision.ragEnabled,
      sourceUrls: (source.activeRevision.sourceUrls ?? []) as Prisma.InputJsonValue,
      checksum: source.activeRevision.checksum,
      createdByUserId: session.user.id,
    },
  });
  await db.knowledgeAuditLog.create({ data: { sourceId, revisionId: revision.id, actorUserId: session.user.id, action: "REVISION_CREATED" } });
  revalidateKnowledge(source.slug);
  return { success: true, id: sourceId };
}

export async function submitKnowledgeForApproval(revisionId: string, note?: string): Promise<KnowledgeActionState> {
  const session = await requirePermission("knowledge.update");
  const revision = await db.knowledgeRevision.findUnique({ where: { id: revisionId }, include: { source: true } });
  if (!revision || !(revision.status === KnowledgeRevisionStatus.DRAFT || revision.status === KnowledgeRevisionStatus.REJECTED || revision.status === KnowledgeRevisionStatus.SYNC_FAILED)) {
    return { error: "revision นี้ไม่สามารถส่งอนุมัติได้" };
  }
  const policyError = storedRevisionPolicyError(revision);
  if (policyError) return { error: policyError };
  const qualityError = await storedRevisionQualityError(revision);
  if (qualityError) return { error: qualityError };
  await db.$transaction([
    db.knowledgeApproval.updateMany({ where: { revisionId, status: KnowledgeApprovalStatus.PENDING }, data: { status: KnowledgeApprovalStatus.CANCELLED, actedAt: new Date() } }),
    db.knowledgeApproval.create({ data: { revisionId, requestedByUserId: session.user.id, requestNote: note?.trim() || null } }),
    db.knowledgeRevision.update({ where: { id: revisionId }, data: { status: KnowledgeRevisionStatus.PENDING_APPROVAL, submittedByUserId: session.user.id, submittedAt: new Date(), rejectionReason: null } }),
    db.knowledgeAuditLog.create({ data: { sourceId: revision.sourceId, revisionId, actorUserId: session.user.id, action: "SUBMITTED" } }),
  ]);
  revalidateKnowledge(revision.source.slug);
  return { success: true, id: revision.sourceId };
}

export async function approveAndPublishKnowledge(revisionId: string, note?: string): Promise<KnowledgeActionState> {
  const session = await requirePermission("knowledge.approve");
  const revision = await db.knowledgeRevision.findUnique({ where: { id: revisionId }, include: { source: true } });
  if (!revision || !(revision.status === KnowledgeRevisionStatus.PENDING_APPROVAL || revision.status === KnowledgeRevisionStatus.SYNC_FAILED)) {
    return { error: "revision นี้ไม่อยู่ในสถานะที่อนุมัติได้" };
  }
  const policyError = storedRevisionPolicyError(revision);
  if (policyError) return { error: policyError };
  const qualityError = await storedRevisionQualityError(revision);
  if (qualityError) return { error: qualityError };
  const job = await db.$transaction(async (tx) => {
    await tx.knowledgeApproval.updateMany({
      where: { revisionId, status: KnowledgeApprovalStatus.PENDING },
      data: { status: KnowledgeApprovalStatus.APPROVED, actedByUserId: session.user.id, actedAt: new Date(), decisionNote: note?.trim() || null },
    });
    await tx.knowledgeRevision.update({
      where: { id: revisionId },
      data: { status: KnowledgeRevisionStatus.SYNCING, approvedByUserId: session.user.id, approvedAt: new Date(), syncError: null },
    });
    const created = await tx.knowledgeSyncJob.create({ data: { revisionId, trigger: "MANUAL_APPROVAL", triggeredByUserId: session.user.id } });
    await tx.knowledgeAuditLog.create({ data: { sourceId: revision.sourceId, revisionId, actorUserId: session.user.id, action: "APPROVED" } });
    return created;
  });
  try {
    await publishKnowledgeRevision(job.id);
    revalidateKnowledge(revision.source.slug);
    return { success: true, id: revision.sourceId };
  } catch (error) {
    console.error("[approveAndPublishKnowledge]", error);
    revalidateKnowledge(revision.source.slug);
    return { error: "อนุมัติแล้วแต่สร้าง embedding ไม่สำเร็จ เวอร์ชันเดิมยังทำงานอยู่ สามารถกด Retry ได้" };
  }
}

export async function rejectKnowledgeRevision(revisionId: string, reason: string): Promise<KnowledgeActionState> {
  const session = await requirePermission("knowledge.approve");
  const trimmed = reason.trim();
  if (trimmed.length < 3) return { error: "กรุณาระบุเหตุผลที่ไม่อนุมัติ" };
  const revision = await db.knowledgeRevision.findUnique({ where: { id: revisionId }, include: { source: true } });
  if (!revision || revision.status !== KnowledgeRevisionStatus.PENDING_APPROVAL) return { error: "revision นี้ไม่อยู่ในคิวอนุมัติ" };
  await db.$transaction([
    db.knowledgeApproval.updateMany({ where: { revisionId, status: KnowledgeApprovalStatus.PENDING }, data: { status: KnowledgeApprovalStatus.REJECTED, actedByUserId: session.user.id, actedAt: new Date(), decisionNote: trimmed } }),
    db.knowledgeRevision.update({ where: { id: revisionId }, data: { status: KnowledgeRevisionStatus.REJECTED, rejectionReason: trimmed } }),
    db.knowledgeAuditLog.create({ data: { sourceId: revision.sourceId, revisionId, actorUserId: session.user.id, action: "REJECTED", detail: trimmed } }),
  ]);
  revalidateKnowledge(revision.source.slug);
  return { success: true, id: revision.sourceId };
}

export async function retryKnowledgePublish(revisionId: string): Promise<KnowledgeActionState> {
  const session = await requirePermission("knowledge.sync");
  const revision = await db.knowledgeRevision.findUnique({ where: { id: revisionId }, include: { source: true } });
  if (!revision || revision.status !== KnowledgeRevisionStatus.SYNC_FAILED) return { error: "revision นี้ไม่มีงาน Sync ที่ต้อง retry" };
  const job = await db.knowledgeSyncJob.create({ data: { revisionId, trigger: "MANUAL_RETRY", triggeredByUserId: session.user.id } });
  await db.knowledgeRevision.update({ where: { id: revisionId }, data: { status: KnowledgeRevisionStatus.SYNCING, syncError: null } });
  try {
    await publishKnowledgeRevision(job.id);
    revalidateKnowledge(revision.source.slug);
    return { success: true, id: revision.sourceId };
  } catch {
    revalidateKnowledge(revision.source.slug);
    return { error: "Retry ไม่สำเร็จ เวอร์ชันเดิมยังทำงานอยู่" };
  }
}

export async function archiveKnowledgeSource(sourceId: string): Promise<KnowledgeActionState> {
  const session = await requirePermission("knowledge.archive");
  const source = await db.knowledgeSource.findUnique({ where: { id: sourceId } });
  if (!source) return { error: "ไม่พบแหล่งความรู้" };
  await db.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`UPDATE knowledge_documents SET status='ARCHIVED', updated_at=now() WHERE metadata->>'cmsSourceId' = ${sourceId}`);
    await tx.knowledgeRevision.updateMany({ where: { sourceId, status: KnowledgeRevisionStatus.ACTIVE }, data: { status: KnowledgeRevisionStatus.ARCHIVED } });
    await tx.knowledgeSource.update({ where: { id: sourceId }, data: { isArchived: true, activeRevisionId: null } });
    await tx.knowledgeAuditLog.create({ data: { sourceId, actorUserId: session.user.id, action: "ARCHIVED" } });
  });
  revalidateKnowledge(source.slug);
  return { success: true, id: sourceId };
}

export async function testKnowledgeQuestion(question: string, channel: "line" | "messenger") {
  await requirePermission("knowledge.sync");
  const value = question.trim();
  if (value.length < 2 || value.length > 500) return { error: "กรุณาระบุคำถาม 2-500 ตัวอักษร" };
  const [rows, answer] = await Promise.all([
    retrieveKnowledgeDocuments(value),
    answerFromKnowledgeRag({ text: value, channel, recordOperations: false }),
  ]);
  return {
    success: true,
    answer,
    feedbackContext: {
      queryHash: hashKnowledgeRagQuery(value),
      channel,
      outcome: answer.answered
        ? ("ANSWERED" as const)
        : rows.length === 0
          ? ("NO_RETRIEVAL" as const)
          : ("UNSUPPORTED" as const),
      citationIds: answer.citations.map((item) => item.id),
    },
    rows: rows.map((row) => ({ id: row.id, title: row.title, heading: row.section_heading, semantic: Number(row.semantic_score), hybrid: Number(row.hybrid_score) })),
  };
}
