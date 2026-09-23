import {
  ContentApprovalStatus,
  ContentNotificationType,
  ContentPostStatus,
  ContentScheduledJobStatus,
  ContentScheduledJobType,
} from "@/lib/generated/prisma";
import { db } from "@/lib/db";

export async function createContentAuditLog(params: {
  postId: string;
  actorUserId?: string | null;
  action: string;
  detail?: string | null;
  metadataJson?: string | null;
  notificationType?: ContentNotificationType | null;
}) {
  await db.contentAuditLog.create({
    data: {
      postId: params.postId,
      actorUserId: params.actorUserId ?? null,
      action: params.action,
      detail: params.detail ?? null,
      metadataJson: params.metadataJson ?? null,
      notificationType: params.notificationType ?? null,
    },
  });
}

export async function getContentPostById(id: string) {
  return db.contentPost.findUnique({
    where: { id },
    include: {
      createdByUser: {
        select: { id: true, name: true, email: true },
      },
      approvedByUser: {
        select: { id: true, name: true, email: true },
      },
      approvals: {
        include: {
          approverUser: {
            select: { id: true, name: true, email: true },
          },
          requestedByUser: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { requestedAt: "desc" },
      },
      scheduledJobs: {
        orderBy: { createdAt: "desc" },
      },
      auditLogs: {
        include: {
          actorUser: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });
}

export async function listRecentContentPosts() {
  return db.contentPost.findMany({
    include: {
      createdByUser: {
        select: { id: true, name: true },
      },
      approvedByUser: {
        select: { id: true, name: true },
      },
      approvals: {
        select: {
          id: true,
          status: true,
          approverUser: {
            select: { id: true, name: true },
          },
        },
        orderBy: { requestedAt: "desc" },
        take: 1,
      },
      scheduledJobs: {
        select: {
          id: true,
          status: true,
          runAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ createdAt: "desc" }],
    take: 30,
  });
}

export async function listPendingApprovalPosts() {
  return db.contentPost.findMany({
    where: { status: ContentPostStatus.PENDING_APPROVAL },
    include: {
      createdByUser: {
        select: { id: true, name: true },
      },
      approvals: {
        where: { status: ContentApprovalStatus.PENDING },
        include: {
          approverUser: {
            select: { id: true, name: true },
          },
        },
        orderBy: { requestedAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ scheduledAt: "asc" }, { updatedAt: "desc" }],
  });
}

export async function createScheduledPublishJob(params: {
  postId: string;
  runAt: Date;
  createdByUserId?: string | null;
}) {
  return db.contentScheduledJob.create({
    data: {
      postId: params.postId,
      type: ContentScheduledJobType.PUBLISH_POST,
      status: ContentScheduledJobStatus.PENDING,
      provider: "QSTASH",
      idempotencyKey: `content-post:${params.postId}:publish:${params.runAt.toISOString()}`,
      runAt: params.runAt,
      createdByUserId: params.createdByUserId ?? null,
    },
  });
}

/**
 * A publish job stays RUNNING only while its function is alive. Vercel caps a
 * function at 800s, so a RUNNING job older than this lease belongs to a
 * function that died (timeout/crash) and will never finish on its own.
 */
export const CONTENT_PUBLISH_RUNNING_LEASE_MS = 15 * 60 * 1000;

export function isContentPublishRunLeaseExpired(startedAt: Date | null, now: Date = new Date()): boolean {
  // No start time recorded: cannot prove it is dead, so treat it as live.
  if (!startedAt) return false;
  return now.getTime() - startedAt.getTime() > CONTENT_PUBLISH_RUNNING_LEASE_MS;
}

export async function hasActiveContentPublishJob(postId: string) {
  const leaseCutoff = new Date(Date.now() - CONTENT_PUBLISH_RUNNING_LEASE_MS);
  const existing = await db.contentScheduledJob.findFirst({
    where: {
      postId,
      type: ContentScheduledJobType.PUBLISH_POST,
      OR: [
        {
          status: {
            in: [ContentScheduledJobStatus.PENDING, ContentScheduledJobStatus.DISPATCHED],
          },
        },
        // A RUNNING job whose lease expired is dead; it must not block
        // approve/requeue forever.
        {
          status: ContentScheduledJobStatus.RUNNING,
          OR: [{ startedAt: null }, { startedAt: { gte: leaseCutoff } }],
        },
      ],
    },
    select: { id: true },
  });

  return Boolean(existing);
}
