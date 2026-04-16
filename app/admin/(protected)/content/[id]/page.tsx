export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import ContentDetailManager from "@/app/admin/(protected)/content/[id]/ContentDetailManager";
import { ensureAccessControlSetup } from "@/lib/access-control";
import { db } from "@/lib/db";
import { getContentApproverUsers } from "@/lib/content-line";
import { getContentPostById } from "@/lib/content-repository";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function ContentDetailPage({ params }: PageProps) {
  await ensureAccessControlSetup();
  await requirePermission("content.view");

  const [{ id }, permissionContext] = await Promise.all([params, getSessionPermissionContext()]);
  const post = await getContentPostById(id);

  if (!post) {
    notFound();
  }

  const [variants, approvers] = await Promise.all([
    post.variantGroupId
      ? db.contentPost.findMany({
          where: { variantGroupId: post.variantGroupId },
          select: {
            id: true,
            title: true,
            caption: true,
            status: true,
            variantNo: true,
            isSelectedVariant: true,
          },
          orderBy: [{ variantNo: "asc" }, { createdAt: "asc" }],
        })
      : Promise.resolve([
          {
            id: post.id,
            title: post.title,
            caption: post.caption,
            status: post.status,
            variantNo: post.variantNo,
            isSelectedVariant: post.isSelectedVariant,
          },
        ]),
    getContentApproverUsers(),
  ]);

  return (
    <ContentDetailManager
      post={{
        id: post.id,
        title: post.title,
        caption: post.caption,
        imageUrl: post.imageUrl,
        linkUrl: post.linkUrl,
        status: post.status,
        scheduledAt: post.scheduledAt?.toISOString() ?? null,
        postedAt: post.postedAt?.toISOString() ?? null,
        approvedAt: post.approvedAt?.toISOString() ?? null,
        lastError: post.lastError,
        createdAt: post.createdAt.toISOString(),
        updatedAt: post.updatedAt.toISOString(),
        createdByUser: post.createdByUser,
        approvedByUser: post.approvedByUser,
        approvals: post.approvals.map((approval) => ({
          id: approval.id,
          status: approval.status,
          requestNote: approval.requestNote,
          decisionNote: approval.decisionNote,
          requestedAt: approval.requestedAt.toISOString(),
          actedAt: approval.actedAt?.toISOString() ?? null,
          approverUser: approval.approverUser,
          requestedByUser: approval.requestedByUser,
        })),
        scheduledJobs: post.scheduledJobs.map((job) => ({
          id: job.id,
          status: job.status,
          runAt: job.runAt.toISOString(),
          attemptCount: job.attemptCount,
          lastError: job.lastError,
        })),
        auditLogs: post.auditLogs.map((log) => ({
          id: log.id,
          action: log.action,
          detail: log.detail,
          notificationType: log.notificationType,
          createdAt: log.createdAt.toISOString(),
          actorUser: log.actorUser,
        })),
      }}
      variants={variants}
      approvers={approvers}
      canUpdate={
        permissionContext.session.user.role === "ADMIN" ||
        permissionContext.permissions.includes("content.update")
      }
      canManage={
        permissionContext.session.user.role === "ADMIN" ||
        permissionContext.permissions.includes("content.manage")
      }
    />
  );
}
