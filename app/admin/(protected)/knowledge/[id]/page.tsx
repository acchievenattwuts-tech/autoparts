export const dynamic = "force-dynamic";

import { notFound } from "next/navigation";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import { ensureAccessControlSetupOnce } from "@/lib/access-control";
import { parseKnowledgeContent } from "@/lib/knowledge-cms-types";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import KnowledgeActions from "../KnowledgeActions";
import KnowledgeEditor from "../KnowledgeEditor";

const labels: Record<string, string> = { DRAFT: "ร่าง", PENDING_APPROVAL: "รออนุมัติ", SYNCING: "กำลังสร้าง embedding", ACTIVE: "ใช้งานอยู่", SYNC_FAILED: "Sync ล้มเหลว", REJECTED: "ไม่อนุมัติ", ARCHIVED: "เก็บถาวร" };

export default async function KnowledgeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await ensureAccessControlSetupOnce();
  await requirePermission("knowledge.view");
  const { id } = await params;
  const source = await db.knowledgeSource.findUnique({
    where: { id },
    include: {
      activeRevision: true,
      revisions: { orderBy: { revisionNo: "desc" }, include: { createdByUser: { select: { name: true } }, approvedByUser: { select: { name: true } }, approvals: { orderBy: { requestedAt: "desc" }, take: 1 } } },
      auditLogs: { orderBy: { createdAt: "desc" }, take: 20, include: { actorUser: { select: { name: true } } } },
    },
  });
  if (!source) notFound();
  const revision = source.revisions.find((item) => ["DRAFT", "REJECTED", "PENDING_APPROVAL", "SYNCING", "SYNC_FAILED"].includes(item.status)) ?? source.activeRevision ?? source.revisions[0];
  if (!revision) notFound();
  const content = parseKnowledgeContent(revision.content);
  const editable = ["DRAFT", "REJECTED", "SYNC_FAILED"].includes(revision.status);
  return <div className="space-y-5">
    <AdminPageHeader eyebrow={`${source.type} · revision ${revision.revisionNo}`} title={revision.title} description={`สถานะ: ${labels[revision.status] ?? revision.status}`} meta={revision.syncError ? <span className="text-rose-600 dark:text-rose-300">Sync error: {revision.syncError}</span> : undefined} actions={<KnowledgeActions sourceId={source.id} revisionId={revision.id} status={revision.status} hasActive={Boolean(source.activeRevisionId)} />} />
    {revision.rejectionReason && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200"><strong>เหตุผลที่ไม่อนุมัติ:</strong> {revision.rejectionReason}</div>}
    {editable ? <KnowledgeEditor initial={{ revisionId: revision.id, sourceId: source.id, type: source.type, slug: source.slug ?? "", title: revision.title, description: revision.description ?? "", category: revision.category ?? "", content, answerScope: revision.answerScope, riskLevel: revision.riskLevel, ragEnabled: revision.ragEnabled, sourceUrls: Array.isArray(revision.sourceUrls) ? revision.sourceUrls.filter((item): item is string => typeof item === "string") : [], updatedAt: revision.updatedAt.toISOString() }} /> : <>
      <AdminSectionCard title="ตัวอย่างเนื้อหาที่จะเผยแพร่" description="หน้านี้เป็นการอ่านอย่างเดียว สร้าง revision ใหม่ก่อนแก้ไข">
        <div className="space-y-5"><p className="leading-7 text-slate-700 dark:text-slate-300">{content.intro}</p>{content.highlights.length > 0 && <ul className="rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-700 dark:bg-white/5 dark:text-slate-300">{content.highlights.map((item) => <li key={item}>• {item}</li>)}</ul>}{content.sections.map((section) => <section key={section.heading}><div className="flex items-center gap-2"><h3 className="font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">{section.heading}</h3>{section.aiEnabled && revision.ragEnabled && <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-700 dark:bg-sky-500/15 dark:text-sky-200">AI ใช้ได้</span>}</div><div className="mt-2 space-y-2">{section.body.map((line) => <p key={line} className="text-sm leading-7 text-slate-600 dark:text-slate-300">{section.format === "BULLETS" ? `• ${line}` : line}</p>)}</div></section>)}</div>
      </AdminSectionCard>
      <AdminSectionCard title="ขอบเขต AI"><p className="text-sm leading-7 text-slate-700 dark:text-slate-300">{revision.answerScope}</p></AdminSectionCard>
    </>}
    <AdminSectionCard title="ประวัติเวอร์ชันและกิจกรรม" bodyClassName="p-0"><div className="divide-y divide-slate-100 dark:divide-white/5">{source.revisions.map((item) => <div key={item.id} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"><div><span className="font-medium text-slate-900 dark:text-slate-100">Revision {item.revisionNo}</span><span className="ml-2 text-slate-500">{labels[item.status] ?? item.status}</span></div><span className="text-xs text-slate-500">{item.createdByUser.name} · {item.updatedAt.toLocaleString("th-TH")}</span></div>)}</div></AdminSectionCard>
  </div>;
}
