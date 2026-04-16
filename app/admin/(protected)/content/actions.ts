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
import { db } from "@/lib/db";
import { ensureAccessControlSetup } from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import { generateContentDraftIdeas } from "@/lib/content-ai";
import { getContentConfig } from "@/lib/content-config";
import { publishFacebookPagePost } from "@/lib/content-facebook";
import { getContentApproverUsers, sendContentWorkflowNotification } from "@/lib/content-line";
import {
  createContentAuditLog,
  createScheduledPublishJob,
  getContentPostById,
  hasActiveContentPublishJob,
} from "@/lib/content-repository";
import { getQStashClient } from "@/lib/content-qstash";
import { parseBangkokDateTimeLocal } from "@/lib/content-utils";

const generateDraftSchema = z.object({
  topic: z.string().min(3, "กรุณาระบุหัวข้ออย่างน้อย 3 ตัวอักษร").max(200),
  audience: z.string().max(200).optional(),
  callToAction: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});

const updateDraftSchema = z.object({
  id: z.string().min(1),
  title: z.string().max(200).optional(),
  caption: z.string().min(10, "แคปชันต้องมีอย่างน้อย 10 ตัวอักษร").max(5000),
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
    detail: `โพสต์ไป Facebook สำเร็จ (${metaPostId})`,
    notificationType: ContentNotificationType.POST_PUBLISHED,
  });

  const config = getContentConfig();
  if (config.appBaseUrl) {
    await sendContentWorkflowNotification({
      post,
      recipientUserIds: [
        ...new Set([post.createdByUserId, post.approvedByUserId].filter((value): value is string => !!value)),
      ],
      heading: "โพสต์ Facebook ถูกเผยแพร่แล้ว",
      detail: "ระบบโพสต์ไปยัง Facebook Page สำเร็จ",
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
    return { error: "ไม่มีสิทธิ์สร้าง draft คอนเทนต์" };
  }

  const parsed = generateDraftSchema.safeParse({
    topic: formData.get("topic"),
    audience: formData.get("audience") || undefined,
    callToAction: formData.get("callToAction") || undefined,
    notes: formData.get("notes") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const config = getContentConfig();
  if (!config.facebookPageId) {
    return { error: "ยังไม่ได้ตั้งค่า FACEBOOK_PAGE_ID" };
  }

  try {
    const drafts = await generateContentDraftIdeas(parsed.data);
    const variantGroupId = randomUUID();

    await db.$transaction(async (tx) => {
      for (const [index, draft] of drafts.entries()) {
        const post = await tx.contentPost.create({
          data: {
            channel: "FACEBOOK_PAGE",
            title: draft.title,
            caption: draft.caption,
            status: ContentPostStatus.DRAFT,
            facebookPageId: config.facebookPageId!,
            draftSource: config.openAiApiKey ? "AI_OPENAI" : "TEMPLATE_FALLBACK",
            timezone: "Asia/Bangkok",
            variantGroupId,
            variantNo: index + 1,
            isSelectedVariant: index === 0,
            createdByUserId: session.user.id,
          },
        });

        await tx.contentAuditLog.create({
          data: {
            postId: post.id,
            actorUserId: session.user.id,
            action: "DRAFT_CREATED",
            detail: `สร้าง draft ตัวเลือกที่ ${index + 1} จากหัวข้อ ${parsed.data.topic}`,
          },
        });
      }
    });
  } catch (error) {
    console.error("[generateContentDraftsAction]", error);
    return { error: "สร้าง draft ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" };
  }

  revalidateContentPaths();
  return { success: true };
}

export async function updateContentDraftAction(formData: FormData) {
  let session;
  try {
    session = await requirePermission("content.update");
  } catch {
    return { error: "ไม่มีสิทธิ์แก้ไข draft คอนเทนต์" };
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
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const scheduledPublishReadinessError = getScheduledPublishReadinessError();
  if (scheduledPublishReadinessError) {
    return { error: scheduledPublishReadinessError };
  }

  const scheduledAt = parseBangkokDateTimeLocal(parsed.data.scheduledAt);
  if (parsed.data.scheduledAt && !scheduledAt) {
    return { error: "วันเวลาโพสต์ไม่ถูกต้อง" };
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
      detail: "แก้ไขข้อมูล draft",
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
    return { error: "ไม่มีสิทธิ์เลือก draft ที่จะใช้งาน" };
  }

  const postId = String(formData.get("postId") || "").trim();
  if (!postId) {
    return { error: "ไม่พบโพสต์ที่ต้องการเลือก" };
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
      detail: "เลือก draft นี้เป็นตัวหลักของชุด",
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
    return { error: "ไม่มีสิทธิ์ส่งขออนุมัติ" };
  }

  const parsed = requestApprovalSchema.safeParse({
    postId: formData.get("postId"),
    approverUserId: formData.get("approverUserId"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
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
    return { error: "ผู้อนุมัติยังไม่ได้ผูก LINE user ที่ใช้งานได้" };
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
      detail: `ส่งขออนุมัติไปยังผู้ใช้ ${parsed.data.approverUserId}`,
      notificationType: ContentNotificationType.APPROVAL_REQUESTED,
    });

    await sendContentWorkflowNotification({
      post,
      recipientUserIds: [parsed.data.approverUserId],
      heading: "มีโพสต์ Facebook รออนุมัติ",
      detail: "กรุณาเปิดหน้าอนุมัติเพื่อตรวจเนื้อหาและกำหนดการโพสต์",
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
    return { error: "ไม่มีสิทธิ์อนุมัติคอนเทนต์" };
  }

  const parsed = approvalDecisionSchema.safeParse({
    postId: formData.get("postId"),
    scheduledAt: formData.get("scheduledAt") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const scheduledPublishReadinessError = getScheduledPublishReadinessError();
  if (scheduledPublishReadinessError) {
    return { error: scheduledPublishReadinessError };
  }

  const scheduledAt = parseBangkokDateTimeLocal(parsed.data.scheduledAt);
  if (!scheduledAt) {
    return { error: "กรุณาระบุเวลาโพสต์แบบ schedule" };
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
      detail: `อนุมัติและตั้งเวลาโพสต์ ${scheduledAt.toISOString()}`,
      notificationType: ContentNotificationType.POST_SCHEDULED,
    });

    const notificationConfig = getContentConfig();
    if (notificationConfig.appBaseUrl) {
      await sendContentWorkflowNotification({
        post,
        recipientUserIds: [...new Set([post.createdByUserId, session.user.id])],
        heading: "โพสต์ Facebook ถูกอนุมัติและตั้งเวลาแล้ว",
        detail: "ระบบบันทึก schedule เรียบร้อยและจะส่งไป Facebook ตามเวลาที่กำหนด",
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
    return { error: "ไม่มีสิทธิ์โพสต์คอนเทนต์" };
  }

  const parsed = approvalDecisionSchema.safeParse({
    postId: formData.get("postId"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
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
    return { error: "ไม่มีสิทธิ์ตีกลับ draft" };
  }

  const parsed = revisionSchema.safeParse({
    postId: formData.get("postId"),
    decisionNote: formData.get("decisionNote") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
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
      detail: parsed.data.decisionNote?.trim() || "ตีกลับให้แก้ไข draft",
      notificationType: ContentNotificationType.REVISION_REQUESTED,
    });

    const config = getContentConfig();
    if (config.appBaseUrl) {
      await sendContentWorkflowNotification({
        post,
        recipientUserIds: [post.createdByUserId],
        heading: "โพสต์ Facebook ถูกตีกลับให้แก้ไข",
        detail: parsed.data.decisionNote?.trim() || "กรุณาเปิดโพสต์แล้วแก้ไขก่อนส่งอนุมัติใหม่",
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
    return { error: "ไม่มีสิทธิ์ยกเลิกโพสต์" };
  }

  const parsed = cancelSchema.safeParse({
    postId: formData.get("postId"),
  });

  if (!parsed.success) {
    return { error: "ข้อมูลไม่ถูกต้อง" };
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
      detail: "ยกเลิกโพสต์",
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
    return { error: "ไม่มีสิทธิ์ requeue งานโพสต์" };
  }

  const parsed = retryScheduleSchema.safeParse({
    postId: formData.get("postId"),
    scheduledAt: formData.get("scheduledAt") || undefined,
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
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
      detail: `requeue publish job ใหม่สำหรับ ${runAt.toISOString()}`,
      notificationType: ContentNotificationType.POST_SCHEDULED,
    });
  } catch (error) {
    console.error("[retryFailedScheduledPublishAction]", error);
    return { error: "REQUEUE_PUBLISH_FAILED" };
  }

  revalidateContentPaths(parsed.data.postId);
  return { success: true };
}
