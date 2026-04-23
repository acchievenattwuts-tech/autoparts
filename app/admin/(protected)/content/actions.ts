"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  ContentApprovalStatus,
  ContentNotificationType,
  ContentPostStatus,
  ContentScheduledJobStatus,
} from "@/lib/generated/prisma";
import { ensureAccessControlSetup } from "@/lib/access-control";
import { getContentConfig } from "@/lib/content-config";
import { publishFacebookPagePost } from "@/lib/content-facebook";
import { getContentApproverUsers, sendContentWorkflowNotification } from "@/lib/content-line";
import { getQStashClient } from "@/lib/content-qstash";
import {
  createContentAuditLog,
  createScheduledPublishJob,
  getContentPostById,
  hasActiveContentPublishJob,
} from "@/lib/content-repository";
import { parseBangkokDateTimeLocal } from "@/lib/content-utils";
import { db } from "@/lib/db";
import { generateContentDraftIdeas, suggestContentTopics } from "@/lib/content-ai";
import { requirePermission } from "@/lib/require-auth";

const INVALID_FORM_ERROR = "ข้อมูลที่ส่งมาไม่ถูกต้อง";

const generateDraftSchema = z.object({
  topic: z.string().min(3, "กรุณากรอกหัวข้ออย่างน้อย 3 ตัวอักษร").max(200),
  businessType: z.string().max(200).optional(),
  audience: z.string().max(200).optional(),
  goal: z.string().max(100).optional(),
  seasonOrFestival: z.string().max(200).optional(),
  callToAction: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});

const suggestTopicsSchema = z.object({
  businessType: z.string().max(200).optional(),
  audience: z.string().max(200).optional(),
  goal: z.string().max(100).optional(),
  seasonOrFestival: z.string().max(200).optional(),
  callToAction: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});

const updateDraftSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(200).optional(),
  caption: z.string().min(10, "กรุณากรอกข้อความโพสต์อย่างน้อย 10 ตัวอักษร").max(5000),
  imageUrl: z.string().url("URL รูปภาพไม่ถูกต้อง").max(500).optional().or(z.literal("")),
  linkUrl: z.string().url("URL ลิงก์ไม่ถูกต้อง").max(500).optional().or(z.literal("")),
  scheduledAt: z.string().optional(),
});

const requestApprovalSchema = z.object({
  postId: z.string().min(1),
  approverUserId: z.string().min(1, "กรุณาเลือกผู้อนุมัติ"),
});

const approvalDecisionSchema = z.object({
  postId: z.string().min(1),
  scheduledAt: z.string().optional(),
});

const revisionSchema = z.object({
  postId: z.string().min(1),
  decisionNote: z.string().max(1000).optional(),
});

const cancelSchema = z.object({
  postId: z.string().min(1),
});

const retryScheduleSchema = z.object({
  postId: z.string().min(1),
  scheduledAt: z.string().optional(),
});

function revalidateContentPaths(id?: string) {
  revalidatePath("/admin/content");
  revalidatePath("/admin/content/approval-queue");
  if (id) {
    revalidatePath(`/admin/content/${id}`);
  }
}

function getFirstIssueMessage(
  parsed:
    | { success: true }
    | {
        success: false;
        error: { issues: Array<{ message?: string }> };
      }
) {
  return parsed.success ? null : parsed.error.issues[0]?.message ?? INVALID_FORM_ERROR;
}

async function listRecentContentTopicHistory() {
  const posts = await db.contentPost.findMany({
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      title: true,
      caption: true,
    },
  });

  return posts.map((post) => {
    const title = post.title?.trim();
    const preview = post.caption.replace(/\s+/g, " ").trim().slice(0, 120);
    return title ? `${title} - ${preview}` : preview;
  });
}

async function createDraftVariants(params: {
  drafts: Array<{ title: string; caption: string }>;
  topic: string;
  createdByUserId: string;
  facebookPageId: string;
  draftSource: string;
}) {
  const variantGroupId = randomUUID();

  await db.$transaction(async (tx) => {
    for (const [index, draft] of params.drafts.entries()) {
      const post = await tx.contentPost.create({
        data: {
          channel: "FACEBOOK_PAGE",
          title: draft.title,
          caption: draft.caption,
          status: ContentPostStatus.DRAFT,
          facebookPageId: params.facebookPageId,
          draftSource: params.draftSource,
          timezone: "Asia/Bangkok",
          variantGroupId,
          variantNo: index + 1,
          isSelectedVariant: index === 0,
          createdByUserId: params.createdByUserId,
        },
      });

      await tx.contentAuditLog.create({
        data: {
          postId: post.id,
          actorUserId: params.createdByUserId,
          action: "DRAFT_CREATED",
          detail: `สร้าง draft แบบที่ ${index + 1} จากหัวข้อ ${params.topic}`,
        },
      });
    }
  });
}

async function enqueuePublishJob(params: {
  jobId: string;
  runAt: Date;
  deduplicationId: string;
}) {
  const config = getContentConfig();
  if (!config.appBaseUrl) {
    throw new Error("APP_BASE_URL_NOT_CONFIGURED");
  }

  const client = getQStashClient();
  const result = await client.publishJSON({
    url: `${config.appBaseUrl}/api/content/publish`,
    body: {
      jobId: params.jobId,
    },
    notBefore: Math.floor(params.runAt.getTime() / 1000),
    deduplicationId: params.deduplicationId,
    retries: 3,
    retryDelay: "pow(2, retried) * 1000",
  });

  return db.contentScheduledJob.update({
    where: { id: params.jobId },
    data: {
      providerMessageId: "messageId" in result ? result.messageId : null,
      status: ContentScheduledJobStatus.DISPATCHED,
    },
  });
}

function getScheduledPublishReadinessError() {
  const config = getContentConfig();
  if (!config.appBaseUrl) return "APP_BASE_URL_NOT_CONFIGURED";
  if (!config.facebookPageId || !config.facebookPageAccessToken) {
    return "FACEBOOK_PUBLISH_NOT_CONFIGURED";
  }
  if (!config.qstashToken || !config.qstashCurrentSigningKey || !config.qstashNextSigningKey) {
    return "QSTASH_NOT_CONFIGURED";
  }

  return null;
}

function getImmediatePublishReadinessError() {
  const config = getContentConfig();
  if (!config.facebookPageId || !config.facebookPageAccessToken) {
    return "FACEBOOK_PUBLISH_NOT_CONFIGURED";
  }

  return null;
}

async function publishNow(postId: string, actorUserId: string) {
  const post = await db.contentPost.findUnique({
    where: { id: postId },
    select: {
      id: true,
      caption: true,
      imageUrl: true,
      linkUrl: true,
      facebookPageId: true,
      createdByUserId: true,
      approvedByUserId: true,
      title: true,
      scheduledAt: true,
      status: true,
    },
  });

  if (!post) {
    throw new Error("POST_NOT_FOUND");
  }

  const metaPostId = await publishFacebookPagePost(post);
  await db.contentPost.update({
    where: { id: postId },
    data: {
      status: ContentPostStatus.POSTED,
      postedAt: new Date(),
      approvedAt: new Date(),
      approvedByUserId: actorUserId,
      metaPostId,
      lastError: null,
      failedAt: null,
    },
  });

  await createContentAuditLog({
    postId,
    actorUserId,
    action: "PUBLISH_SUCCEEDED",
    detail: `โพสต์ขึ้น Facebook สำเร็จ (${metaPostId})`,
    notificationType: ContentNotificationType.POST_PUBLISHED,
  });

  const config = getContentConfig();
  if (config.appBaseUrl) {
    await sendContentWorkflowNotification({
      post,
      recipientUserIds: [
        ...new Set([post.createdByUserId, post.approvedByUserId].filter((value): value is string => !!value)),
      ],
      heading: "โพสต์ Facebook สำเร็จแล้ว",
      detail: "ระบบโพสต์เนื้อหานี้ขึ้น Facebook Page เรียบร้อยแล้ว",
      appBaseUrl: config.appBaseUrl,
    }).catch((error) => {
      console.warn("[content] publish success notification failed", error);
    });
  }
}

export async function generateContentDraftsAction(formData: FormData) {
  await ensureAccessControlSetup();

  let session;
  try {
    session = await requirePermission("content.create");
  } catch {
    return { error: "คุณไม่มีสิทธิ์สร้าง draft เนื้อหา" };
  }

  const parsed = generateDraftSchema.safeParse({
    topic: formData.get("topic"),
    businessType: formData.get("businessType") || undefined,
    audience: formData.get("audience") || undefined,
    goal: formData.get("goal") || undefined,
    seasonOrFestival: formData.get("seasonOrFestival") || undefined,
    callToAction: formData.get("callToAction") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { error: getFirstIssueMessage(parsed) ?? INVALID_FORM_ERROR };
  }

  const config = getContentConfig();
  if (!config.facebookPageId) {
    return { error: "ยังไม่ได้ตั้งค่า FACEBOOK_PAGE_ID" };
  }

  try {
    const recentPosts = await listRecentContentTopicHistory();
    const drafts = await generateContentDraftIdeas({
      ...parsed.data,
      recentPosts,
    });

    await createDraftVariants({
      drafts,
      topic: parsed.data.topic,
      createdByUserId: session.user.id,
      facebookPageId: config.facebookPageId,
      draftSource: config.openAiApiKey ? "AI_OPENAI" : "TEMPLATE_FALLBACK",
    });

    revalidateContentPaths();
    return { success: true };
  } catch (error) {
    console.error("[generateContentDraftsAction]", error);
    return { error: "สร้าง draft ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function suggestContentTopicsAction(formData: FormData) {
  await ensureAccessControlSetup();

  try {
    await requirePermission("content.create");
  } catch {
    return { error: "คุณไม่มีสิทธิ์ให้ AI คิดหัวข้อโพสต์" };
  }

  const parsed = suggestTopicsSchema.safeParse({
    businessType: formData.get("businessType") || undefined,
    audience: formData.get("audience") || undefined,
    goal: formData.get("goal") || undefined,
    seasonOrFestival: formData.get("seasonOrFestival") || undefined,
    callToAction: formData.get("callToAction") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { error: getFirstIssueMessage(parsed) ?? INVALID_FORM_ERROR };
  }

  try {
    const recentPosts = await listRecentContentTopicHistory();
    const topics = await suggestContentTopics({
      businessType: parsed.data.businessType,
      audience: parsed.data.audience,
      goal: parsed.data.goal,
      seasonOrFestival: parsed.data.seasonOrFestival,
      notes: parsed.data.notes,
      recentPosts,
    });

    return { success: true, topics };
  } catch (error) {
    console.error("[suggestContentTopicsAction]", error);
    return { error: "AI คิดหัวข้อไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function autoGenerateTopicAndDraftsAction(formData: FormData) {
  await ensureAccessControlSetup();

  let session;
  try {
    session = await requirePermission("content.create");
  } catch {
    return { error: "คุณไม่มีสิทธิ์สร้าง draft เนื้อหา" };
  }

  const parsed = suggestTopicsSchema.safeParse({
    businessType: formData.get("businessType") || undefined,
    audience: formData.get("audience") || undefined,
    goal: formData.get("goal") || undefined,
    seasonOrFestival: formData.get("seasonOrFestival") || undefined,
    callToAction: formData.get("callToAction") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { error: getFirstIssueMessage(parsed) ?? INVALID_FORM_ERROR };
  }

  const config = getContentConfig();
  if (!config.facebookPageId) {
    return { error: "ยังไม่ได้ตั้งค่า FACEBOOK_PAGE_ID" };
  }

  try {
    const recentPosts = await listRecentContentTopicHistory();
    const topics = await suggestContentTopics({
      businessType: parsed.data.businessType,
      audience: parsed.data.audience,
      goal: parsed.data.goal,
      seasonOrFestival: parsed.data.seasonOrFestival,
      notes: parsed.data.notes,
      recentPosts,
    });

    const selectedTopic = topics[0]?.topic?.trim();
    if (!selectedTopic) {
      return { error: "AI ยังไม่สามารถเลือกหัวข้อที่เหมาะสมได้" };
    }

    const drafts = await generateContentDraftIdeas({
      topic: selectedTopic,
      businessType: parsed.data.businessType,
      audience: parsed.data.audience,
      goal: parsed.data.goal,
      seasonOrFestival: parsed.data.seasonOrFestival,
      callToAction: parsed.data.callToAction,
      notes: parsed.data.notes,
      recentPosts,
    });

    await createDraftVariants({
      drafts,
      topic: selectedTopic,
      createdByUserId: session.user.id,
      facebookPageId: config.facebookPageId,
      draftSource: config.openAiApiKey ? "AI_OPENAI" : "TEMPLATE_FALLBACK",
    });

    revalidateContentPaths();
    return { success: true, selectedTopic, topics };
  } catch (error) {
    console.error("[autoGenerateTopicAndDraftsAction]", error);
    return { error: "AI คิดหัวข้อและสร้าง draft ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }
}

export async function updateContentDraftAction(formData: FormData) {
  let session;
  try {
    session = await requirePermission("content.update");
  } catch {
    return { error: "คุณไม่มีสิทธิ์แก้ไข draft เนื้อหา" };
  }

  const parsed = updateDraftSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title") || undefined,
    caption: formData.get("caption"),
    imageUrl: formData.get("imageUrl") || "",
    linkUrl: formData.get("linkUrl") || "",
    scheduledAt: formData.get("scheduledAt") || undefined,
  });

  if (!parsed.success) {
    return { error: getFirstIssueMessage(parsed) ?? INVALID_FORM_ERROR };
  }

  const scheduledAt = parseBangkokDateTimeLocal(parsed.data.scheduledAt);
  if (parsed.data.scheduledAt && !scheduledAt) {
    return { error: "เวลาโพสต์ไม่ถูกต้อง" };
  }

  if (parsed.data.scheduledAt) {
    const readinessError = getScheduledPublishReadinessError();
    if (readinessError) {
      return { error: readinessError };
    }
  }

  try {
    await db.contentPost.update({
      where: { id: parsed.data.id },
      data: {
        title: parsed.data.title?.trim() || null,
        caption: parsed.data.caption.trim(),
        imageUrl: parsed.data.imageUrl || null,
        linkUrl: parsed.data.linkUrl || null,
        scheduledAt,
      },
    });

    await createContentAuditLog({
      postId: parsed.data.id,
      actorUserId: session.user.id,
      action: "DRAFT_UPDATED",
      detail: "แก้ไขรายละเอียด draft",
    });
  } catch (error) {
    console.error("[updateContentDraftAction]", error);
    return { error: "บันทึก draft ไม่สำเร็จ" };
  }

  revalidateContentPaths(parsed.data.id);
  return { success: true };
}

export async function selectContentVariantAction(formData: FormData) {
  let session;
  try {
    session = await requirePermission("content.update");
  } catch {
    return { error: "คุณไม่มีสิทธิ์เลือก draft ที่จะใช้งาน" };
  }

  const postId = String(formData.get("postId") || "").trim();
  if (!postId) {
    return { error: "ไม่พบ draft ที่ต้องการเลือก" };
  }

  const post = await db.contentPost.findUnique({
    where: { id: postId },
    select: {
      id: true,
      variantGroupId: true,
    },
  });

  if (!post) {
    return { error: "ไม่พบ draft ที่ต้องการเลือก" };
  }

  try {
    await db.$transaction(async (tx) => {
      if (post.variantGroupId) {
        await tx.contentPost.updateMany({
          where: { variantGroupId: post.variantGroupId },
          data: { isSelectedVariant: false },
        });
      }

      await tx.contentPost.update({
        where: { id: postId },
        data: { isSelectedVariant: true },
      });
    });

    await createContentAuditLog({
      postId,
      actorUserId: session.user.id,
      action: "VARIANT_SELECTED",
      detail: "เลือก draft นี้เป็นตัวหลักสำหรับส่งอนุมัติและโพสต์จริง",
    });
  } catch (error) {
    console.error("[selectContentVariantAction]", error);
    return { error: "เลือก draft ไม่สำเร็จ" };
  }

  revalidateContentPaths(postId);
  return { success: true };
}

export async function requestContentApprovalAction(formData: FormData) {
  let session;
  try {
    session = await requirePermission("content.update");
  } catch {
    return { error: "คุณไม่มีสิทธิ์ส่งโพสต์เข้าอนุมัติ" };
  }

  const parsed = requestApprovalSchema.safeParse({
    postId: formData.get("postId"),
    approverUserId: formData.get("approverUserId"),
  });

  if (!parsed.success) {
    return { error: getFirstIssueMessage(parsed) ?? INVALID_FORM_ERROR };
  }

  const config = getContentConfig();
  if (!config.appBaseUrl) {
    return { error: "ยังไม่ได้ตั้งค่า APP_BASE_URL" };
  }

  const post = await db.contentPost.findUnique({
    where: { id: parsed.data.postId },
    select: {
      id: true,
      title: true,
      caption: true,
      scheduledAt: true,
      status: true,
      createdByUserId: true,
      facebookPageId: true,
    },
  });

  if (!post) {
    return { error: "ไม่พบโพสต์ที่ต้องการส่งอนุมัติ" };
  }

  const approvers = await getContentApproverUsers();
  if (!approvers.some((user) => user.id === parsed.data.approverUserId)) {
    return { error: "ผู้อนุมัติคนนี้ยังไม่ได้ผูก LINE หรือไม่มีสิทธิ์อนุมัติเนื้อหา" };
  }

  try {
    await db.$transaction(async (tx) => {
      const currentPost = await tx.contentPost.findUnique({
        where: { id: parsed.data.postId },
        select: { variantGroupId: true },
      });

      if (currentPost?.variantGroupId) {
        await tx.contentPost.updateMany({
          where: { variantGroupId: currentPost.variantGroupId },
          data: { isSelectedVariant: false },
        });
      }

      await tx.contentApproval.updateMany({
        where: {
          postId: parsed.data.postId,
          status: ContentApprovalStatus.PENDING,
        },
        data: {
          status: ContentApprovalStatus.CANCELLED,
          actedAt: new Date(),
        },
      });

      await tx.contentApproval.create({
        data: {
          postId: parsed.data.postId,
          requestedByUserId: session.user.id,
          approverUserId: parsed.data.approverUserId,
          status: ContentApprovalStatus.PENDING,
        },
      });

      await tx.contentPost.update({
        where: { id: parsed.data.postId },
        data: {
          status: ContentPostStatus.PENDING_APPROVAL,
          isSelectedVariant: true,
        },
      });
    });

    await createContentAuditLog({
      postId: parsed.data.postId,
      actorUserId: session.user.id,
      action: "APPROVAL_REQUESTED",
      detail: `ส่งคำขออนุมัติไปยังผู้ใช้ ${parsed.data.approverUserId}`,
      notificationType: ContentNotificationType.APPROVAL_REQUESTED,
    });

    await sendContentWorkflowNotification({
      post,
      recipientUserIds: [parsed.data.approverUserId],
      heading: "มีโพสต์ Facebook รออนุมัติ",
      detail: "กรุณาตรวจสอบเนื้อหา เลือกเวลาโพสต์ หรืออนุมัติโพสต์ทันทีจากหน้าอนุมัติ",
      appBaseUrl: config.appBaseUrl,
    });
  } catch (error) {
    console.error("[requestContentApprovalAction]", error);
    return { error: "ส่งคำขออนุมัติไม่สำเร็จ" };
  }

  revalidateContentPaths(parsed.data.postId);
  return { success: true };
}

export async function approveAndScheduleContentAction(formData: FormData) {
  let session;
  try {
    session = await requirePermission("content.manage");
  } catch {
    return { error: "คุณไม่มีสิทธิ์อนุมัติและตั้งเวลาโพสต์" };
  }

  const parsed = approvalDecisionSchema.safeParse({
    postId: formData.get("postId"),
    scheduledAt: formData.get("scheduledAt") || undefined,
  });

  if (!parsed.success) {
    return { error: getFirstIssueMessage(parsed) ?? INVALID_FORM_ERROR };
  }

  const scheduledPublishReadinessError = getScheduledPublishReadinessError();
  if (scheduledPublishReadinessError) {
    return { error: scheduledPublishReadinessError };
  }

  const scheduledAt = parseBangkokDateTimeLocal(parsed.data.scheduledAt);
  if (!scheduledAt) {
    return { error: "กรุณาเลือกเวลาโพสต์ก่อนกด schedule" };
  }
  if (scheduledAt.getTime() <= Date.now()) {
    return { error: "เวลาโพสต์ต้องมากกว่าปัจจุบัน" };
  }

  const post = await getContentPostById(parsed.data.postId);
  if (!post) {
    return { error: "ไม่พบโพสต์ที่ต้องการอนุมัติ" };
  }

  if (await hasActiveContentPublishJob(parsed.data.postId)) {
    return { error: "ACTIVE_SCHEDULE_ALREADY_EXISTS" };
  }

  try {
    const job = await db.$transaction(async (tx) => {
      await tx.contentApproval.updateMany({
        where: {
          postId: parsed.data.postId,
          status: ContentApprovalStatus.PENDING,
        },
        data: {
          status: ContentApprovalStatus.APPROVED,
          actedAt: new Date(),
        },
      });

      await tx.contentPost.update({
        where: { id: parsed.data.postId },
        data: {
          status: ContentPostStatus.SCHEDULED,
          scheduledAt,
          approvedAt: new Date(),
          approvedByUserId: session.user.id,
          lastError: null,
          failedAt: null,
        },
      });

      return createScheduledPublishJob({
        postId: parsed.data.postId,
        runAt: scheduledAt,
        createdByUserId: session.user.id,
      });
    });

    await enqueuePublishJob({
      jobId: job.id,
      runAt: scheduledAt,
      deduplicationId: job.idempotencyKey,
    });

    await createContentAuditLog({
      postId: parsed.data.postId,
      actorUserId: session.user.id,
      action: "POST_SCHEDULED",
      detail: `อนุมัติและตั้งเวลาโพสต์ไว้ที่ ${scheduledAt.toISOString()}`,
      notificationType: ContentNotificationType.POST_SCHEDULED,
    });

    const notificationConfig = getContentConfig();
    if (notificationConfig.appBaseUrl) {
      await sendContentWorkflowNotification({
        post,
        recipientUserIds: [...new Set([post.createdByUserId, session.user.id])],
        heading: "โพสต์ Facebook ถูกตั้งเวลาแล้ว",
        detail: "ระบบบันทึกเวลาโพสต์เรียบร้อยแล้ว และจะส่งขึ้น Facebook ตามเวลาที่กำหนด",
        appBaseUrl: notificationConfig.appBaseUrl,
      }).catch((notificationError) => {
        console.warn("[content] schedule notification failed", notificationError);
      });
    }
  } catch (error) {
    console.error("[approveAndScheduleContentAction]", error);
    return { error: "อนุมัติและตั้งเวลาโพสต์ไม่สำเร็จ" };
  }

  revalidateContentPaths(parsed.data.postId);
  return { success: true };
}

export async function approveAndPublishNowAction(formData: FormData) {
  let session;
  try {
    session = await requirePermission("content.manage");
  } catch {
    return { error: "คุณไม่มีสิทธิ์อนุมัติและโพสต์ทันที" };
  }

  const parsed = approvalDecisionSchema.safeParse({
    postId: formData.get("postId"),
  });

  if (!parsed.success) {
    return { error: getFirstIssueMessage(parsed) ?? INVALID_FORM_ERROR };
  }

  const immediatePublishReadinessError = getImmediatePublishReadinessError();
  if (immediatePublishReadinessError) {
    return { error: immediatePublishReadinessError };
  }

  try {
    await db.contentApproval.updateMany({
      where: {
        postId: parsed.data.postId,
        status: ContentApprovalStatus.PENDING,
      },
      data: {
        status: ContentApprovalStatus.APPROVED,
        actedAt: new Date(),
      },
    });

    await publishNow(parsed.data.postId, session.user.id);
  } catch (error) {
    console.error("[approveAndPublishNowAction]", error);
    return { error: "โพสต์ทันทีไม่สำเร็จ" };
  }

  revalidateContentPaths(parsed.data.postId);
  return { success: true };
}

export async function requestRevisionContentAction(formData: FormData) {
  let session;
  try {
    session = await requirePermission("content.manage");
  } catch {
    return { error: "คุณไม่มีสิทธิ์ตีกลับ draft" };
  }

  const parsed = revisionSchema.safeParse({
    postId: formData.get("postId"),
    decisionNote: formData.get("decisionNote") || undefined,
  });

  if (!parsed.success) {
    return { error: getFirstIssueMessage(parsed) ?? INVALID_FORM_ERROR };
  }

  const post = await db.contentPost.findUnique({
    where: { id: parsed.data.postId },
    select: {
      id: true,
      title: true,
      caption: true,
      scheduledAt: true,
      createdByUserId: true,
      status: true,
    },
  });

  if (!post) {
    return { error: "ไม่พบโพสต์ที่ต้องการตีกลับ" };
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.contentApproval.updateMany({
        where: {
          postId: parsed.data.postId,
          status: ContentApprovalStatus.PENDING,
        },
        data: {
          status: ContentApprovalStatus.REVISION_REQUESTED,
          actedAt: new Date(),
          decisionNote: parsed.data.decisionNote?.trim() || null,
        },
      });

      await tx.contentPost.update({
        where: { id: parsed.data.postId },
        data: {
          status: ContentPostStatus.DRAFT,
        },
      });
    });

    await createContentAuditLog({
      postId: parsed.data.postId,
      actorUserId: session.user.id,
      action: "REVISION_REQUESTED",
      detail: parsed.data.decisionNote?.trim() || "ขอให้แก้ไข draft ก่อนส่งอนุมัติอีกครั้ง",
      notificationType: ContentNotificationType.REVISION_REQUESTED,
    });

    const config = getContentConfig();
    if (config.appBaseUrl) {
      await sendContentWorkflowNotification({
        post,
        recipientUserIds: [post.createdByUserId],
        heading: "โพสต์ Facebook ถูกขอให้แก้ไข",
        detail:
          parsed.data.decisionNote?.trim() ||
          "ผู้อนุมัติขอให้แก้ไขรายละเอียดของโพสต์ก่อนส่งเข้าคิวอนุมัติอีกครั้ง",
        appBaseUrl: config.appBaseUrl,
      }).catch((error) => {
        console.warn("[content] revision notification failed", error);
      });
    }
  } catch (error) {
    console.error("[requestRevisionContentAction]", error);
    return { error: "ตีกลับ draft ไม่สำเร็จ" };
  }

  revalidateContentPaths(parsed.data.postId);
  return { success: true };
}

export async function cancelContentPostAction(formData: FormData) {
  let session;
  try {
    session = await requirePermission("content.update");
  } catch {
    return { error: "คุณไม่มีสิทธิ์ยกเลิกโพสต์" };
  }

  const parsed = cancelSchema.safeParse({
    postId: formData.get("postId"),
  });

  if (!parsed.success) {
    return { error: INVALID_FORM_ERROR };
  }

  try {
    await db.$transaction(async (tx) => {
      await tx.contentApproval.updateMany({
        where: {
          postId: parsed.data.postId,
          status: ContentApprovalStatus.PENDING,
        },
        data: {
          status: ContentApprovalStatus.CANCELLED,
          actedAt: new Date(),
        },
      });

      await tx.contentScheduledJob.updateMany({
        where: {
          postId: parsed.data.postId,
          status: {
            in: [ContentScheduledJobStatus.PENDING, ContentScheduledJobStatus.DISPATCHED],
          },
        },
        data: {
          status: ContentScheduledJobStatus.CANCELLED,
          finishedAt: new Date(),
        },
      });

      await tx.contentPost.update({
        where: { id: parsed.data.postId },
        data: {
          status: ContentPostStatus.CANCELLED,
          cancelledAt: new Date(),
        },
      });
    });

    await createContentAuditLog({
      postId: parsed.data.postId,
      actorUserId: session.user.id,
      action: "POST_CANCELLED",
      detail: "ยกเลิกโพสต์นี้แล้ว",
    });
  } catch (error) {
    console.error("[cancelContentPostAction]", error);
    return { error: "ยกเลิกโพสต์ไม่สำเร็จ" };
  }

  revalidateContentPaths(parsed.data.postId);
  return { success: true };
}

export async function retryFailedScheduledPublishAction(formData: FormData) {
  let session;
  try {
    session = await requirePermission("content.manage");
  } catch {
    return { error: "คุณไม่มีสิทธิ์ requeue งานโพสต์" };
  }

  const parsed = retryScheduleSchema.safeParse({
    postId: formData.get("postId"),
    scheduledAt: formData.get("scheduledAt") || undefined,
  });

  if (!parsed.success) {
    return { error: getFirstIssueMessage(parsed) ?? INVALID_FORM_ERROR };
  }

  const scheduledPublishReadinessError = getScheduledPublishReadinessError();
  if (scheduledPublishReadinessError) {
    return { error: scheduledPublishReadinessError };
  }

  const post = await db.contentPost.findUnique({
    where: { id: parsed.data.postId },
    select: {
      id: true,
      status: true,
      scheduledAt: true,
    },
  });

  if (!post) {
    return { error: "POST_NOT_FOUND" };
  }

  if (await hasActiveContentPublishJob(parsed.data.postId)) {
    return { error: "ACTIVE_SCHEDULE_ALREADY_EXISTS" };
  }

  const requestedSchedule = parseBangkokDateTimeLocal(parsed.data.scheduledAt);
  const fallbackSchedule =
    post.scheduledAt && post.scheduledAt.getTime() > Date.now()
      ? post.scheduledAt
      : new Date(Date.now() + 5 * 60 * 1000);
  const runAt = requestedSchedule ?? fallbackSchedule;

  if (runAt.getTime() <= Date.now()) {
    return { error: "SCHEDULE_TIME_MUST_BE_IN_THE_FUTURE" };
  }

  try {
    const job = await db.$transaction(async (tx) => {
      await tx.contentPost.update({
        where: { id: parsed.data.postId },
        data: {
          status: ContentPostStatus.SCHEDULED,
          scheduledAt: runAt,
          lastError: null,
          failedAt: null,
        },
      });

      return createScheduledPublishJob({
        postId: parsed.data.postId,
        runAt,
        createdByUserId: session.user.id,
      });
    });

    await enqueuePublishJob({
      jobId: job.id,
      runAt,
      deduplicationId: job.idempotencyKey,
    });

    await createContentAuditLog({
      postId: parsed.data.postId,
      actorUserId: session.user.id,
      action: "PUBLISH_REQUEUED",
      detail: `สั่ง requeue งานโพสต์ใหม่สำหรับเวลา ${runAt.toISOString()}`,
      notificationType: ContentNotificationType.POST_SCHEDULED,
    });
  } catch (error) {
    console.error("[retryFailedScheduledPublishAction]", error);
    return { error: "REQUEUE_PUBLISH_FAILED" };
  }

  revalidateContentPaths(parsed.data.postId);
  return { success: true };
}
