export const dynamic = "force-dynamic";

import Link from "next/link";

import { db } from "@/lib/db";
import {
  AUDIT_ACTION_OPTIONS,
  AUDIT_PAGE_SIZE,
  buildAuditLogListHref,
  buildAuditLogWhere,
  formatAuditTimestamp,
  getAuditActionBadgeClass,
  getAuditActionLabel,
  getAuditEntityLabel,
  getAuditSourceHref,
  parseAuditLogSearchParams,
} from "@/lib/audit-log-view";
import { requirePermission } from "@/lib/require-auth";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

const FILTER_INPUT_CLASS =
  "rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none ring-0 placeholder:text-gray-400 focus:border-sky-400 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500";

export default async function AuditLogPage({ searchParams }: PageProps) {
  await requirePermission("audit_log.view");

  const params = await searchParams;
  const filters = parseAuditLogSearchParams(params);
  const where = buildAuditLogWhere(filters);
  const skip = (filters.page - 1) * AUDIT_PAGE_SIZE;

  const [rows, total] = filters.ready
    ? await Promise.all([
        db.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: AUDIT_PAGE_SIZE,
          select: {
            id: true,
            action: true,
            createdAt: true,
            entityId: true,
            entityRef: true,
            entityType: true,
            ipAddress: true,
            userName: true,
            userRole: true,
          },
        }),
        db.auditLog.count({ where }),
      ])
    : [[], 0];

  const totalPages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
          บันทึกการใช้งาน
        </h1>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          ตรวจสอบว่าใครสร้าง แก้ไข ยกเลิก เปลี่ยนสิทธิ์ เข้าสู่ระบบ หรือสั่งงานสำคัญอะไรไว้ในระบบ
        </p>
      </div>

      <form className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/40 md:grid-cols-2 xl:grid-cols-6">
        <input type="hidden" name="ready" value="1" />
        <input
          type="text"
          name="user"
          defaultValue={filters.user}
          placeholder="ผู้ใช้ / รหัสผู้ใช้"
          className={FILTER_INPUT_CLASS}
        />
        <select
          name="action"
          defaultValue={filters.action}
          className={FILTER_INPUT_CLASS}
        >
          <option value="">ทุกเหตุการณ์</option>
          {AUDIT_ACTION_OPTIONS.map((action) => (
            <option key={action} value={action}>
              {getAuditActionLabel(action)}
            </option>
          ))}
        </select>
        <input
          type="text"
          name="entityType"
          defaultValue={filters.entityType}
          placeholder="ประเภทเอกสาร / เมนู"
          className={FILTER_INPUT_CLASS}
        />
        <input
          type="text"
          name="entityRef"
          defaultValue={filters.entityRef}
          placeholder="เลขที่เอกสาร / รหัสอ้างอิง"
          className={FILTER_INPUT_CLASS}
        />
        <input
          type="date"
          name="startDate"
          defaultValue={filters.startDate}
          className={FILTER_INPUT_CLASS}
        />
        <input
          type="date"
          name="endDate"
          defaultValue={filters.endDate}
          className={FILTER_INPUT_CLASS}
        />
        <div className="flex gap-2 md:col-span-2 xl:col-span-6">
          <button
            type="submit"
            className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-600"
          >
            ค้นหา
          </button>
          <Link
            href="/admin/audit-log"
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-sky-400 hover:text-sky-600 dark:border-white/10 dark:text-slate-200 dark:hover:border-sky-400 dark:hover:text-sky-300"
          >
            ล้างตัวกรอง
          </Link>
        </div>
      </form>

      {!filters.ready ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center shadow-sm dark:border-white/15 dark:bg-slate-950/40">
          <h2 className="font-kanit text-xl font-semibold text-gray-900 dark:text-slate-100">
            พร้อมค้นหาประวัติการใช้งาน
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-gray-500 dark:text-slate-400">
            หน้านี้ยังไม่ query ข้อมูลอัตโนมัติเมื่อเปิดครั้งแรก เพื่อกันการสแกนตารางขนาดใหญ่โดยไม่จำเป็น
            เลือกช่วงวันที่หรือเงื่อนไขที่ต้องการ แล้วกด &quot;ค้นหา&quot; เพื่อโหลดรายการ
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 text-sm text-gray-500 dark:text-slate-400 md:flex-row md:items-center md:justify-between">
            <span>พบ {total.toLocaleString()} รายการ</span>
            <span>
              แสดง {rows.length.toLocaleString()} รายการต่อหน้า จากทั้งหมด {totalPages.toLocaleString()} หน้า
            </span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/40">
            {rows.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-gray-500 dark:text-slate-400">
                ไม่พบบันทึกที่ตรงกับเงื่อนไขที่ค้นหา
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-white/10">
                  <thead className="bg-gray-50 dark:bg-slate-900/80">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                      <th className="px-4 py-3">เวลา</th>
                      <th className="px-4 py-3">ผู้ใช้</th>
                      <th className="px-4 py-3">เหตุการณ์</th>
                      <th className="px-4 py-3">ประเภท</th>
                      <th className="px-4 py-3">อ้างอิง</th>
                      <th className="px-4 py-3">ต้นทาง</th>
                      <th className="px-4 py-3 text-right">รายละเอียด</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-white/10">
                    {rows.map((row) => {
                      const sourceHref = getAuditSourceHref(row.entityType, row.entityId);

                      return (
                        <tr key={row.id} className="align-top">
                          <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-200">
                            <div>{formatAuditTimestamp(row.createdAt)}</div>
                            <div className="mt-1 text-xs text-gray-500 dark:text-slate-500">
                              IP: {row.ipAddress ?? "-"}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-200">
                            <div className="font-medium text-gray-900 dark:text-slate-100">
                              {row.userName ?? "ระบบ"}
                            </div>
                            <div className="mt-1 text-xs text-gray-500 dark:text-slate-500">
                              {row.userRole ?? "-"}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getAuditActionBadgeClass(row.action)}`}
                            >
                              {getAuditActionLabel(row.action)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-200">
                            {getAuditEntityLabel(row.entityType)}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 dark:text-slate-200">
                            <div className="font-medium text-gray-900 dark:text-slate-100">
                              {row.entityRef ?? "-"}
                            </div>
                            <div className="mt-1 text-xs text-gray-500 dark:text-slate-500">
                              ID: {row.entityId ?? "-"}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {sourceHref ? (
                              <Link
                                href={sourceHref}
                                className="font-medium text-sky-600 hover:text-sky-700 dark:text-sky-300 dark:hover:text-sky-200"
                              >
                                เปิดเอกสารต้นทาง
                              </Link>
                            ) : (
                              <span className="text-gray-400 dark:text-slate-500">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-sm">
                            <Link
                              href={`/admin/audit-log/${row.id}?${new URLSearchParams({
                                user: filters.user,
                                action: filters.action,
                                entityType: filters.entityType,
                                entityRef: filters.entityRef,
                                startDate: filters.startDate,
                                endDate: filters.endDate,
                                page: String(filters.page),
                                ready: "1",
                              }).toString()}`}
                              className="font-medium text-sky-600 hover:text-sky-700 dark:text-sky-300 dark:hover:text-sky-200"
                            >
                              ดูรายละเอียด
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div>
              {filters.page > 1 ? (
                <Link
                  href={buildAuditLogListHref(filters, filters.page - 1)}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-sky-400 hover:text-sky-600 dark:border-white/10 dark:text-slate-200 dark:hover:border-sky-400 dark:hover:text-sky-300"
                >
                  ก่อนหน้า
                </Link>
              ) : null}
            </div>
            <div>
              {filters.page < totalPages ? (
                <Link
                  href={buildAuditLogListHref(filters, filters.page + 1)}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-sky-400 hover:text-sky-600 dark:border-white/10 dark:text-slate-200 dark:hover:border-sky-400 dark:hover:text-sky-300"
                >
                  ถัดไป
                </Link>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
