import Link from "next/link";
import { ChevronRight, ShieldCheck } from "lucide-react";

import LiffBottomNav from "@/components/liff/LiffBottomNav";
import { db } from "@/lib/db";
import { requireLiffCustomer } from "@/lib/liff-data";
import { formatDateThai } from "@/lib/th-date";

export default async function LiffWarrantiesPage() {
  const customer = await requireLiffCustomer();
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

  return (
    <main className="min-h-dvh pb-24">
      <section className="bg-slate-950 px-5 pb-6 pt-6 text-white">
        <p className="text-sm text-teal-100">ประกันสินค้า</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold">รายการประกันของคุณ</h1>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-white px-4 py-4 text-slate-950">
            <p className="text-xs text-slate-500">ยังมีประกัน</p>
            <p className="font-kanit text-2xl font-bold">{activeCount}</p>
          </div>
          <div className="rounded-lg bg-white/10 px-4 py-4">
            <p className="text-xs text-teal-100">ทั้งหมด</p>
            <p className="font-kanit text-2xl font-bold">{warranties.length}</p>
          </div>
        </div>
      </section>

      <section className="space-y-3 px-5 py-5">
        {warranties.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
            ยังไม่มีประวัติประกันสินค้า
          </div>
        ) : (
          warranties.map((warranty) => {
            const expired = warranty.endDate < today;
            return (
              <Link
                key={warranty.id}
                href={`/liff/warranties/${warranty.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
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
