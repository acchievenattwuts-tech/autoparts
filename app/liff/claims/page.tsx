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

export default async function LiffClaimsPage() {
  const customer = await requireLiffCustomer();
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

  return (
    <main className="min-h-dvh pb-24">
      <section className="bg-slate-950 px-5 pb-6 pt-6 text-white">
        <p className="text-sm text-teal-100">ประวัติการเคลม</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold">เคลมสินค้าของคุณ</h1>
        <div className="mt-5 rounded-lg bg-white/10 px-4 py-4">
          <p className="text-xs text-teal-100">รายการเคลมทั้งหมด</p>
          <p className="font-kanit text-2xl font-bold">{claims.length}</p>
        </div>
      </section>

      <section className="space-y-3 px-5 py-5">
        {claims.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
            ยังไม่มีประวัติการเคลมสินค้า
          </div>
        ) : (
          claims.map((claim) => (
            <Link
              key={claim.id}
              href={`/liff/claims/${claim.id}`}
              className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
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
      <LiffBottomNav active="/liff/warranties" />
    </main>
  );
}
