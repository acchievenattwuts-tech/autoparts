export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  BookOpenCheck,
  CalendarClock,
  CircleAlert,
  Clock3,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import { ensureAccessControlSetupOnce } from "@/lib/access-control";
import { listKnowledgeAdmin } from "@/lib/knowledge-cms-repository";
import { db } from "@/lib/db";
import type {
  KnowledgeRevisionStatus,
  KnowledgeSourceType,
} from "@/lib/generated/prisma";
import { formatKnowledgeTimestamp } from "@/lib/knowledge-cms-format";
import { parseKnowledgeContent } from "@/lib/knowledge-cms-types";
import {
  assessKnowledgeQuality,
  expiryUrgency,
  findKnowledgeDuplicateIssues,
  knowledgeEvidenceLevelLabel,
} from "@/lib/knowledge-cms-quality";
import { requirePermission } from "@/lib/require-auth";
import KnowledgeTabs from "./KnowledgeTabs";

const statusLabel: Record<string, string> = {
  DRAFT: "ร่าง",
  PENDING_APPROVAL: "รออนุมัติ",
  SYNCING: "กำลัง Sync",
  ACTIVE: "ใช้งานอยู่",
  SYNC_FAILED: "Sync ล้มเหลว",
  REJECTED: "ไม่อนุมัติ",
  ARCHIVED: "เก็บถาวร",
};
const statusTone: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-300",
  PENDING_APPROVAL:
    "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
  SYNCING: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200",
  ACTIVE:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
  SYNC_FAILED:
    "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200",
  REJECTED: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-200",
  ARCHIVED: "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400",
};

export default async function KnowledgeAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string; status?: string }>;
}) {
  await ensureAccessControlSetupOnce();
  await requirePermission("knowledge.view");
  const params = await searchParams;
  const type = ["ARTICLE", "FAQ", "POLICY"].includes(params.type ?? "")
    ? (params.type as KnowledgeSourceType)
    : undefined;
  const status = [
    "DRAFT",
    "PENDING_APPROVAL",
    "SYNCING",
    "ACTIVE",
    "SYNC_FAILED",
    "REJECTED",
    "ARCHIVED",
  ].includes(params.status ?? "")
    ? (params.status as KnowledgeRevisionStatus)
    : undefined;
  const [
    sources,
    activeCount,
    pendingCount,
    failedCount,
    syncState,
    activeInventory,
    activeUsers,
  ] =
    await Promise.all([
      listKnowledgeAdmin({ query: params.q?.trim(), type, status }),
      db.knowledgeSource.count({
        where: { isArchived: false, activeRevisionId: { not: null } },
      }),
      db.knowledgeRevision.count({ where: { status: "PENDING_APPROVAL" } }),
      db.knowledgeRevision.count({ where: { status: "SYNC_FAILED" } }),
      db.knowledgeSyncJob.findFirst({
        where: { status: "SUCCEEDED" },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true },
      }),
      db.knowledgeSource.findMany({
        where: { isArchived: false, activeRevisionId: { not: null } },
        select: {
          id: true,
          type: true,
          activeRevision: {
            select: {
              title: true,
              content: true,
              ragEnabled: true,
              sourceUrls: true,
            },
          },
        },
      }),
      db.user.findMany({
        select: { id: true, name: true, isActive: true },
      }),
    ]);
  const ownerNames = new Map(activeUsers.map((user) => [user.id, user.name]));
  const inventoryRows = activeInventory.flatMap((source) => {
    if (!source.activeRevision) return [];
    const content = parseKnowledgeContent(source.activeRevision.content);
    const sourceUrls = Array.isArray(source.activeRevision.sourceUrls)
      ? source.activeRevision.sourceUrls.filter(
          (item): item is string => typeof item === "string",
        )
      : [];
    return [
      {
        sourceId: source.id,
        type: source.type,
        title: source.activeRevision.title,
        intro: content.intro,
        content,
        ragEnabled: source.activeRevision.ragEnabled,
        sourceUrls,
      },
    ];
  });
  const qualityBySourceId = new Map(
    inventoryRows.map((row) => {
      const qualityIssues = assessKnowledgeQuality(row);
      const duplicateIssues = findKnowledgeDuplicateIssues({
        sourceId: row.sourceId,
        title: row.title,
        intro: row.intro,
        others: inventoryRows,
      });
      return [row.sourceId, [...qualityIssues, ...duplicateIssues]] as const;
    }),
  );
  const needsReviewCount = inventoryRows.filter(
    (row) => (qualityBySourceId.get(row.sourceId)?.length ?? 0) > 0,
  ).length;
  const expiredCount = inventoryRows.filter(
    (row) => expiryUrgency(row.content.governance?.validUntil) === "EXPIRED",
  ).length;
  const dueSoonCount = inventoryRows.filter(
    (row) => expiryUrgency(row.content.governance?.validUntil) === "DUE_SOON",
  ).length;
  const duplicateCount = inventoryRows.filter((row) =>
    qualityBySourceId
      .get(row.sourceId)
      ?.some(
        (issue) =>
          issue.code === "DUPLICATE_TITLE" ||
          issue.code === "CONFLICTING_ANSWER",
      ),
  ).length;
  const cards = [
    {
      label: "ใช้งานอยู่",
      value: activeCount,
      icon: BookOpenCheck,
      tone: "text-emerald-600",
    },
    {
      label: "รออนุมัติ",
      value: pendingCount,
      icon: Clock3,
      tone: "text-amber-600",
    },
    {
      label: "Sync ไม่สำเร็จ",
      value: failedCount,
      icon: CircleAlert,
      tone: "text-rose-600",
    },
    {
      label: "Sync สำเร็จล่าสุด (เวลาไทย)",
      value: syncState?.finishedAt
        ? formatKnowledgeTimestamp(syncState.finishedAt)
        : "-",
      icon: RefreshCw,
      tone: "text-sky-600",
    },
  ];
  const qualityCards = [
    {
      label: "ต้องปรับข้อมูลกำกับ",
      value: needsReviewCount,
      icon: ShieldCheck,
      tone:
        needsReviewCount > 0 ? "text-amber-600" : "text-emerald-600",
    },
    {
      label: "เกินกำหนดทบทวน",
      value: expiredCount,
      icon: CalendarClock,
      tone: expiredCount > 0 ? "text-rose-600" : "text-emerald-600",
    },
    {
      label: "ครบกำหนดใน 30 วัน",
      value: dueSoonCount,
      icon: Clock3,
      tone: dueSoonCount > 0 ? "text-amber-600" : "text-emerald-600",
    },
    {
      label: "ซ้ำหรือขัดแย้ง",
      value: duplicateCount,
      icon: CircleAlert,
      tone: duplicateCount > 0 ? "text-rose-600" : "text-emerald-600",
    },
  ];
  return (
    <div className="space-y-5">
      <AdminPageHeader
        eyebrow="AI Knowledge"
        title="คลังความรู้ AI"
        description="แหล่งข้อมูลเดียวสำหรับหน้าเว็บ LINE และ Facebook Messenger โดยไม่เปลี่ยน logic ค้นหาสินค้า"
        actions={
          <Link
            href="/admin/knowledge/new"
            className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-orange-600"
          >
            <Plus className="h-4 w-4" />
            เพิ่มความรู้
          </Link>
        }
      />
      <KnowledgeTabs active="library" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/80"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {card.label}
              </p>
              <card.icon className={`h-5 w-5 ${card.tone}`} />
            </div>
            <p className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              {card.value}
            </p>
          </div>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {qualityCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/80"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {card.label}
              </p>
              <card.icon className={`h-5 w-5 ${card.tone}`} />
            </div>
            <p className="mt-2 text-xl font-semibold text-slate-950 dark:text-white">
              {card.value}
            </p>
          </div>
        ))}
      </div>
      <AdminSectionCard title="ค้นหาและกรอง">
        <AdminSearchForm
          action="/admin/knowledge"
          className="grid gap-3 md:grid-cols-[1fr_180px_200px_auto] md:items-end"
        >
          <div>
            <label className="mb-1 block text-sm text-slate-600 dark:text-slate-300">
              คำค้น
            </label>
            <input
              name="q"
              defaultValue={params.q ?? ""}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-900"
              placeholder="ชื่อ, slug หรือรหัส"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600 dark:text-slate-300">
              ประเภท
            </label>
            <select
              name="type"
              defaultValue={type ?? ""}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-900"
            >
              <option value="">ทั้งหมด</option>
              <option value="FAQ">FAQ</option>
              <option value="ARTICLE">บทความ</option>
              <option value="POLICY">นโยบาย</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600 dark:text-slate-300">
              สถานะ
            </label>
            <select
              name="status"
              defaultValue={status ?? ""}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-900"
            >
              <option value="">ทั้งหมด</option>
              {Object.entries(statusLabel).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <AdminSearchSubmitButton label="ค้นหา" />
        </AdminSearchForm>
      </AdminSectionCard>
      <AdminSectionCard
        title={`รายการทั้งหมด (${sources.length})`}
        bodyClassName="p-0"
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">เนื้อหา</th>
                <th className="px-4 py-3">ประเภท</th>
                <th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3">AI</th>
                <th className="px-4 py-3">คุณภาพ</th>
                <th className="px-4 py-3">ผู้รับผิดชอบ / ทบทวน</th>
                <th className="px-4 py-3">อัปเดต</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {sources.map((source) => {
                const revision = source.revisions[0] ?? source.activeRevision;
                const currentStatus = revision?.status ?? "ARCHIVED";
                const content = revision
                  ? parseKnowledgeContent(revision.content)
                  : null;
                const revisionUrls =
                  revision && Array.isArray(revision.sourceUrls)
                    ? revision.sourceUrls.filter(
                        (item): item is string => typeof item === "string",
                      )
                    : [];
                const qualityIssues = revision
                  ? [
                      ...assessKnowledgeQuality({
                        type: source.type,
                        content: content!,
                        ragEnabled: revision.ragEnabled,
                        sourceUrls: revisionUrls,
                      }),
                      ...(qualityBySourceId
                        .get(source.id)
                        ?.filter(
                          (issue) =>
                            issue.code === "DUPLICATE_TITLE" ||
                            issue.code === "CONFLICTING_ANSWER",
                        ) ?? []),
                    ]
                  : [];
                const ownerName = content?.governance?.ownerUserId
                  ? ownerNames.get(content.governance.ownerUserId)
                  : source.revisions[0]?.createdByUser.name;
                return (
                  <tr
                    key={source.id}
                    className="hover:bg-slate-50 dark:hover:bg-white/5"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/knowledge/${source.id}`}
                        className="font-medium text-slate-900 hover:text-orange-600 dark:text-slate-100"
                      >
                        {revision?.title ?? source.sourceKey}
                      </Link>
                      <p className="mt-1 text-xs text-slate-500">
                        {source.slug ?? source.sourceKey}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {qualityIssues.length === 0 ? (
                        <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200">
                          พร้อมใช้งาน
                        </span>
                      ) : (
                        <span
                          title={qualityIssues
                            .map((issue) => issue.message)
                            .join("\n")}
                          className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200"
                        >
                          ต้องตรวจ {qualityIssues.length} จุด
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      <p>{ownerName ?? "ยังไม่กำหนด"}</p>
                      <p className="mt-1 text-slate-500">
                        {content?.governance?.validUntil
                          ? `ครบกำหนด ${content.governance.validUntil}`
                          : "ยังไม่กำหนดวันทบทวน"}
                      </p>
                      {content?.governance?.evidenceLevel && (
                        <p className="mt-1 text-slate-500">
                          {
                            knowledgeEvidenceLevelLabel[
                              content.governance.evidenceLevel
                            ]
                          }
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {source.type}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusTone[currentStatus]}`}
                      >
                        {statusLabel[currentStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {revision?.ragEnabled ? (
                        <span className="text-emerald-600">เปิด</span>
                      ) : (
                        <span className="text-slate-400">ปิด</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {revision?.updatedAt
                        ? `${formatKnowledgeTimestamp(revision.updatedAt)} น.`
                        : "-"}
                    </td>
                  </tr>
                );
              })}
              {sources.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-slate-500"
                  >
                    ไม่พบรายการ
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AdminSectionCard>
    </div>
  );
}
