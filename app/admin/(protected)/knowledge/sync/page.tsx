export const dynamic = "force-dynamic";

import Link from "next/link";
import { CheckCircle2, Clock3, Database, RefreshCw, TriangleAlert } from "lucide-react";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import { ensureAccessControlSetupOnce } from "@/lib/access-control";
import { db } from "@/lib/db";
import { getKnowledgeEmbeddingModelId } from "@/lib/knowledge-embeddings";
import { requirePermission } from "@/lib/require-auth";
import KnowledgeTabs from "../KnowledgeTabs";
import KnowledgeActions from "../KnowledgeActions";

export default async function KnowledgeSyncPage() {
  await ensureAccessControlSetupOnce();
  await requirePermission("knowledge.view");
  const [jobs, chunks] = await Promise.all([
    db.knowledgeSyncJob.findMany({ include: { revision: { include: { source: true } } }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.$queryRaw<Array<{ approved: number; archived: number }>>`SELECT count(*) FILTER (WHERE status='APPROVED')::int AS approved, count(*) FILTER (WHERE status='ARCHIVED')::int AS archived FROM knowledge_documents`,
  ]);
  const lastSuccess = jobs.find((job) => job.status === "SUCCEEDED");
  const pending = jobs.filter((job) => ["PENDING", "RUNNING"].includes(job.status)).length;
  const failed = jobs.filter((job) => job.status === "FAILED").length;
  const cards = [
    ["Model สำหรับ RAG", getKnowledgeEmbeddingModelId(), Database],
    ["Active chunks", chunks[0]?.approved ?? 0, CheckCircle2],
    ["กำลังรอ/ทำงาน", pending, Clock3],
    ["ล้มเหลว", failed, TriangleAlert],
  ] as const;
  return <div><AdminPageHeader eyebrow="คลังความรู้ AI" title="สถานะ Sync" description="Cron ทำงานทุก 6 ชั่วโมง เวอร์ชันเดิมจะยังใช้งานต่อหาก revision ใหม่สร้าง embedding ไม่สำเร็จ" meta={`สำเร็จล่าสุด: ${lastSuccess?.finishedAt?.toLocaleString("th-TH") ?? "-"}`} /><KnowledgeTabs active="sync" /><div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, Icon]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/80"><Icon className="h-5 w-5 text-sky-600" /><p className="mt-3 text-xs text-slate-500">{label}</p><p className="mt-1 font-semibold text-slate-900 dark:text-white">{value}</p></div>)}</div><AdminSectionCard title="ประวัติงาน Sync" description="Product embedding-1 ไม่ได้อยู่ในตารางหรือกระบวนการนี้" bodyClassName="p-0"><div className="overflow-x-auto"><table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-slate-500 dark:bg-white/5"><tr><th className="px-4 py-3">เนื้อหา</th><th className="px-4 py-3">Trigger</th><th className="px-4 py-3">สถานะ</th><th className="px-4 py-3">เวลา</th><th className="px-4 py-3">จัดการ</th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-white/5">{jobs.map((job) => <tr key={job.id}><td className="px-4 py-3"><Link href={`/admin/knowledge/${job.revision.sourceId}`} className="font-medium text-slate-900 hover:text-orange-600 dark:text-slate-100">{job.revision.title}</Link><p className="text-xs text-slate-500">revision {job.revision.revisionNo}</p></td><td className="px-4 py-3 text-slate-500">{job.trigger}</td><td className="px-4 py-3"><span className={job.status === "SUCCEEDED" ? "text-emerald-600" : job.status === "FAILED" ? "text-rose-600" : "text-sky-600"}>{job.status}</span>{job.lastError && <p className="mt-1 max-w-md text-xs text-rose-500">{job.lastError}</p>}</td><td className="px-4 py-3 text-slate-500">{job.createdAt.toLocaleString("th-TH")}</td><td className="px-4 py-3">{job.status === "FAILED" ? <KnowledgeActions sourceId={job.revision.sourceId} revisionId={job.revisionId} status="SYNC_FAILED" hasActive={Boolean(job.revision.source.activeRevisionId)} /> : <RefreshCw className="h-4 w-4 text-slate-300" />}</td></tr>)}</tbody></table></div></AdminSectionCard></div>;
}
