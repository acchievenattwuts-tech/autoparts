export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";

import {
  buildAuditDiffRows,
  buildAuditLogListHref,
  formatAuditJson,
  formatAuditTimestamp,
  getAuditActionBadgeClass,
  getAuditActionLabel,
  getAuditEntityLabel,
  getAuditSourceHref,
  parseAuditLogSearchParams,
} from "@/lib/audit-log-view";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};

export default async function AuditLogDetailPage({
  params,
  searchParams,
}: PageProps) {
  await requirePermission("audit_log.view");

  const [{ id }, rawSearchParams] = await Promise.all([params, searchParams]);
  const filters = parseAuditLogSearchParams(rawSearchParams);

  const row = await db.auditLog.findUnique({
    where: { id },
  });

  if (!row) {
    notFound();
  }

  const diffRows = buildAuditDiffRows(row.before, row.after);
  const sourceHref = getAuditSourceHref(row.entityType, row.entityId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="space-y-2">
          <Link
            href={buildAuditLogListHref(filters)}
            className="inline-flex text-sm font-medium text-sky-600 hover:text-sky-700 dark:text-sky-300 dark:hover:text-sky-200"
          >
            กลับไปหน้ารายการ
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getAuditActionBadgeClass(row.action)}`}
            >
              {getAuditActionLabel(row.action)}
            </span>
            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-white/5 dark:text-slate-300">
              {getAuditEntityLabel(row.entityType)}
            </span>
          </div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
            รายละเอียดบันทึกการใช้งาน
          </h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            ตรวจสอบค่าก่อนและหลังการเปลี่ยนแปลง พร้อมข้อมูลประกอบของเหตุการณ์นี้
          </p>
        </div>

        {sourceHref ? (
          <Link
            href={sourceHref}
            className="inline-flex items-center rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 transition hover:border-sky-300 hover:bg-sky-100 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-200 dark:hover:border-sky-400/40 dark:hover:bg-sky-500/15"
          >
            เปิดเอกสารต้นทาง
          </Link>
        ) : null}
      </div>

      <section className="grid gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/40 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
            ผู้ใช้
          </p>
          <p className="mt-1 text-sm font-medium text-gray-900 dark:text-slate-100">
            {row.userName ?? "ระบบ"}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">{row.userRole ?? "-"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
            เวลา
          </p>
          <p className="mt-1 text-sm font-medium text-gray-900 dark:text-slate-100">
            {formatAuditTimestamp(row.createdAt)}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
            อ้างอิง
          </p>
          <p className="mt-1 text-sm font-medium text-gray-900 dark:text-slate-100">
            {row.entityRef ?? "-"}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">
            ID: {row.entityId ?? "-"}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
            Request
          </p>
          <p className="mt-1 text-sm font-medium text-gray-900 dark:text-slate-100">
            IP: {row.ipAddress ?? "-"}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-500 break-all">
            {row.userAgent ?? "-"}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/40">
        <div className="border-b border-gray-200 px-5 py-4 dark:border-white/10">
          <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">
            เปรียบเทียบก่อนและหลัง
          </h2>
        </div>
        {diffRows.length === 0 ? (
          <div className="px-5 py-8 text-sm text-gray-500 dark:text-slate-400">
            รายการนี้ไม่มี field diff ที่ต้องแสดงเพิ่มเติม
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-white/10">
              <thead className="bg-gray-50 dark:bg-slate-900/80">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                  <th className="px-4 py-3">Field</th>
                  <th className="px-4 py-3">ก่อนเปลี่ยน</th>
                  <th className="px-4 py-3">หลังเปลี่ยน</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-white/10">
                {diffRows.map((item) => (
                  <tr key={item.path} className="align-top">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-slate-100">
                      {item.path}
                    </td>
                    <td className="px-4 py-3">
                      <pre className="whitespace-pre-wrap break-words rounded-xl bg-rose-50 p-3 text-xs text-rose-900 dark:bg-rose-500/10 dark:text-rose-100">
                        {item.before}
                      </pre>
                    </td>
                    <td className="px-4 py-3">
                      <pre className="whitespace-pre-wrap break-words rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-100">
                        {item.after}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
          <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">
            ก่อนเปลี่ยน
          </h2>
          <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-gray-50 p-3 text-xs text-gray-700 dark:bg-slate-900/70 dark:text-slate-300">
            {formatAuditJson(row.before)}
          </pre>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
          <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">
            หลังเปลี่ยน
          </h2>
          <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-gray-50 p-3 text-xs text-gray-700 dark:bg-slate-900/70 dark:text-slate-300">
            {formatAuditJson(row.after)}
          </pre>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/40">
          <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">
            ข้อมูลเพิ่มเติม
          </h2>
          <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-gray-50 p-3 text-xs text-gray-700 dark:bg-slate-900/70 dark:text-slate-300">
            {formatAuditJson(row.meta)}
          </pre>
        </div>
      </section>
    </div>
  );
}
