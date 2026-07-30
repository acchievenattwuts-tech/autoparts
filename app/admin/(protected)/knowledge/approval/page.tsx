export const dynamic = "force-dynamic";

import Link from "next/link";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import { ensureAccessControlSetupOnce } from "@/lib/access-control";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import KnowledgeTabs from "../KnowledgeTabs";
import KnowledgeActions from "../KnowledgeActions";

export default async function KnowledgeApprovalPage() {
  await ensureAccessControlSetupOnce();
  await requirePermission("knowledge.view");
  const revisions = await db.knowledgeRevision.findMany({ where: { status: "PENDING_APPROVAL" }, include: { source: true, createdByUser: { select: { name: true } }, approvals: { where: { status: "PENDING" }, orderBy: { requestedAt: "desc" }, take: 1 } }, orderBy: { submittedAt: "asc" } });
  return <div><AdminPageHeader eyebrow="คลังความรู้ AI" title="คิวอนุมัติ" description="ผู้ใช้ที่มีสิทธิ์สามารถอนุมัติงานของตนเองได้ตามนโยบายที่กำหนด" /><KnowledgeTabs active="approval" /><AdminSectionCard title={`รออนุมัติ ${revisions.length} รายการ`} bodyClassName="p-0"><div className="divide-y divide-slate-100 dark:divide-white/5">{revisions.map((revision) => <div key={revision.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center"><div><Link href={`/admin/knowledge/${revision.sourceId}`} className="font-medium text-slate-900 hover:text-orange-600 dark:text-slate-100">{revision.title}</Link><p className="mt-1 text-sm text-slate-500">{revision.source.type} · revision {revision.revisionNo} · ส่งโดย {revision.createdByUser.name}</p>{revision.approvals[0]?.requestNote && <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">หมายเหตุ: {revision.approvals[0].requestNote}</p>}</div><KnowledgeActions sourceId={revision.sourceId} revisionId={revision.id} status={revision.status} hasActive={Boolean(revision.source.activeRevisionId)} /></div>)}{revisions.length === 0 && <p className="p-10 text-center text-slate-500">ไม่มีรายการรออนุมัติ</p>}</div></AdminSectionCard></div>;
}
