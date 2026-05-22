export const dynamic = "force-dynamic";

import Link from "next/link";

import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import {
  formatDateTimeThai,
  getThailandDateKey,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

const PAGE_SIZE = 100;

const parseDateParam = (value: string | undefined, boundary: "start" | "end"): Date | undefined => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  return boundary === "start" ? parseDateOnlyToStartOfDay(value) : parseDateOnlyToEndOfDay(value);
};

const getFilterLabel = (filters: unknown): string => {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return "-";

  const entries = Object.entries(filters)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);

  return entries.length > 0 ? entries.join(" | ") : "-";
};

const getSourceLabel = (source: string): string => (source === "storefront" ? "หน้าร้าน" : "หลังบ้าน");

export default async function ProductSearchNoResultPage({ searchParams }: PageProps) {
  await requirePermission("product_search_report.view");

  const params = await searchParams;
  const today = getThailandDateKey();
  const fromInput = params.from || "";
  const toInput = params.to || today;
  const source = params.source || "";
  const search = params.search?.trim() || "";

  const from = parseDateParam(fromInput, "start");
  const to = parseDateParam(toInput, "end");
  const where = {
    resultCount: 0,
    ...(source ? { source } : {}),
    ...(search ? { query: { contains: search, mode: "insensitive" as const } } : {}),
    ...((from || to) ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };

  const [logs, total, storefrontTotal, adminTotal] = await Promise.all([
    db.productSearchLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    }),
    db.productSearchLog.count({ where }),
    db.productSearchLog.count({ where: { ...where, source: "storefront" } }),
    db.productSearchLog.count({ where: { ...where, source: "admin" } }),
  ]);

  const topQueries = Array.from(
    logs.reduce((map, item) => {
      const current = map.get(item.query) ?? { query: item.query, count: 0, latestAt: item.createdAt };
      current.count += 1;
      if (item.createdAt > current.latestAt) current.latestAt = item.createdAt;
      map.set(item.query, current);
      return map;
    }, new Map<string, { query: string; count: number; latestAt: Date }>()),
  )
    .map(([, value]) => value)
    .sort((left, right) => right.count - left.count || right.latestAt.getTime() - left.latestAt.getTime())
    .slice(0, 10);

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Product Search No Result"
        description="ติดตามคำค้นหาสินค้าที่ไม่พบผลลัพธ์จากหน้าร้านและหลังบ้าน เพื่อใช้ปรับคำค้นและข้อมูลสินค้า"
      />

      <AdminSearchForm method="GET" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          ตั้งแต่วันที่
          <input
            type="date"
            name="from"
            defaultValue={fromInput}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          ถึงวันที่
          <input
            type="date"
            name="to"
            defaultValue={toInput}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          แหล่งที่มา
          <select
            name="source"
            defaultValue={source}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">ทั้งหมด</option>
            <option value="storefront">หน้าร้าน</option>
            <option value="admin">หลังบ้าน</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
          คำค้น
          <input
            type="text"
            name="search"
            defaultValue={search}
            placeholder="ค้นหาในคำค้นที่ไม่พบ"
            className="h-9 w-[18rem] rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <AdminSearchSubmitButton className="h-9 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]">
          แสดงรายการ
        </AdminSearchSubmitButton>
        <Link
          href="/admin/reports/product-search-no-result"
          className="inline-flex h-9 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
        >
          ล้าง
        </Link>
      </AdminSearchForm>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
          <p className="text-xs text-gray-500 dark:text-slate-400">No-result ทั้งหมด</p>
          <p className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">{total.toLocaleString("th-TH")}</p>
        </div>
        <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-4 shadow-sm dark:border-cyan-400/20 dark:bg-cyan-400/10">
          <p className="text-xs text-cyan-700 dark:text-cyan-200">หน้าร้าน</p>
          <p className="font-kanit text-2xl font-bold text-cyan-800 dark:text-cyan-100">{storefrontTotal.toLocaleString("th-TH")}</p>
        </div>
        <div className="rounded-xl border border-amber-100 bg-amber-50 p-4 shadow-sm dark:border-amber-400/20 dark:bg-amber-400/10">
          <p className="text-xs text-amber-700 dark:text-amber-200">หลังบ้าน</p>
          <p className="font-kanit text-2xl font-bold text-amber-800 dark:text-amber-100">{adminTotal.toLocaleString("th-TH")}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/80">
          <div className="border-b border-gray-100 px-4 py-3 dark:border-white/10">
            <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">รายการล่าสุด</h2>
            <p className="text-xs text-gray-500 dark:text-slate-400">แสดงสูงสุด {PAGE_SIZE} รายการล่าสุดตามตัวกรอง</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#1e3a5f] text-white">
                <tr>
                  <th className="px-3 py-2.5 text-left font-medium">เวลา</th>
                  <th className="px-3 py-2.5 text-left font-medium">คำค้น</th>
                  <th className="px-3 py-2.5 text-left font-medium">แหล่งที่มา</th>
                  <th className="px-3 py-2.5 text-left font-medium">ตัวกรอง</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/10">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-gray-400 dark:text-slate-500">
                      ไม่พบข้อมูลตามเงื่อนไขที่เลือก
                    </td>
                  </tr>
                ) : (
                  logs.map((item) => (
                    <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                      <td className="whitespace-nowrap px-3 py-2 text-gray-500 dark:text-slate-400">{formatDateTimeThai(item.createdAt)}</td>
                      <td className="max-w-[20rem] truncate px-3 py-2 font-medium text-gray-900 dark:text-slate-100">{item.query}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-slate-300">{getSourceLabel(item.source)}</td>
                      <td className="max-w-[28rem] truncate px-3 py-2 text-xs text-gray-500 dark:text-slate-400">{getFilterLabel(item.filters)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
          <h2 className="font-kanit text-base font-semibold text-gray-900 dark:text-slate-100">Top 10 คำค้น</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">นับจากรายการล่าสุดในตัวกรองนี้</p>
          <div className="mt-4 space-y-2">
            {topQueries.length === 0 ? (
              <p className="rounded-lg border border-dashed border-gray-200 px-3 py-6 text-center text-sm text-gray-400 dark:border-white/10 dark:text-slate-500">
                ยังไม่มีข้อมูล
              </p>
            ) : (
              topQueries.map((item) => (
                <div key={item.query} className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2 dark:border-white/10">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 dark:text-slate-100">{item.query}</p>
                    <p className="text-xs text-gray-400 dark:text-slate-500">{formatDateTimeThai(item.latestAt)}</p>
                  </div>
                  <span className="rounded-full bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-400/10 dark:text-rose-200">
                    {item.count}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
