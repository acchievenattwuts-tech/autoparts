import Link from "next/link";
import { ChevronRight, ShieldAlert, ShieldCheck } from "lucide-react";

import LiffBottomNav from "@/components/liff/LiffBottomNav";
import LiffStatusTabs from "@/components/liff/LiffStatusTabs";
import { db } from "@/lib/db";
import { requireLiffCustomer } from "@/lib/liff-data";
import { formatDateThai } from "@/lib/th-date";

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
  const today = new Date();
  const warranties = await db.warranty.findMany({
    where: { sale: { customerId: customer.id, status: "ACTIVE" } },
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
  });

  const activeCount = warranties.filter((item) => item.endDate >= today).length;
  const expiredCount = warranties.length - activeCount;
  const filteredWarranties = warranties.filter((warranty) => {
    const expired = warranty.endDate < today;
    if (statusFilter === "active") return !expired;
    if (statusFilter === "expired") return expired;
    return true;
  });

  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white pb-24">
      <section className="overflow-hidden rounded-b-[28px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-blue-100 px-5 pb-6 pt-6 text-[#083a78] shadow-sm">
        <p className="text-sm font-semibold text-blue-700">ประกันสินค้า</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold">รายการประกันของคุณ</h1>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-blue-100 bg-white/90 px-4 py-4 text-slate-950 shadow-sm">
            <p className="text-xs text-slate-500">ยังมีประกัน</p>
            <p className="font-kanit text-2xl font-bold">{activeCount}</p>
          </div>
          <div className="rounded-2xl border border-blue-100 bg-blue-800 px-4 py-4 text-white shadow-sm">
            <p className="text-xs text-blue-100">ทั้งหมด</p>
            <p className="font-kanit text-2xl font-bold">{warranties.length}</p>
            <p className="mt-1 text-xs text-blue-100">หมดประกัน {expiredCount}</p>
          </div>
        </div>
        <Link
          href="/liff/claims"
          className="mt-3 flex items-center justify-between rounded-2xl border border-blue-100 bg-white/90 px-4 py-3 text-sm font-bold text-blue-900 shadow-sm"
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

        {filteredWarranties.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-blue-200 bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm">
            ยังไม่มีประวัติประกันสินค้า
          </div>
        ) : (
          filteredWarranties.map((warranty) => {
            const expired = warranty.endDate < today;
            return (
              <Link
                key={warranty.id}
                href={`/liff/warranties/${warranty.id}`}
                className="block rounded-2xl border border-blue-100 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                      <ShieldCheck size={20} />
                    </div>
                    <div>
                      <p className="font-semibold text-slate-950">{warranty.product.name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {warranty.product.code} · {warranty.sale.saleNo}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-5 w-5 text-slate-400" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span className={expired ? "rounded-full bg-rose-100 px-2 py-1 font-semibold text-rose-700" : "rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-700"}>
                    {expired ? "หมดประกัน" : "ยังมีประกัน"}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-1 font-semibold text-slate-600">
                    ถึง {formatDateThai(warranty.endDate)}
                  </span>
                  {warranty._count.claims > 0 ? (
                    <span className="rounded-full bg-blue-100 px-2 py-1 font-semibold text-blue-700">
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
