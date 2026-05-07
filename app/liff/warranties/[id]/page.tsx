import Link from "next/link";
import { ChevronLeft, ShieldCheck } from "lucide-react";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { requireLiffCustomer } from "@/lib/liff-data";
import { formatDateThai } from "@/lib/th-date";
import {
  getCustomerClaimStatusBadgeClass,
  getCustomerClaimStatusLabel,
} from "@/lib/warranty-claim-i18n";

export default async function LiffWarrantyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, customer] = await Promise.all([params, requireLiffCustomer()]);
  const warranty = await db.warranty.findFirst({
    where: { id, sale: { customerId: customer.id, status: "ACTIVE" } },
    select: {
      id: true,
      warrantyDays: true,
      unitSeq: true,
      lotNo: true,
      startDate: true,
      endDate: true,
      note: true,
      product: { select: { code: true, name: true } },
      sale: { select: { id: true, saleNo: true, saleDate: true } },
      claims: {
        where: { status: { not: "CANCELLED" } },
        select: {
          id: true,
          claimNo: true,
          claimDate: true,
          claimType: true,
          outcome: true,
          status: true,
          symptom: true,
        },
        orderBy: { claimDate: "desc" },
        take: 10,
      },
    },
  });

  if (!warranty) notFound();

  const expired = warranty.endDate < new Date();

  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-sky-50 to-white pb-10">
      <section className="overflow-hidden rounded-b-[28px] border-b border-blue-100 bg-gradient-to-br from-white via-sky-50 to-blue-100 px-5 pb-6 pt-6 text-[#083a78] shadow-sm">
        <Link href="/liff/warranties" className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-blue-700">
          <ChevronLeft size={16} />
          กลับไปประกัน
        </Link>
        <p className="text-sm text-slate-500">{warranty.product.code}</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold">{warranty.product.name}</h1>
      </section>

      <section className="space-y-4 px-5 py-5">
        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <div className="mb-4 flex gap-3">
            <ShieldCheck className="h-6 w-6 text-blue-700" />
            <div>
              <p className="font-kanit text-lg font-bold text-slate-950">รายละเอียดประกัน</p>
              <p className={expired ? "mt-1 text-sm font-semibold text-rose-700" : "mt-1 text-sm font-semibold text-emerald-700"}>
                {expired ? "หมดประกันแล้ว" : "ยังอยู่ในประกัน"}
              </p>
            </div>
          </div>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-slate-500">เลขที่บิล</dt>
              <dd className="font-mono font-semibold text-slate-950">{warranty.sale.saleNo}</dd>
            </div>
            <div>
              <dt className="text-slate-500">เริ่มประกัน</dt>
              <dd className="font-semibold text-slate-950">{formatDateThai(warranty.startDate)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">หมดประกัน</dt>
              <dd className="font-semibold text-slate-950">{formatDateThai(warranty.endDate)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">ระยะประกัน</dt>
              <dd className="font-semibold text-slate-950">{warranty.warrantyDays.toLocaleString("th-TH")} วัน</dd>
            </div>
            <div>
              <dt className="text-slate-500">Lot / ชิ้นที่</dt>
              <dd className="font-semibold text-slate-950">
                {warranty.lotNo ?? "-"} / #{warranty.unitSeq}
              </dd>
            </div>
          </dl>
        </div>

        <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
          <h2 className="font-kanit text-lg font-bold text-slate-950">ประวัติการเคลม</h2>
          {warranty.claims.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">ยังไม่มีประวัติการเคลมสินค้านี้</p>
          ) : (
            <div className="mt-3 space-y-2">
              {warranty.claims.map((claim) => (
                <Link key={claim.id} href={`/liff/claims/${claim.id}`} className="block rounded-xl bg-blue-50/60 px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-bold text-slate-950">{claim.claimNo}</p>
                      <p className="mt-1 text-xs text-slate-500">{formatDateThai(claim.claimDate)}</p>
                    </div>
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
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
