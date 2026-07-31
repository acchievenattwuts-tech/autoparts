export const dynamic = "force-dynamic";

import {
  Activity,
  Bot,
  CircleAlert,
  Clock3,
  MessageCircleMore,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import { ensureAccessControlSetupOnce } from "@/lib/access-control";
import { KNOWLEDGE_FEEDBACK_REASONS } from "@/lib/knowledge-rag-feedback";
import { getKnowledgeRagDashboardData } from "@/lib/knowledge-rag-operations";
import { requirePermission } from "@/lib/require-auth";
import { formatDateTimeThai } from "@/lib/th-date";
import KnowledgeTabs from "../KnowledgeTabs";
import QualityGapActions from "./QualityGapActions";

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default async function KnowledgeQualityPage() {
  await ensureAccessControlSetupOnce();
  await requirePermission("knowledge.view");
  const data = await getKnowledgeRagDashboardData(30);
  const total = data.metrics.reduce((sum, item) => sum + item.total, 0);
  const answered = data.metrics.reduce((sum, item) => sum + item.answered, 0);
  const handoff = data.metrics.reduce(
    (sum, item) =>
      sum +
      item.humanOnly +
      item.noRetrieval +
      item.unsupported +
      item.generationError,
    0,
  );
  const averageLatency =
    total === 0
      ? 0
      : Math.round(
          data.metrics.reduce(
            (sum, item) => sum + item.averageLatencyMs * item.total,
            0,
          ) / total,
        );
  const openGaps = data.gaps.filter((item) =>
    ["NEW", "REVIEWED"].includes(item.status),
  ).length;
  const cards = [
    ["คำถามผ่าน RAG", total, Activity, "30 วันล่าสุด"],
    ["AI ตอบสำเร็จ", total === 0 ? "-" : percent(answered / total), Bot, `${answered} ครั้ง`],
    ["ส่งต่อ/ไม่ตอบ", total === 0 ? "-" : percent(handoff / total), MessageCircleMore, `${handoff} ครั้ง`],
    ["Latency เฉลี่ย", `${averageLatency} ms`, Clock3, "รวม retrieval + generation"],
    ["Gap รอดำเนินการ", openGaps, CircleAlert, "ไม่เก็บข้อความลูกค้า"],
    ["Feedback ดี/ต้องปรับ", `${data.feedback.good}/${data.feedback.bad}`, ThumbsUp, `${data.feedback.total} รายการ`],
  ] as const;

  return (
    <div>
      <AdminPageHeader
        eyebrow="คลังความรู้ AI"
        title="คุณภาพและช่องว่างความรู้"
        description="ติดตาม coverage, no-answer, latency และ handoff แยก LINE/Messenger โดยไม่เก็บข้อความหรือข้อมูลระบุตัวลูกค้า"
      />
      <KnowledgeTabs active="quality" />

      {!data.available && (
        <div
          role="alert"
          className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          ยังไม่พบตาราง Round D ในฐานข้อมูล ให้รัน{" "}
          <code>npm run db:setup-knowledge-rag</code> หลัง deploy
        </div>
      )}

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map(([label, value, Icon, note]) => (
          <div
            key={label}
            className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/80"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-500">{label}</p>
              <Icon className="h-5 w-5 text-sky-600 dark:text-sky-400" />
            </div>
            <p className="mt-2 text-2xl font-semibold text-slate-900 dark:text-white">
              {value}
            </p>
            <p className="mt-1 text-xs text-slate-500">{note}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <AdminSectionCard
          title="ผลแยกตามช่องทาง"
          description="Coverage คือสัดส่วนที่ RAG ตอบได้ ส่วน Handoff รวม human-only, no retrieval, unsupported และ generation error"
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500 dark:bg-white/5">
                <tr>
                  <th className="px-4 py-3">ช่องทาง</th>
                  <th className="px-4 py-3">ทั้งหมด</th>
                  <th className="px-4 py-3">Coverage</th>
                  <th className="px-4 py-3">No retrieval</th>
                  <th className="px-4 py-3">Unsupported</th>
                  <th className="px-4 py-3">Handoff</th>
                  <th className="px-4 py-3">เฉลี่ย</th>
                  <th className="px-4 py-3">&gt;3s</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {data.metrics.map((metric) => (
                  <tr key={metric.channel}>
                    <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                      {metric.channel === "line" ? "LINE" : "Messenger"}
                    </td>
                    <td className="px-4 py-3">{metric.total}</td>
                    <td className="px-4 py-3 text-emerald-600 dark:text-emerald-300">
                      {percent(metric.coverageRate)}
                    </td>
                    <td className="px-4 py-3">{metric.noRetrieval}</td>
                    <td className="px-4 py-3">{metric.unsupported}</td>
                    <td className="px-4 py-3">{percent(metric.handoffRate)}</td>
                    <td className="px-4 py-3">{metric.averageLatencyMs} ms</td>
                    <td className="px-4 py-3">{percent(metric.slowRate)}</td>
                  </tr>
                ))}
                {data.metrics.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-500">
                      ยังไม่มี telemetry หลัง deploy
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </AdminSectionCard>

        <AdminSectionCard
          title="Feedback จากผู้ดูแล"
          description="เก็บเฉพาะคะแนนและ reason code"
        >
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-500/10">
              <ThumbsUp className="h-5 w-5 text-emerald-600" />
              <p className="mt-2 text-xs text-slate-500">ดี</p>
              <p className="text-xl font-semibold text-emerald-700 dark:text-emerald-300">
                {data.feedback.good}
              </p>
            </div>
            <div className="rounded-xl bg-rose-50 p-4 dark:bg-rose-500/10">
              <ThumbsDown className="h-5 w-5 text-rose-600" />
              <p className="mt-2 text-xs text-slate-500">ต้องปรับ</p>
              <p className="text-xl font-semibold text-rose-700 dark:text-rose-300">
                {data.feedback.bad}
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {data.feedback.badReasons.map((item) => (
              <div
                key={item.reasonCode}
                className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-white/5"
              >
                <span className="text-slate-600 dark:text-slate-300">
                  {KNOWLEDGE_FEEDBACK_REASONS[
                    item.reasonCode as keyof typeof KNOWLEDGE_FEEDBACK_REASONS
                  ] ?? item.reasonCode}
                </span>
                <span className="font-medium">{item.count}</span>
              </div>
            ))}
            {data.feedback.badReasons.length === 0 && (
              <p className="py-3 text-sm text-slate-500">ยังไม่มี feedback ที่ต้องปรับ</p>
            )}
          </div>
        </AdminSectionCard>
      </div>

      <div className="mt-5">
        <AdminSectionCard
          title="Knowledge-gap backlog"
          description="ระบบแสดงเฉพาะ query hash และสัญญาณ aggregate ผู้มีสิทธิ์ต้องตั้งชื่อและกดตรวจแล้วก่อนสร้างร่าง ร่างใหม่จะปิด RAG ไว้เสมอ"
          bodyClassName="p-0"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500 dark:bg-white/5">
                <tr>
                  <th className="px-4 py-3">สัญญาณ</th>
                  <th className="px-4 py-3">จำนวน</th>
                  <th className="px-4 py-3">สถานะ</th>
                  <th className="px-4 py-3">พบล่าสุด</th>
                  <th className="px-4 py-3">ดำเนินการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {data.gaps.map((gap) => (
                  <tr key={gap.id} className="align-top">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs text-slate-800 dark:text-slate-200">
                        {gap.queryHash}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {gap.channel === "line" ? "LINE" : "Messenger"} · {gap.outcome}
                        {gap.reasonCode ? ` · ${gap.reasonCode}` : ""}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-semibold">{gap.occurrences}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700 dark:bg-white/10 dark:text-slate-200">
                        {gap.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {formatDateTimeThai(gap.lastSeenAt)} น.
                    </td>
                    <td className="px-4 py-3">
                      <QualityGapActions gap={gap} />
                    </td>
                  </tr>
                ))}
                {data.gaps.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-500">
                      ยังไม่มี knowledge gap
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </AdminSectionCard>
      </div>
    </div>
  );
}
