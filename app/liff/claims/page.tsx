import Link from "next/link";
import { ChevronRight, ShieldAlert } from "lucide-react";

import LiffBottomNav from "@/components/liff/LiffBottomNav";
import { db } from "@/lib/db";
import { requireLiffCustomer } from "@/lib/liff-data";
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

function isClosedCustomerClaim(claim: {
  claimType: string;
  status: string;
}) {
  return (
    claim.claimType === "REPLACE_NOW" ||
    claim.status === "CLOSED" ||
    claim.status === "RETURNED_TO_CUSTOMER"
  );
}

export default async function LiffClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const customer = await requireLiffCustomer();
  const statusFilter = normalizeClaimStatusFilter((await searchParams).status);
  const claims = await db.warrantyClaim.findMany({
    where: {
      warranty: {
        sale: {
          customerId: customer.id,
          status: "ACTIVE",
        },
      },
    },
    select: {
      id: true,
      claimNo: true,
      claimDate: true,
      claimType: true,
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
  });
  const openCount = claims.filter((claim) => !isClosedCustomerClaim(claim) && claim.status !== "CANCELLED").length;
  const closedCount = claims.filter(isClosedCustomerClaim).length;
  const filteredClaims = claims.filter((claim) => {
    if (statusFilter === "open") return !isClosedCustomerClaim(claim) && claim.status !== "CANCELLED";
    if (statusFilter === "closed") return isClosedCustomerClaim(claim);
    return true;
  });

  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white pb-24">
      <section className="overflow-hidden rounded-b-[28px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-blue-100 px-5 pb-6 pt-6 text-[#083a78] shadow-sm">
        <p className="text-sm font-semibold text-blue-700">ประวัติการเคลม</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold">เคลมสินค้าของคุณ</h1>
        <div className="mt-5 rounded-2xl border border-blue-100 bg-white/90 px-4 py-4 shadow-sm">
          <p className="text-xs text-slate-500">รายการเคลมทั้งหมด</p>
          <p className="font-kanit text-2xl font-bold">{claims.length}</p>
          <p className="mt-1 text-xs text-slate-600">
            กำลังดำเนินการ {openCount} · จบแล้ว {closedCount}
          </p>
        </div>
      </section>

      <section className="space-y-4 px-5 py-5">
        <div className="grid grid-cols-3 gap-2 rounded-2xl border border-blue-100 bg-blue-50/70 p-1 text-xs font-bold">
          {claimStatusTabs.map((tab) => {
            const isActive = statusFilter === tab.key;
            return (
              <Link
                key={tab.key}
                href={tab.key === "all" ? "/liff/claims" : `/liff/claims?status=${tab.key}`}
                className={`rounded-md px-2 py-2 text-center transition ${
                  isActive ? "bg-white text-blue-800 shadow-sm" : "text-slate-500"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        {filteredClaims.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-blue-200 bg-white px-4 py-10 text-center text-sm text-slate-500 shadow-sm">
            ยังไม่มีประวัติการเคลมสินค้า
          </div>
        ) : (
          filteredClaims.map((claim) => (
            <Link
              key={claim.id}
              href={`/liff/claims/${claim.id}`}
              className="block rounded-2xl border border-blue-100 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
                    <ShieldAlert size={20} />
                  </div>
                  <div>
                    <p className="font-mono text-sm font-bold text-slate-950">{claim.claimNo}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{claim.warranty.product.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {formatDateThai(claim.claimDate)} · {CLAIM_TYPE_LABEL[claim.claimType]}
                    </p>
                  </div>
                </div>
                <ChevronRight className="mt-1 h-5 w-5 text-slate-400" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span
                  className={`rounded-full px-2 py-1 text-xs font-semibold ${getCustomerClaimStatusBadgeClass({
                    claimType: claim.claimType,
                    status: claim.status,
                  })}`}
                >
                  {getCustomerClaimStatusLabel({ claimType: claim.claimType, status: claim.status })}
                </span>
                {claim.symptom ? (
                  <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
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
