"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import { buildKnowledgeRevisionChecksum } from "@/lib/knowledge-cms-types";
import { requirePermission } from "@/lib/require-auth";
import {
  KNOWLEDGE_FEEDBACK_REASONS,
  type KnowledgeFeedbackReason,
} from "@/lib/knowledge-rag-feedback";

type ActionResult = { success?: boolean; id?: string; error?: string };

const feedbackSchema = z.object({
  queryHash: z.string().regex(/^[a-f0-9]{16}$/),
  channel: z.enum(["line", "messenger"]),
  outcome: z.enum([
    "ANSWERED",
    "HUMAN_ONLY",
    "NO_RETRIEVAL",
    "UNSUPPORTED",
    "GENERATION_ERROR",
  ]),
  rating: z.enum(["GOOD", "BAD"]),
  reasonCode: z.enum(
    Object.keys(KNOWLEDGE_FEEDBACK_REASONS) as [
      KnowledgeFeedbackReason,
      ...KnowledgeFeedbackReason[],
    ],
  ),
  citationIds: z.array(z.string().trim().min(1).max(240)).max(5),
});

export async function submitKnowledgeRagFeedback(
  input: z.input<typeof feedbackSchema>,
): Promise<ActionResult> {
  const session = await requirePermission("knowledge.sync");
  const parsed = feedbackSchema.safeParse(input);
  if (!parsed.success) return { error: "ข้อมูล feedback ไม่ถูกต้อง" };
  if (parsed.data.rating === "GOOD" && parsed.data.reasonCode !== "HELPFUL") {
    return { error: "Feedback ที่ดีต้องใช้เหตุผลว่าคำตอบมีประโยชน์" };
  }
  if (parsed.data.rating === "BAD" && parsed.data.reasonCode === "HELPFUL") {
    return { error: "กรุณาระบุสาเหตุที่ต้องปรับปรุง" };
  }

  await db.$transaction(async (tx) => {
    await tx.knowledgeRagFeedback.create({
      data: {
        ...parsed.data,
        createdByUserId: session.user.id,
      },
    });
    if (parsed.data.rating === "BAD") {
      const key = {
        queryHash: parsed.data.queryHash,
        channel: parsed.data.channel,
        outcome: "ADMIN_FEEDBACK",
      };
      const existing = await tx.knowledgeRagGapSignal.findUnique({
        where: {
          queryHash_channel_outcome: key,
        },
      });
      if (existing) {
        await tx.knowledgeRagGapSignal.update({
          where: { id: existing.id },
          data: {
            occurrences: { increment: 1 },
            reasonCode: parsed.data.reasonCode,
            lastSeenAt: new Date(),
            ...(existing.status === "DISMISSED" && !existing.sourceId
              ? { status: "NEW" }
              : {}),
          },
        });
      } else {
        await tx.knowledgeRagGapSignal.create({
          data: {
            ...key,
            reasonCode: parsed.data.reasonCode,
          },
        });
      }
    }
  });
  revalidatePath("/admin/knowledge/quality");
  return { success: true };
}

const gapIdSchema = z.string().trim().min(10).max(64);

const reviewSchema = z.object({
  gapId: gapIdSchema,
  internalTitle: z.string().trim().min(5).max(180),
});

export async function reviewKnowledgeGap(formData: FormData): Promise<ActionResult> {
  const session = await requirePermission("knowledge.approve");
  const parsed = reviewSchema.safeParse({
    gapId: formData.get("gapId"),
    internalTitle: formData.get("internalTitle"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }
  const result = await db.knowledgeRagGapSignal.updateMany({
    where: {
      id: parsed.data.gapId,
      status: { in: ["NEW", "DISMISSED"] },
      sourceId: null,
    },
    data: {
      status: "REVIEWED",
      internalTitle: parsed.data.internalTitle,
      reviewedByUserId: session.user.id,
      reviewedAt: new Date(),
    },
  });
  if (result.count !== 1) return { error: "รายการนี้ถูกดำเนินการไปแล้ว" };
  revalidatePath("/admin/knowledge/quality");
  return { success: true, id: parsed.data.gapId };
}

export async function dismissKnowledgeGap(gapId: string): Promise<ActionResult> {
  const session = await requirePermission("knowledge.approve");
  const parsed = gapIdSchema.safeParse(gapId);
  if (!parsed.success) return { error: "รหัสรายการไม่ถูกต้อง" };
  const result = await db.knowledgeRagGapSignal.updateMany({
    where: {
      id: parsed.data,
      status: { in: ["NEW", "REVIEWED"] },
      sourceId: null,
    },
    data: {
      status: "DISMISSED",
      reviewedByUserId: session.user.id,
      reviewedAt: new Date(),
    },
  });
  if (result.count !== 1) return { error: "รายการนี้ไม่สามารถข้ามได้" };
  revalidatePath("/admin/knowledge/quality");
  return { success: true, id: parsed.data };
}

export async function createDraftFromKnowledgeGap(
  gapId: string,
): Promise<ActionResult> {
  const session = await requirePermission("knowledge.create");
  const parsed = gapIdSchema.safeParse(gapId);
  if (!parsed.success) return { error: "รหัสรายการไม่ถูกต้อง" };
  const gap = await db.knowledgeRagGapSignal.findUnique({
    where: { id: parsed.data },
  });
  if (
    !gap ||
    gap.status !== "REVIEWED" ||
    !gap.reviewedByUserId ||
    !gap.reviewedAt ||
    !gap.internalTitle
  ) {
    return { error: "ต้องให้ผู้มีสิทธิ์อนุมัติตรวจรายการนี้ก่อนสร้างร่าง" };
  }
  if (gap.sourceId) return { success: true, id: gap.sourceId };

  const content = {
    intro: "ร่างจากสัญญาณช่องว่างความรู้ กรุณาตรวจสอบข้อเท็จจริงและเพิ่มแหล่งอ้างอิงก่อนส่งอนุมัติ",
    highlights: [],
    sections: [
      {
        heading: "คำตอบที่ต้องจัดทำ",
        body: ["กรุณาเพิ่มคำตอบที่ผ่านการตรวจสอบแล้ว"],
        format: "PARAGRAPHS" as const,
        aiEnabled: false,
      },
    ],
    relatedSearches: [],
    internalLinks: [],
    readingMinutes: 1,
    governance: {
      ownerUserId: session.user.id,
      evidenceLevel: "UNVERIFIED" as const,
      checklist: {
        factsChecked: false,
        sourcesTraceable: false,
        aiScopeReviewed: false,
        adminOnlyTopicsReviewed: false,
      },
    },
  };
  const draftData = {
    type: "FAQ" as const,
    slug: "",
    title: gap.internalTitle,
    description: `สร้างจาก Knowledge gap ${gap.queryHash} (${gap.channel}/${gap.outcome})`,
    category: "Knowledge gap",
    content,
    answerScope: "ร่างจากช่องว่างความรู้ ต้องตรวจสอบและอนุมัติก่อนเปิดใช้ AI",
    riskLevel: "LOW" as const,
    ragEnabled: false,
    sourceUrls: [] as string[],
  };

  let source: { id: string };
  try {
    source = await db.$transaction(async (tx) => {
    const created = await tx.knowledgeSource.create({
      data: {
        sourceKey: `gap:${gap.id}`,
        type: "FAQ",
        slug: null,
        createdByUserId: session.user.id,
        revisions: {
          create: {
            revisionNo: 1,
            title: draftData.title,
            description: draftData.description,
            category: draftData.category,
            content: draftData.content,
            answerScope: draftData.answerScope,
            riskLevel: draftData.riskLevel,
            ragEnabled: false,
            sourceUrls: [],
            checksum: buildKnowledgeRevisionChecksum(draftData),
            createdByUserId: session.user.id,
          },
        },
      },
      include: { revisions: { orderBy: { revisionNo: "desc" }, take: 1 } },
    });
    const revision = created.revisions[0];
    if (revision) {
      await tx.knowledgeAuditLog.create({
        data: {
          sourceId: created.id,
          revisionId: revision.id,
          actorUserId: session.user.id,
          action: "CREATED_FROM_GAP",
          detail: `สร้างจาก gap hash ${gap.queryHash}; RAG ปิดไว้จนกว่าจะตรวจสอบและอนุมัติ`,
        },
      });
    }
    await tx.knowledgeRagGapSignal.update({
      where: { id: gap.id },
      data: { status: "DRAFT_CREATED", sourceId: created.id },
    });
    return created;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.knowledgeSource.findUnique({
        where: { sourceKey: `gap:${gap.id}` },
        select: { id: true },
      });
      if (existing) return { success: true, id: existing.id };
    }
    console.error("[createDraftFromKnowledgeGap]", error);
    return { error: "สร้างร่างจาก gap ไม่สำเร็จ กรุณาลองใหม่" };
  }

  revalidatePath("/admin/knowledge");
  revalidatePath("/admin/knowledge/quality");
  return { success: true, id: source.id };
}
