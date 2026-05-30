import Link from "next/link";
import { ChevronRight, ShieldAlert } from "lucide-react";

import LiffBottomNav from "@/components/liff/LiffBottomNav";
import LiffLinkRequired from "@/components/liff/LiffLinkRequired";
import LiffStatusTabs from "@/components/liff/LiffStatusTabs";
import { db } from "@/lib/db";
import { type Prisma } from "@/lib/generated/prisma";
import { getLiffCustomer } from "@/lib/liff-data";
import { formatDateThai } from "@/lib/th-date";
import {
  CLAIM_TYPE_LABEL,
  getCustomerClaimStatusBadgeClass,
  getCustomerClaimStatusLabel,
} from "@/lib/warranty-claim-i18n";

const claimStatusTabs = [
  { key: "all", label: "ทั้งหมด" },
  { key: "open", label: "กำลังดำเนินการ" },
  { key: "closed", label: "จบแล้ว" },
] as const;

type ClaimStatusFilter = (typeof claimStatusTabs)[number]["key"];

function normalizeClaimStatusFilter(value: string | undefined): ClaimStatusFilter {
  return claimStatusTabs.some((tab) => tab.key === value) ? (value as ClaimStatusFilter) : "all";
}

export default async function LiffClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const customer = await getLiffCustomer();
  if (!customer) {
    return (
      <LiffLinkRequired
        title="ผูกเบอร์เพื่อดูประวัติการเคลม"
        description="กรุณาผูกบัญชี LINE กับเบอร์โทรที่ลงทะเบียนไว้กับร้าน เพื่อดูสถานะและประวัติการเคลมสินค้า"
      />
    );
  }
  const statusFilter = normalizeClaimStatusFilter((await searchParams).status);
  const baseClaimWhere: Prisma.WarrantyClaimWhereInput = {
    status: { not: "CANCELLED" },
    warranty: {
      OR: [
        { sale: { customerId: customer.id, status: "ACTIVE" } },
        { customerId: customer.id, saleId: null },
      ],
    },
  };
  const closedClaimWhere: Prisma.WarrantyClaimWhereInput = {
    ...baseClaimWhere,
    OR: [
      { claimType: "REPLACE_NOW" },
      { status: { in: ["CLOSED", "RETURNED_TO_CUSTOMER"] } },
    ],
  };
  const openClaimWhere: Prisma.WarrantyClaimWhereInput = {
    ...baseClaimWhere,
    NOT: [
      { claimType: "REPLACE_NOW" },
      { status: { in: ["CLOSED", "RETURNED_TO_CUSTOMER"] } },
    ],
  };
  const listWhere =
    statusFilter === "closed" ? closedClaimWhere : statusFilter === "open" ? openClaimWhere : baseClaimWhere;

  const [claims, totalCount, openCount, closedCount] = await Promise.all([
    db.warrantyClaim.findMany({
      where: listWhere,
      select: {
        id: true,
        claimNo: true,
        claimDate: true,
        claimType: true,
        outcome: true,
        status: true,
        symptom: true,
        warranty: {
          select: {
            id: true,
            product: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { claimDate: "desc" },
      take: 50,
    }),
    db.warrantyClaim.count({ where: baseClaimWhere }),
    db.warrantyClaim.count({ where: openClaimWhere }),
    db.warrantyClaim.count({ where: closedClaimWhere }),
  ]);

  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white pb-24 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <section className="overflow-hidden rounded-b-[32px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-emerald-50 px-5 pb-6 pt-6 text-[#083a78] shadow-sm dark:border-slate-700 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800 dark:text-sky-200">
        <p className="text-sm font-semibold text-blue-700 dark:text-sky-400">ประวัติการเคลม</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold dark:text-slate-100">เคลมสินค้าของคุณ</h1>
        <div className="mt-5 rounded-[24px] border border-blue-100 bg-white/90 px-4 py-4 shadow-sm dark:border-slate-700 dark:bg-slate-800/90">
          <p className="text-xs text-slate-500 dark:text-slate-400">รายการเคลมทั้งหมด</p>
          <p className="font-kanit text-2xl font-bold dark:text-slate-100">{totalCount}</p>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            กำลังดำเนินการ {openCount} · จบแล้ว {closedCount}
          </p>
        </div>
      </section>

      <section className="space-y-4 px-5 py-5">
        <LiffStatusTabs
          activeKey={statusFilter}
          tabs={claimStatusTabs.map((tab) => ({
            ...tab,
            href: tab.key === "all" ? "/liff/claims" : `/liff/claims?status=${tab.key}`,
          }))}
        />

        {claims.length === 0 ? (
          <div className="rounded-[24px] border border-dashed border-blue-200 bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
            ยังไม่มีประวัติการเคลมสินค้า
          </div>
        ) : (
          claims.map((claim) => (
            <Link
              key={claim.id}
              href={`/liff/claims/${claim.id}`}
              className="block rounded-[24px] border border-blue-100 bg-white p-4 shadow-sm shadow-blue-950/5 transition active:scale-[0.99] dark:border-slate-700 dark:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-slate-800 dark:text-sky-400">
                    <ShieldAlert size={20} />
                  </div>
                  <div>
                    <p className="font-mono text-sm font-bold text-slate-950 dark:text-slate-100">{claim.claimNo}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-200">{claim.warranty.product.name}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {formatDateThai(claim.claimDate)} · {CLAIM_TYPE_LABEL[claim.claimType]}
                    </p>
                  </div>
                </div>
                <ChevronRight className="mt-1 h-5 w-5 text-slate-400 dark:text-slate-500" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span
                  className={`rounded-full px-2 py-1 text-xs font-semibold ${getCustomerClaimStatusBadgeClass({
                    claimType: claim.claimType,
                    outcome: claim.outcome,
                    status: claim.status,
                  })}`}
                >
                  {getCustomerClaimStatusLabel({
                    claimType: claim.claimType,
                    outcome: claim.outcome,
                    status: claim.status,
                  })}
                </span>
                {claim.symptom ? (
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {claim.symptom}
                  </span>
                ) : null}
              </div>
            </Link>
          ))
        )}
      </section>
      <LiffBottomNav active="/liff/claims" />
    </main>
  );
}
