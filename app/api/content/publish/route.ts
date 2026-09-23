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
import {
  CONTENT_PUBLISH_RUNNING_LEASE_MS,
  createContentAuditLog,
  isContentPublishRunLeaseExpired,
} from "@/lib/content-repository";

const STALE_RUN_ERROR = "STALE_RUN_LEASE_EXPIRED";

/**
 * Record the Meta post id the moment Facebook accepts the post, outside the
 * finishing transaction, so a later failure/retry knows the post is already
 * live and never publishes it twice. Best effort: the id is still kept in memory
 * for the finishing step if this write fails.
 */
async function persistMetaPostId(postId: string, metaPostId: string): Promise<void> {
  try {
    await db.contentPost.update({ where: { id: postId }, data: { metaPostId } });
  } catch (error) {
    console.error("[content] failed to record metaPostId right after publishing", error);
  }
}

async function markPublished(
  jobId: string,
  postId: string,
  metaPostId: string,
  jobLastError: string | null,
): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.contentPost.update({
      where: { id: postId },
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
        lastError: jobLastError,
      },
    });
  });
}

/**
 * A RUNNING job past its lease belongs to a function that died. Never re-post
 * automatically (Facebook may already have the post): if the Meta post id was
 * recorded, finish it as POSTED; otherwise mark it FAILED so an admin can check
 * the Page and requeue.
 */
async function releaseStaleRunningJob(jobId: string, post: { id: string; metaPostId: string | null }) {
  const now = new Date();
  const leaseCutoff = new Date(now.getTime() - CONTENT_PUBLISH_RUNNING_LEASE_MS);
  const metaPostId = post.metaPostId;

  const released = await db.$transaction(async (tx) => {
    const result = await tx.contentScheduledJob.updateMany({
      where: {
        id: jobId,
        status: ContentScheduledJobStatus.RUNNING,
        startedAt: { lt: leaseCutoff },
      },
      data: {
        status: metaPostId ? ContentScheduledJobStatus.SUCCEEDED : ContentScheduledJobStatus.FAILED,
        finishedAt: now,
        lastError: STALE_RUN_ERROR,
      },
    });
    if (result.count === 0) return false;

    await tx.contentPost.update({
      where: { id: post.id },
      data: metaPostId
        ? { status: ContentPostStatus.POSTED, postedAt: now, lastError: null, failedAt: null }
        : { status: ContentPostStatus.FAILED, failedAt: now, lastError: STALE_RUN_ERROR },
    });
    return true;
  });

  if (!released) {
    return Response.json({ skipped: true, reason: "ALREADY_RUNNING" });
  }

  try {
    await createContentAuditLog(
      metaPostId
        ? {
            postId: post.id,
            action: "PUBLISH_SUCCEEDED",
            detail: `QStash เรียกโพสต์สำเร็จ (${metaPostId})`,
            notificationType: ContentNotificationType.POST_PUBLISHED,
          }
        : {
            postId: post.id,
            action: "PUBLISH_FAILED",
            detail: STALE_RUN_ERROR,
            notificationType: ContentNotificationType.POST_FAILED,
          },
    );
  } catch (error) {
    console.error("[content] stale publish job audit log failed", error);
  }

  return Response.json({
    skipped: true,
    reason: metaPostId ? "STALE_RUN_FINALIZED" : "STALE_RUN_MARKED_FAILED",
  });
}

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
          metaPostId: true,
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
    if (isContentPublishRunLeaseExpired(job.startedAt)) {
      return releaseStaleRunningJob(jobId, job.post);
    }
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

  // Set once Facebook has the post. A metaPostId already on the post means an
  // earlier attempt published it but did not finish: finish without re-posting.
  let metaPostId: string | null = job.post.metaPostId;
  let finalized = false;
  try {
    if (!metaPostId) {
      metaPostId = await publishFacebookPagePost(job.post);
      await persistMetaPostId(job.post.id, metaPostId);
    }

    await markPublished(jobId, job.post.id, metaPostId, null);
    finalized = true;

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

    if (metaPostId) {
      // The post is live on the Page. Marking it FAILED (and answering 500)
      // would make QStash retry and publish it a second time.
      console.error("[content] post is live on Facebook but finishing the publish job failed", error);
      if (!finalized) {
        try {
          await markPublished(jobId, job.post.id, metaPostId, errorMessage);
        } catch (finalizeError) {
          console.error("[content] could not mark the published post as POSTED", finalizeError);
          return Response.json({ error: errorMessage, metaPostId }, { status: 500 });
        }
      }
      return Response.json({ success: true, metaPostId, warning: errorMessage });
    }

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
