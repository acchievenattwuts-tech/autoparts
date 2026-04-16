export const dynamic = "force-dynamic";

import ContentManager from "@/app/admin/(protected)/content/ContentManager";
import { ensureAccessControlSetup } from "@/lib/access-control";
import { getContentRuntimeStatus } from "@/lib/content-config";
import { getContentApproverUsers } from "@/lib/content-line";
import { listRecentContentPosts } from "@/lib/content-repository";
import { requirePermission } from "@/lib/require-auth";

export default async function ContentPage() {
  await ensureAccessControlSetup();
  await requirePermission("content.view");

  const [posts, approvers, runtimeStatus] = await Promise.all([
    listRecentContentPosts(),
    getContentApproverUsers(),
    Promise.resolve(getContentRuntimeStatus()),
  ]);

  return (
    <ContentManager
      runtimeStatus={{
        ...runtimeStatus,
        approverCount: approvers.length,
      }}
      posts={posts.map((post) => ({
        id: post.id,
        title: post.title,
        caption: post.caption,
        status: post.status,
        scheduledAt: post.scheduledAt?.toISOString() ?? null,
        postedAt: post.postedAt?.toISOString() ?? null,
        createdAt: post.createdAt.toISOString(),
        variantGroupId: post.variantGroupId,
        variantNo: post.variantNo,
        isSelectedVariant: post.isSelectedVariant,
        createdByUser: post.createdByUser,
        approvedByUser: post.approvedByUser,
        approvals: post.approvals.map((approval) => ({
          id: approval.id,
          status: approval.status,
          approverUser: approval.approverUser,
        })),
        scheduledJobs: post.scheduledJobs.map((job) => ({
          id: job.id,
          status: job.status,
          runAt: job.runAt.toISOString(),
        })),
      }))}
    />
  );
}
