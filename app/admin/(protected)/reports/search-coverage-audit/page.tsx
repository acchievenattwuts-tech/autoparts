/**
 * Phase Q3 - Backfill Audit (Search Coverage) Report.
 *
 * Read-only diagnostic page showing which active products lack data that
 * makes them findable/sellable:
 *   - Thai keyword
 *   - Vehicle fitment
 *   - Image
 *   - Sale price (still 0 = not priced yet)
 */

export const dynamic = "force-dynamic";

import Link from "next/link";

import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import AdminTableSection from "@/components/shared/AdminTableSection";
import Pagination from "@/components/shared/Pagination";
import { db } from "@/lib/db";
import { AliasKind, Prisma } from "@/lib/generated/prisma";
import { getAdminMasterRowClass } from "@/lib/admin-status-presentation";
import { requirePermission } from "@/lib/require-auth";

const PAGE_SIZE = 20;
const FILTER_OPTIONS = [
  "all",
  "missing_keyword",
  "missing_fitment",
  "missing_image",
  "missing_price",
] as const;

type FilterOption = (typeof FILTER_OPTIONS)[number];

const isFilterOption = (raw: string | undefined): raw is FilterOption =>
  typeof raw === "string" && (FILTER_OPTIONS as readonly string[]).includes(raw);

type PageProps = {
  searchParams: Promise<{ filter?: string; page?: string; cancelled?: string }>;
};

type TotalsRow = {
  total: number;
  missingKeyword: number;
  missingFitment: number;
  missingImage: number;
  missingPrice: number;
  fullyCovered: number;
};

type CoverageRow = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  missingKeyword: boolean;
  missingFitment: boolean;
  missingImage: boolean;
  missingPrice: boolean;
  missingCount: number;
};

const buildCoverageCte = (includeCancelled: boolean) => Prisma.sql`
  WITH coverage AS (
    SELECT
      p.id,
      p.code,
      p.name,
      p."isActive",
      NOT EXISTS (
        SELECT 1
        FROM "ProductAlias" pa
        WHERE pa."productId" = p.id
          AND pa.kind IN (${AliasKind.KEYWORD}, ${AliasKind.TH}, ${AliasKind.MISSPELL}, ${AliasKind.ALIAS})
          AND pa.alias ~ '[ก-๙]'
      ) AS "missingKeyword",
      NOT EXISTS (
        SELECT 1
        FROM "ProductCarModel" pf
        WHERE pf."productId" = p.id
      ) AS "missingFitment",
      COALESCE(NULLIF(BTRIM(p."imageUrl"), ''), NULL) IS NULL AS "missingImage",
      (p."salePrice" = 0) AS "missingPrice",
      (
        (NOT EXISTS (
          SELECT 1
          FROM "ProductAlias" pa
          WHERE pa."productId" = p.id
            AND pa.kind IN (${AliasKind.KEYWORD}, ${AliasKind.TH}, ${AliasKind.MISSPELL}, ${AliasKind.ALIAS})
            AND pa.alias ~ '[ก-๙]'
        ))::int +
        (NOT EXISTS (
          SELECT 1
          FROM "ProductCarModel" pf
          WHERE pf."productId" = p.id
        ))::int +
        (COALESCE(NULLIF(BTRIM(p."imageUrl"), ''), NULL) IS NULL)::int +
        (p."salePrice" = 0)::int
      ) AS "missingCount"
    FROM "Product" p
    ${includeCancelled ? Prisma.empty : Prisma.sql`WHERE p."isActive" = true`}
  )
`;

const getFilterWhereSql = (filter: FilterOption) => {
  switch (filter) {
    case "missing_keyword":
      return Prisma.sql`"missingKeyword" = true`;
    case "missing_fitment":
      return Prisma.sql`"missingFitment" = true`;
    case "missing_image":
      return Prisma.sql`"missingImage" = true`;
    case "missing_price":
      return Prisma.sql`"missingPrice" = true`;
    case "all":
    default:
      return Prisma.sql`"missingCount" > 0`;
  }
};

export default async function SearchCoverageAuditPage({ searchParams }: PageProps) {
  await requirePermission("search_coverage.view");

  const params = await searchParams;
  const filter: FilterOption = isFilterOption(params.filter) ? params.filter : "all";
  const includeCancelled = params.cancelled === "show";
  const requestedPage = Math.max(1, parseInt(params.page ?? "1", 10) || 1);
  const filterWhereSql = getFilterWhereSql(filter);
  const coverageCte = buildCoverageCte(includeCancelled);

  const [totalsResult, filteredCountResult] = await Promise.all([
    db.$queryRaw<TotalsRow[]>(Prisma.sql`
      ${coverageCte}
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE "missingKeyword")::int AS "missingKeyword",
        COUNT(*) FILTER (WHERE "missingFitment")::int AS "missingFitment",
        COUNT(*) FILTER (WHERE "missingImage")::int AS "missingImage",
        COUNT(*) FILTER (WHERE "missingPrice")::int AS "missingPrice",
        COUNT(*) FILTER (
          WHERE NOT "missingKeyword"
            AND NOT "missingFitment"
            AND NOT "missingImage"
            AND NOT "missingPrice"
        )::int AS "fullyCovered"
      FROM coverage
    `),
    db.$queryRaw<Array<{ count: number }>>(Prisma.sql`
      ${coverageCte}
      SELECT COUNT(*)::int AS count
      FROM coverage
      WHERE ${filterWhereSql}
    `),
  ]);

  const totals = totalsResult[0] ?? {
    total: 0,
    missingKeyword: 0,
    missingFitment: 0,
    missingImage: 0,
    missingPrice: 0,
    fullyCovered: 0,
  };
  const filteredCount = filteredCountResult[0]?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));
  const currentPage = Math.min(requestedPage, totalPages);

  const rows = await db.$queryRaw<CoverageRow[]>(Prisma.sql`
    ${coverageCte}
    SELECT
      id,
      code,
      name,
      "isActive",
      "missingKeyword",
      "missingFitment",
      "missingImage",
      "missingPrice",
      "missingCount"
    FROM coverage
    WHERE ${filterWhereSql}
    ORDER BY "missingCount" DESC, code ASC
    OFFSET ${(currentPage - 1) * PAGE_SIZE}
    LIMIT ${PAGE_SIZE}
  `);

  const coveragePct = totals.total === 0 ? 100 : Math.round((totals.fullyCovered / totals.total) * 100);
  const paginationParams: Record<string, string> = {};
  if (filter !== "all") paginationParams.filter = filter;
  if (includeCancelled) paginationParams.cancelled = "show";

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Search Coverage Audit"
        description="ตรวจสอบสินค้าที่ขาดข้อมูลซึ่งทำให้ค้นหายากหรือขายไม่ได้ เช่น คำค้นภาษาไทย, ความเข้ากันได้กับรถยนต์, รูป, ราคาขาย"
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <AdminSectionCard title="ครอบคลุมเต็ม">
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{coveragePct}%</p>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            {totals.fullyCovered} / {totals.total} สินค้า
          </p>
        </AdminSectionCard>
        <AdminSectionCard title="ขาดคำค้น TH">
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{totals.missingKeyword}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400">รายการ</p>
        </AdminSectionCard>
        <AdminSectionCard title="ขาดความเข้ากันได้กับรถยนต์">
          <p className="text-2xl font-bold text-sky-600 dark:text-sky-400">{totals.missingFitment}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400">รายการ</p>
        </AdminSectionCard>
        <AdminSectionCard title="ขาดรูป">
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{totals.missingImage}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400">รายการ</p>
        </AdminSectionCard>
        <AdminSectionCard title="ยังไม่ตั้งราคาขาย">
          <p className="text-2xl font-bold text-rose-600 dark:text-rose-400">{totals.missingPrice}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400">รายการ</p>
        </AdminSectionCard>
      </div>

      <AdminFilterToolbar>
        <AdminSearchForm method="GET" className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300">
            <span>กรอง:</span>
            <select
              name="filter"
              defaultValue={filter}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="all">ทั้งหมดที่ขาดข้อมูล</option>
              <option value="missing_keyword">ขาดคำค้นภาษาไทย</option>
              <option value="missing_fitment">ขาดความเข้ากันได้กับรถยนต์</option>
              <option value="missing_image">ขาดรูป</option>
              <option value="missing_price">ยังไม่ตั้งราคาขาย</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-slate-300">
            <span>สินค้าที่ยกเลิก:</span>
            <select
              name="cancelled"
              defaultValue={includeCancelled ? "show" : "hide"}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="hide">ซ่อนสินค้าที่ยกเลิก</option>
              <option value="show">แสดงทั้งหมด</option>
            </select>
          </label>
          <AdminSearchSubmitButton className="inline-flex justify-center rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055]">
            แสดงรายการ
          </AdminSearchSubmitButton>
        </AdminSearchForm>
      </AdminFilterToolbar>

      <AdminTableSection title={`รายการ (${filteredCount})`}>
        {rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-emerald-600 dark:text-emerald-400">
            สินค้าทั้งหมดมีข้อมูลครบ
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-white/5">
                <tr className="border-b border-gray-100 dark:border-white/10">
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">รหัส</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ชื่อสินค้า</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ขาดข้อมูล</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={`border-t border-gray-50 transition-colors dark:border-white/10 ${getAdminMasterRowClass(
                      row.isActive,
                    )}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-slate-200">
                      <span>{row.code}</span>
                      {!row.isActive ? (
                        <span className="ml-2 inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                          ยกเลิก
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-gray-800 dark:text-slate-100">{row.name}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {row.missingKeyword ? (
                          <span className="inline-flex items-center rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                            คำค้น TH
                          </span>
                        ) : null}
                        {row.missingFitment ? (
                          <span className="inline-flex items-center rounded-full border border-sky-100 bg-sky-50 px-2 py-0.5 text-xs text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
                            ความเข้ากันได้กับรถยนต์
                          </span>
                        ) : null}
                        {row.missingImage ? (
                          <span className="inline-flex items-center rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                            รูป
                          </span>
                        ) : null}
                        {row.missingPrice ? (
                          <span className="inline-flex items-center rounded-full border border-rose-100 bg-rose-50 px-2 py-0.5 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
                            ราคาขาย
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/products/${row.id}/edit`}
                        className="inline-flex items-center rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#163055]"
                      >
                        แก้ไข
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminTableSection>

      <Pagination
        currentPage={currentPage}
        totalPages={totalPages}
        basePath="/admin/reports/search-coverage-audit"
        searchParams={paginationParams}
      />

      <p className="text-xs text-gray-500 dark:text-slate-400">
        * แสดงสินค้าที่ข้อมูลยังไม่ครบ{includeCancelled ? " (รวมสินค้าที่ยกเลิก — แถวสีชมพู)" : " เฉพาะที่ยังใช้งาน"} แบ่งหน้าละ {PAGE_SIZE} รายการ
      </p>
    </div>
  );
}
