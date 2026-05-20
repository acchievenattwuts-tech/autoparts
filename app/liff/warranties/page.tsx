import Link from "next/link";
import { ChevronRight, ShieldAlert, ShieldCheck } from "lucide-react";

import LiffBottomNav from "@/components/liff/LiffBottomNav";
import LiffStatusTabs from "@/components/liff/LiffStatusTabs";
import { db } from "@/lib/db";
import { type Prisma } from "@/lib/generated/prisma";
import { requireLiffCustomer } from "@/lib/liff-data";
import { formatDateThai, getThailandDateKey, parseDateOnlyToStartOfDay } from "@/lib/th-date";

const warrantyStatusTabs = [
  { key: "active", label: "ยังมีประกัน" },
  { key: "expired", label: "หมดประกัน" },
  { key: "all", label: "ทั้งหมด" },
] as const;

type WarrantyStatusFilter = (typeof warrantyStatusTabs)[number]["key"];

function normalizeWarrantyStatusFilter(value: string | undefined): WarrantyStatusFilter {
  return warrantyStatusTabs.some((tab) => tab.key === value) ? (value as WarrantyStatusFilter) : "active";
}

export default async function LiffWarrantiesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const customer = await requireLiffCustomer();
  const statusFilter = normalizeWarrantyStatusFilter((await searchParams).status);
  const today = parseDateOnlyToStartOfDay(getThailandDateKey());
  const baseWarrantyWhere: Prisma.WarrantyWhereInput = {
    sale: { customerId: customer.id, status: "ACTIVE" },
  };
  const activeWarrantyWhere: Prisma.WarrantyWhereInput = {
    ...baseWarrantyWhere,
    endDate: { gte: today },
  };
  const expiredWarrantyWhere: Prisma.WarrantyWhereInput = {
    ...baseWarrantyWhere,
    endDate: { lt: today },
  };
  const listWhere =
    statusFilter === "all" ? baseWarrantyWhere : statusFilter === "expired" ? expiredWarrantyWhere : activeWarrantyWhere;

  const [warranties, totalCount, activeCount, expiredCount] = await Promise.all([
    db.warranty.findMany({
      where: listWhere,
      select: {
        id: true,
        warrantyDays: true,
        unitSeq: true,
        lotNo: true,
        startDate: true,
        endDate: true,
        product: { select: { code: true, name: true } },
        sale: { select: { saleNo: true, saleDate: true } },
        _count: { select: { claims: { where: { status: { not: "CANCELLED" } } } } },
      },
      orderBy: [{ endDate: "desc" }, { unitSeq: "asc" }],
      take: 80,
    }),
    db.warranty.count({ where: baseWarrantyWhere }),
    db.warranty.count({ where: activeWarrantyWhere }),
    db.warranty.count({ where: expiredWarrantyWhere }),
  ]);

  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white pb-24 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <section className="overflow-hidden rounded-b-[32px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-emerald-50 px-5 pb-6 pt-6 text-[#083a78] shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 dark:text-sky-200">
        <p className="text-sm font-semibold text-blue-700 dark:text-sky-400">ประกันสินค้า</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold dark:text-slate-100">รายการประกันของคุณ</h1>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-[24px] border border-blue-100 bg-white/90 px-4 py-4 text-slate-950 shadow-sm dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-100">
            <p className="text-xs text-slate-500 dark:text-slate-400">ยังมีประกัน</p>
            <p className="font-kanit text-2xl font-bold">{activeCount}</p>
          </div>
          <div className="rounded-[24px] border border-blue-100 bg-blue-800 px-4 py-4 text-white shadow-sm dark:border-sky-900 dark:bg-sky-900">
            <p className="text-xs text-blue-100">ทั้งหมด</p>
            <p className="font-kanit text-2xl font-bold">{totalCount}</p>
            <p className="mt-1 text-xs text-blue-100">หมดประกัน {expiredCount}</p>
          </div>
        </div>
        <Link
          href="/liff/claims"
          className="mt-3 flex items-center justify-between rounded-[24px] border border-blue-100 bg-white/90 px-4 py-3 text-sm font-bold text-blue-900 shadow-sm transition active:scale-[0.99] dark:border-slate-700 dark:bg-slate-800/90 dark:text-sky-300"
        >
          <span className="inline-flex items-center gap-2">
            <ShieldAlert size={18} />
            ดูประวัติเคลมทั้งหมด
          </span>
          <ChevronRight size={18} />
        </Link>
      </section>

      <section className="space-y-4 px-5 py-5">
        <LiffStatusTabs
          activeKey={statusFilter}
          tabs={warrantyStatusTabs.map((tab) => ({
            ...tab,
            href: tab.key === "active" ? "/liff/warranties" : `/liff/warranties?status=${tab.key}`,
          }))}
        />

        {warranties.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-blue-200 bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            ยังไม่มีประวัติประกันสินค้า
          </div>
        ) : (
          warranties.map((warranty) => {
            const expired = warranty.endDate < today;
            return (
              <Link
                key={warranty.id}
                href={`/liff/warranties/${warranty.id}`}
                className="block rounded-[24px] border border-blue-100 bg-white p-4 shadow-sm shadow-blue-950/5 transition active:scale-[0.99] dark:border-slate-700 dark:bg-slate-900"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-slate-800 dark:text-sky-400">
                      <ShieldCheck size={20} />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-950 dark:text-slate-100">{warranty.product.name}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {warranty.product.code} · {warranty.sale.saleNo}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-5 w-5 text-slate-400 dark:text-slate-500" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span className={expired ? "rounded-full bg-rose-100 px-2 py-1 font-semibold text-rose-700 dark:bg-rose-950 dark:text-rose-400" : "rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"}>
                    {expired ? "หมดประกัน" : "ยังมีประกัน"}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    ถึง {formatDateThai(warranty.endDate)}
                  </span>
                  {warranty._count.claims > 0 ? (
                    <span className="rounded-full bg-blue-100 px-2 py-1 font-semibold text-blue-700 dark:bg-slate-800 dark:text-sky-400">
                      เคลม {warranty._count.claims}
                    </span>
                  ) : null}
                </div>
              </Link>
            );
          })
        )}
      </section>
      <LiffBottomNav active="/liff/warranties" />
    </main>
  );
}
