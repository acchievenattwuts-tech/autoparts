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

export async function hasActiveContentPublishJob(postId: string) {
  const existing = await db.contentScheduledJob.findFirst({
    where: {
      postId,
      type: ContentScheduledJobType.PUBLISH_POST,
      status: {
        in: [
          ContentScheduledJobStatus.PENDING,
          ContentScheduledJobStatus.DISPATCHED,
          ContentScheduledJobStatus.RUNNING,
        ],
      },
    },
    select: { id: true },
  });

  return Boolean(existing);
}
