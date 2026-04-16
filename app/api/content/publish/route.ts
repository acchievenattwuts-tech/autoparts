export const dynamic = "force-dynamic";

import {
  ContentNotificationType,
  ContentPostStatus,
  ContentScheduledJobStatus,
} from "@/lib/generated/prisma";
import { getContentConfig } from "@/lib/content-config";
import { db } from "@/lib/db";
import { publishFacebookPagePost } from "@/lib/content-facebook";
import { sendContentWorkflowNotification } from "@/lib/content-line";
import { getQStashReceiver } from "@/lib/content-qstash";
import { createContentAuditLog } from "@/lib/content-repository";

async function processPublishJob(jobId: string) {
  const job = await db.contentScheduledJob.findUnique({
    where: { id: jobId },
    include: {
      post: {
        select: {
          id: true,
          title: true,
          caption: true,
          imageUrl: true,
          linkUrl: true,
          status: true,
          scheduledAt: true,
          facebookPageId: true,
          createdByUserId: true,
          approvedByUserId: true,
        },
      },
    },
  });

  if (!job) {
    return Response.json({ error: "JOB_NOT_FOUND" }, { status: 404 });
  }

  if (job.status === ContentScheduledJobStatus.CANCELLED || job.post.status === ContentPostStatus.CANCELLED) {
    return Response.json({ skipped: true, reason: "CANCELLED" });
  }

  if (job.status === ContentScheduledJobStatus.SUCCEEDED || job.post.status === ContentPostStatus.POSTED) {
    return Response.json({ skipped: true, reason: "ALREADY_PUBLISHED" });
  }

  if (job.status === ContentScheduledJobStatus.RUNNING) {
    return Response.json({ skipped: true, reason: "ALREADY_RUNNING" });
  }

  const claimResult = await db.contentScheduledJob.updateMany({
    where: {
      id: jobId,
      status: {
        in: [
          ContentScheduledJobStatus.PENDING,
          ContentScheduledJobStatus.DISPATCHED,
          ContentScheduledJobStatus.FAILED,
        ],
      },
    },
    data: {
      status: ContentScheduledJobStatus.RUNNING,
      startedAt: new Date(),
      attemptCount: { increment: 1 },
      lastError: null,
    },
  });

  if (claimResult.count === 0) {
    return Response.json({ skipped: true, reason: "JOB_STATE_NOT_ELIGIBLE" });
  }

  try {
    const metaPostId = await publishFacebookPagePost(job.post);

    await db.$transaction(async (tx) => {
      await tx.contentPost.update({
        where: { id: job.post.id },
        data: {
          status: ContentPostStatus.POSTED,
          postedAt: new Date(),
          metaPostId,
          lastError: null,
          failedAt: null,
        },
      });

      await tx.contentScheduledJob.update({
        where: { id: jobId },
        data: {
          status: ContentScheduledJobStatus.SUCCEEDED,
          finishedAt: new Date(),
          lastError: null,
        },
      });
    });

    await createContentAuditLog({
      postId: job.post.id,
      action: "PUBLISH_SUCCEEDED",
      detail: `QStash เรียกโพสต์สำเร็จ (${metaPostId})`,
      notificationType: ContentNotificationType.POST_PUBLISHED,
    });

    const config = getContentConfig();
    if (config.appBaseUrl) {
      await sendContentWorkflowNotification({
        post: job.post,
        recipientUserIds: [
          ...new Set(
            [job.post.createdByUserId, job.post.approvedByUserId].filter((value): value is string => !!value)
          ),
        ],
        heading: "โพสต์ Facebook ถูกเผยแพร่แล้ว",
        detail: "ระบบ schedule โพสต์เข้า Facebook สำเร็จแล้ว",
        appBaseUrl: config.appBaseUrl,
      }).catch((error) => {
        console.warn("[content] scheduled publish notification failed", error);
      });
    }

    return Response.json({ success: true, metaPostId });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "UNKNOWN_PUBLISH_ERROR";

    await db.$transaction(async (tx) => {
      await tx.contentScheduledJob.update({
        where: { id: jobId },
        data: {
          status: ContentScheduledJobStatus.FAILED,
          finishedAt: new Date(),
          lastError: errorMessage,
        },
      });

      await tx.contentPost.update({
        where: { id: job.post.id },
        data: {
          status: ContentPostStatus.FAILED,
          failedAt: new Date(),
          lastError: errorMessage,
        },
      });
    });

    await createContentAuditLog({
      postId: job.post.id,
      action: "PUBLISH_FAILED",
      detail: errorMessage,
      notificationType: ContentNotificationType.POST_FAILED,
    });

    const config = getContentConfig();
    if (config.appBaseUrl) {
      await sendContentWorkflowNotification({
        post: job.post,
        recipientUserIds: [
          ...new Set(
            [job.post.createdByUserId, job.post.approvedByUserId].filter((value): value is string => !!value)
          ),
        ],
        heading: "โพสต์ Facebook ส่งไม่สำเร็จ",
        detail: errorMessage,
        appBaseUrl: config.appBaseUrl,
      }).catch((notifyError) => {
        console.warn("[content] scheduled publish failure notification failed", notifyError);
      });
    }

    return Response.json({ error: errorMessage }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const signature = request.headers.get("upstash-signature");
  if (!signature) {
    return Response.json({ error: "MISSING_QSTASH_SIGNATURE" }, { status: 401 });
  }

  const rawBody = await request.text();
  const config = getContentConfig();

  try {
    const receiver = getQStashReceiver();
    await receiver.verify({
      signature,
      body: rawBody,
      url: config.appBaseUrl ? `${config.appBaseUrl}/api/content/publish` : request.url,
    });
  } catch (error) {
    console.warn("[content] invalid qstash signature", error);
    return Response.json({ error: "INVALID_QSTASH_SIGNATURE" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody) as { jobId?: string };
  const jobId = payload.jobId?.trim();
  if (!jobId) {
    return Response.json({ error: "JOB_ID_REQUIRED" }, { status: 400 });
  }

  return processPublishJob(jobId);
}
