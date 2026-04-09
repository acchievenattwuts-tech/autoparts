export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { requirePermission } from "@/lib/require-auth";
import { getReportsData, parseReportFilters } from "@/lib/reports";
import CashBankSnapshot from "../CashBankSnapshot";
import ReportsContent from "../ReportsContent";

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function SectionUnavailable({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
      <h2 className="font-kanit text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-amber-900">{body}</p>
    </section>
  );
}

async function getSummaryReportsData(from?: string, to?: string) {
  try {
    const filters = parseReportFilters({ from, to });
    return await getReportsData(filters);
  } catch {
    return null;
  }
}

async function SummaryReportsSection({ from, to }: { from?: string; to?: string }) {
  const data = await getSummaryReportsData(from, to);

  if (!data) {
    return (
      <SectionUnavailable
        title="โหลดสรุปรายงานไม่สำเร็จชั่วคราว"
        body="ฐานข้อมูลตอบช้าหรือเชื่อมต่อไม่ทันเวลา ลองรีเฟรชหน้าอีกครั้ง หรือลดช่วงวันที่ของรายงานแล้วลองใหม่"
      />
    );
  }

  return <ReportsContent data={data} />;
}

async function SummaryCashBankSection() {
  return <CashBankSnapshot />;
}

function SectionSkeleton({ heightClass }: { heightClass: string }) {
  return <div className={`animate-pulse rounded-2xl bg-gray-100 ${heightClass}`} />;
}

export default async function SummaryReportPage({ searchParams }: PageProps) {
  await requirePermission("reports.view");
  const params = await searchParams;

  const filters = parseReportFilters({
    from: params.from,
    to: params.to,
  });

  return (
    <div className="space-y-4">
      <form method="GET" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ตั้งแต่วันที่
          <input
            type="date"
            name="from"
            defaultValue={filters.fromInput}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ถึงวันที่
          <input
            type="date"
            name="to"
            defaultValue={filters.toInput}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <button
          type="submit"
          className="h-9 self-end rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]"
        >
          แสดงรายงาน
        </button>
        <Link
          href="/admin/reports/summary"
          className="inline-flex h-9 items-center self-end rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200"
        >
          ล้าง
        </Link>
      </form>

      <Suspense fallback={<SectionSkeleton heightClass="min-h-[280px]" />}>
        <SummaryCashBankSection />
      </Suspense>

      <Suspense fallback={<SectionSkeleton heightClass="min-h-[720px]" />}>
        <SummaryReportsSection from={params.from} to={params.to} />
      </Suspense>
    </div>
  );
}
