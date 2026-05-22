/**
 * Phase Q3 - Backfill Audit (Search Coverage) Report.
 *
 * Read-only diagnostic page showing which active products lack data that
 * makes them findable in customer search:
 *   - OEM / Part No.
 *   - Thai keyword
 *   - Image
 *   - Fitment
 */

export const dynamic = "force-dynamic";

import Link from "next/link";

import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import AdminTableSection from "@/components/shared/AdminTableSection";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { AliasKind } from "@/lib/generated/prisma";

const PAGE_SIZE = 200;
const FILTER_OPTIONS = ["all", "missing_oem", "missing_keyword", "missing_image", "missing_fitment"] as const;
type FilterOption = (typeof FILTER_OPTIONS)[number];

const isFilterOption = (raw: string | undefined): raw is FilterOption =>
  typeof raw === "string" && (FILTER_OPTIONS as readonly string[]).includes(raw);

const THAI_CHAR_REGEX = /[ก-๙]/;
const containsThai = (s: string): boolean => THAI_CHAR_REGEX.test(s);

const OEM_KINDS: AliasKind[] = [AliasKind.OEM, AliasKind.PART_NO];
const KEYWORD_KINDS: AliasKind[] = [AliasKind.KEYWORD, AliasKind.TH, AliasKind.MISSPELL, AliasKind.ALIAS];

interface PageProps {
  searchParams: Promise<{ filter?: string }>;
}

export default async function SearchCoverageAuditPage({ searchParams }: PageProps) {
  await requirePermission("search_coverage.view");
  const params = await searchParams;
  const filter: FilterOption = isFilterOption(params.filter) ? params.filter : "all";

  const products = await db.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      imageUrl: true,
      aliases: { select: { alias: true, kind: true } },
      _count: { select: { carModels: true } },
    },
    orderBy: { code: "asc" },
    take: PAGE_SIZE,
  });

  type Row = {
    id: string;
    code: string;
    name: string;
    missingOem: boolean;
    missingKeyword: boolean;
    missingImage: boolean;
    missingFitment: boolean;
    missingCount: number;
  };

  const allRows: Row[] = products.map((p) => {
    const hasOem = p.aliases.some((a) => OEM_KINDS.includes(a.kind));
    const hasKeyword = p.aliases.some((a) => KEYWORD_KINDS.includes(a.kind) && containsThai(a.alias));
    const hasImage = Boolean(p.imageUrl && p.imageUrl.trim() !== "");
    const hasFitment = p._count.carModels > 0;

    const missingOem = !hasOem;
    const missingKeyword = !hasKeyword;
    const missingImage = !hasImage;
    const missingFitment = !hasFitment;

    return {
      id: p.id,
      code: p.code,
      name: p.name,
      missingOem,
      missingKeyword,
      missingImage,
      missingFitment,
      missingCount: Number(missingOem) + Number(missingKeyword) + Number(missingImage) + Number(missingFitment),
    };
  });

  const totals = {
    total: allRows.length,
    missingOem: allRows.filter((r) => r.missingOem).length,
    missingKeyword: allRows.filter((r) => r.missingKeyword).length,
    missingImage: allRows.filter((r) => r.missingImage).length,
    missingFitment: allRows.filter((r) => r.missingFitment).length,
    fullyCovered: allRows.filter((r) => r.missingCount === 0).length,
  };

  const rows = (() => {
    switch (filter) {
      case "missing_oem": return allRows.filter((r) => r.missingOem);
      case "missing_keyword": return allRows.filter((r) => r.missingKeyword);
      case "missing_image": return allRows.filter((r) => r.missingImage);
      case "missing_fitment": return allRows.filter((r) => r.missingFitment);
      case "all":
      default: return allRows.filter((r) => r.missingCount > 0);
    }
  })().sort((a, b) => b.missingCount - a.missingCount || a.code.localeCompare(b.code));

  const coveragePct = totals.total === 0 ? 100 : Math.round((totals.fullyCovered / totals.total) * 100);

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="Search Coverage Audit"
        description="ตรวจสอบสินค้าที่ขาดข้อมูลซึ่งทำให้ค้นหายาก เช่น OEM, คำค้นภาษาไทย, รูป, รุ่นรถ"
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <AdminSectionCard title="ครอบคลุมเต็ม">
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{coveragePct}%</p>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            {totals.fullyCovered} / {totals.total} สินค้า
          </p>
        </AdminSectionCard>
        <AdminSectionCard title="ขาด OEM">
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{totals.missingOem}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400">รายการ</p>
        </AdminSectionCard>
        <AdminSectionCard title="ขาดคำค้น TH">
          <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{totals.missingKeyword}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400">รายการ</p>
        </AdminSectionCard>
        <AdminSectionCard title="ขาดรูป">
          <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{totals.missingImage}</p>
          <p className="text-xs text-gray-500 dark:text-slate-400">รายการ</p>
        </AdminSectionCard>
        <AdminSectionCard title="ขาดรุ่นรถ">
          <p className="text-2xl font-bold text-purple-600 dark:text-purple-400">{totals.missingFitment}</p>
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
              <option value="missing_oem">ขาด OEM</option>
              <option value="missing_keyword">ขาดคำค้นภาษาไทย</option>
              <option value="missing_image">ขาดรูป</option>
              <option value="missing_fitment">ขาดรุ่นรถ</option>
            </select>
          </label>
          <AdminSearchSubmitButton className="inline-flex justify-center rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055]">
            แสดงรายการ
          </AdminSearchSubmitButton>
        </AdminSearchForm>
      </AdminFilterToolbar>

      <AdminTableSection title={`รายการ (${rows.length})`}>
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
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-gray-50 transition-colors hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-700 dark:text-slate-200">{r.code}</td>
                    <td className="px-4 py-3 text-gray-800 dark:text-slate-100">{r.name}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {r.missingOem && <span className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300">OEM</span>}
                        {r.missingKeyword && <span className="inline-flex items-center rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">คำค้น TH</span>}
                        {r.missingImage && <span className="inline-flex items-center rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">รูป</span>}
                        {r.missingFitment && <span className="inline-flex items-center rounded-full border border-purple-100 bg-purple-50 px-2 py-0.5 text-xs text-purple-700 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-300">รุ่นรถ</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/products/${r.id}/edit`}
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

      <p className="text-xs text-gray-500 dark:text-slate-400">
        * แสดงสูงสุด {PAGE_SIZE} สินค้าที่ active เท่านั้น ถ้าเกินจำนวนนี้แนะนำให้แก้ไขสินค้าตามลำดับและรีเฟรชหน้านี้
      </p>
    </div>
  );
}
