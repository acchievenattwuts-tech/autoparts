export const dynamic = "force-dynamic";

import Link from "next/link";

import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";

const PAGE_SIZE = 50;
const ACTION_OPTIONS = Object.values(AuditAction);

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

function buildPageHref(
  params: Record<string, string | undefined>,
  page: number,
): string {
  const nextParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      nextParams.set(key, value);
    }
  }

  nextParams.set("page", String(page));
  nextParams.set("ready", "1");
  return `/admin/audit-log?${nextParams.toString()}`;
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }

  return JSON.stringify(value, null, 2);
}

export default async function AuditLogPage({ searchParams }: PageProps) {
  await requirePermission("audit_log.view");

  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const action =
    params.action && ACTION_OPTIONS.includes(params.action as AuditAction)
      ? (params.action as AuditAction)
      : "";
  const isReady = params.ready === "1";
  const page = Math.max(1, Number.parseInt(params.page ?? "1", 10) || 1);
  const skip = (page - 1) * PAGE_SIZE;

  const where = isReady
    ? {
        ...(action ? { action } : {}),
        ...(q
          ? {
              OR: [
                { userName: { contains: q, mode: "insensitive" as const } },
                { entityType: { contains: q, mode: "insensitive" as const } },
                { entityRef: { contains: q, mode: "insensitive" as const } },
                { entityId: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      }
    : undefined;

  const [rows, total] = isReady
    ? await Promise.all([
        db.auditLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip,
          take: PAGE_SIZE,
        }),
        db.auditLog.count({ where }),
      ])
    : [[], 0];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
          บันทึกการใช้งาน
        </h1>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          ตรวจสอบประวัติการสร้าง แก้ไข ยกเลิก เข้าสู่ระบบ เปลี่ยนสิทธิ์ และ export ในระบบหลังบ้าน
        </p>
      </div>

      <form className="grid gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/40 md:grid-cols-[minmax(0,1fr)_220px_120px]">
        <input type="hidden" name="ready" value="1" />
        <input
          type="text"
          name="q"
          defaultValue={q}
          placeholder="ค้นหาจากชื่อผู้ใช้ ประเภทเอกสาร เลขอ้างอิง หรือรหัส"
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none ring-0 placeholder:text-gray-400 focus:border-sky-400 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
        />
        <select
          name="action"
          defaultValue={action}
          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none ring-0 focus:border-sky-400 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
        >
          <option value="">ทุกเหตุการณ์</option>
          {ACTION_OPTIONS.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-600"
        >
          ค้นหา
        </button>
      </form>

      {!isReady ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center shadow-sm dark:border-white/15 dark:bg-slate-950/40">
          <h2 className="font-kanit text-xl font-semibold text-gray-900 dark:text-slate-100">
            พร้อมค้นหาประวัติการใช้งาน
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-gray-500 dark:text-slate-400">
            หน้านี้จะยังไม่โหลดข้อมูลอัตโนมัติเมื่อเปิดเข้ามาครั้งแรก เพื่อไม่ให้ query หนักเกินจำเป็น
            เลือกเงื่อนไขที่ต้องการแล้วกดปุ่ม &quot;ค้นหา&quot; เพื่อแสดงรายการ
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-sm text-gray-500 dark:text-slate-400">
            <span>พบ {total.toLocaleString()} รายการ</span>
            <span>หน้า {page} / {totalPages}</span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/40">
            {rows.length === 0 ? (
              <div className="px-6 py-12 text-center text-sm text-gray-500 dark:text-slate-400">
                ไม่พบรายการที่ตรงกับเงื่อนไขที่ค้นหา
              </div>
            ) : (
              <div className="divide-y divide-gray-200 dark:divide-white/10">
                {rows.map((row) => (
                  <article key={row.id} className="space-y-4 px-5 py-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">
                            {row.action}
                          </span>
                          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-white/5 dark:text-slate-300">
                            {row.entityType}
                          </span>
                          {row.entityRef ? (
                            <span className="text-sm font-medium text-gray-900 dark:text-slate-100">
                              {row.entityRef}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-sm text-gray-600 dark:text-slate-400">
                          <span className="font-medium text-gray-900 dark:text-slate-100">
                            {row.userName ?? "ไม่ทราบผู้ใช้งาน"}
                          </span>
                          {" | "}
                          <span>{row.userRole ?? "-"}</span>
                          {" | "}
                          <span>{new Date(row.createdAt).toLocaleString("th-TH")}</span>
                        </div>
                        <div className="text-xs text-gray-500 dark:text-slate-500">
                          entityId: {row.entityId ?? "-"}
                          {" | "}
                          ip: {row.ipAddress ?? "-"}
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 lg:grid-cols-3">
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-slate-900/70">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                          ก่อนเปลี่ยน
                        </p>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-700 dark:text-slate-300">
                          {formatJson(row.before)}
                        </pre>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-slate-900/70">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                          หลังเปลี่ยน
                        </p>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-700 dark:text-slate-300">
                          {formatJson(row.after)}
                        </pre>
                      </div>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-slate-900/70">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                          ข้อมูลเพิ่มเติม
                        </p>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs text-gray-700 dark:text-slate-300">
                          {formatJson(row.meta)}
                        </pre>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <div>
              {page > 1 ? (
                <Link
                  href={buildPageHref(
                    { ...params, q, action: action || undefined, ready: "1" },
                    page - 1,
                  )}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition hover:border-sky-400 hover:text-sky-600 dark:border-white/10 dark:text-slate-200 dark:hover:border-sky-400 dark:hover:text-sky-300"
                >
                  ก่อนหน้า
                </Link>
              ) : null}
            </div>
            <div>
              {page < totalPages ? (
                <Link
                  href={buildPageHref(
                    { ...params, q, action: action || undefined, ready: "1" },
                    page + 1,
                  )}
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
