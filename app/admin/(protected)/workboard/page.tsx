export const dynamic = "force-dynamic";

import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  PackageSearch,
  ShieldAlert,
  Truck,
  Wallet,
} from "lucide-react";

import { requirePermission } from "@/lib/require-auth";
import { SHIPPING_METHOD_LABEL, SHIPPING_STATUS_LABEL } from "@/lib/shipping";
import { formatDateThai, formatDateTimeThai } from "@/lib/th-date";

import { getWorkboardData } from "./workboard-data";

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatQuantity(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

type Tone = "red" | "amber" | "blue" | "emerald";

const toneClasses: Record<Tone, { badge: string; icon: string; link: string }> = {
  red: {
    badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200",
    icon: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200",
    link: "text-red-700 hover:text-red-800 dark:text-red-200 dark:hover:text-red-100",
  },
  amber: {
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
    icon: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
    link: "text-amber-700 hover:text-amber-800 dark:text-amber-200 dark:hover:text-amber-100",
  },
  blue: {
    badge: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
    icon: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
    link: "text-sky-700 hover:text-sky-800 dark:text-sky-200 dark:hover:text-sky-100",
  },
  emerald: {
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
    icon: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
    link: "text-emerald-700 hover:text-emerald-800 dark:text-emerald-200 dark:hover:text-emerald-100",
  },
};

type SectionCardProps = {
  icon: LucideIcon;
  title: string;
  href: string;
  count: number;
  tone: Tone;
  summary?: string;
  children: ReactNode;
};

const SectionCard = ({
  icon: Icon,
  title,
  href,
  count,
  tone,
  summary,
  children,
}: SectionCardProps) => (
  <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950/40">
    <div className="border-b border-gray-100 px-5 py-4 dark:border-white/10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${toneClasses[tone].icon}`}>
            <Icon size={20} />
          </div>
          <div>
            <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
            {summary ? (
              <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">{summary}</p>
            ) : null}
          </div>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold ${toneClasses[tone].badge}`}>
          {count.toLocaleString("th-TH")}
        </span>
      </div>
    </div>
    <div className="space-y-3 px-5 py-4">{children}</div>
    <div className="border-t border-gray-100 px-5 py-3 dark:border-white/10">
      <Link
        href={href}
        className={`inline-flex items-center gap-1.5 text-sm font-medium transition-colors ${toneClasses[tone].link}`}
      >
        ดูทั้งหมด
        <ArrowRight size={15} />
      </Link>
    </div>
  </section>
);

const EmptyState = () => (
  <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-400">
    ไม่มีงานค้างในหมวดนี้
  </div>
);

const WorkboardPage = async () => {
  await requirePermission("workboard.view");
  const data = await getWorkboardData();

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-4 border-b border-gray-200 bg-white/95 px-4 py-4 backdrop-blur dark:border-white/10 dark:bg-slate-950/85">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#1e3a5f]/10 text-[#1e3a5f] dark:bg-sky-500/10 dark:text-sky-200">
              <ClipboardList size={22} />
            </div>
            <div>
              <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
                Today Workboard
              </h1>
              <p className="text-sm text-gray-500 dark:text-slate-400">
                งานที่ต้องตามวันนี้ในหน้าเดียว ลดการสลับเมนูและเห็นงานค้างตามลำดับความเร่งด่วน
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-slate-300">
              ข้อมูลวันที่ {formatDateThai(data.todayStart)}
            </span>
            <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-slate-300">
              อัปเดตล่าสุด {formatDateTimeThai(data.generatedAt, { hour: "2-digit", minute: "2-digit" })}
            </span>
            <Link
              href="/admin/workboard"
              className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163052] dark:bg-sky-500 dark:text-slate-950 dark:hover:bg-sky-400"
            >
              รีเฟรช
              <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard
          icon={Truck}
          title="ใบขายรอจัดส่งวันนี้"
          href="/admin/delivery"
          count={data.pendingDeliveries.count}
          tone="amber"
          summary="ใบส่งของที่ยังไม่ปิดการจัดส่งและถึงคิวต้องตามแล้ว"
        >
          {data.pendingDeliveries.items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-3">
              {data.pendingDeliveries.items.map((item) => (
                <Link
                  key={item.id}
                  href={`/admin/sales/${item.id}`}
                  className="block rounded-2xl border border-gray-100 px-4 py-3 transition-colors hover:border-amber-200 hover:bg-amber-50/60 dark:border-white/10 dark:hover:border-amber-400/20 dark:hover:bg-amber-500/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[#1e3a5f] dark:text-sky-200">{item.saleNo}</p>
                      <p className="mt-1 text-sm font-medium text-gray-900 dark:text-slate-100">{item.customerName}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                        {formatDateThai(item.saleDate)} • {item.itemCount.toLocaleString("th-TH")} รายการ • {SHIPPING_METHOD_LABEL[item.shippingMethod] ?? "-"}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-gray-900 dark:text-slate-100">
                      ฿{formatCurrency(item.netAmount)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={CircleDollarSign}
          title="COD รอรับเงิน"
          href="/admin/sales?paymentType=CREDIT_SALE&fulfillment=DELIVERY"
          count={data.codWaiting.count}
          tone="red"
          summary={`ค้างรับรวม ฿${formatCurrency(data.codWaiting.totalAmountRemain)}`}
        >
          {data.codWaiting.items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-3">
              {data.codWaiting.items.map((item) => (
                <Link
                  key={item.id}
                  href={`/admin/sales/${item.id}`}
                  className="block rounded-2xl border border-gray-100 px-4 py-3 transition-colors hover:border-red-200 hover:bg-red-50/60 dark:border-white/10 dark:hover:border-red-400/20 dark:hover:bg-red-500/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[#1e3a5f] dark:text-sky-200">{item.saleNo}</p>
                      <p className="mt-1 text-sm font-medium text-gray-900 dark:text-slate-100">{item.customerName}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                        {formatDateThai(item.saleDate)} • {SHIPPING_STATUS_LABEL[item.shippingStatus] ?? item.shippingStatus}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-red-700 dark:text-red-200">฿{formatCurrency(item.amountRemain)}</p>
                      <p className="text-xs text-gray-500 dark:text-slate-400">ยอดขาย ฿{formatCurrency(item.netAmount)}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={AlertTriangle}
          title="ลูกหนี้เกินเครดิต"
          href="/admin/reports/ar"
          count={data.overdueAr.count}
          tone="red"
          summary={`ค้างรับรวม ฿${formatCurrency(data.overdueAr.totalAmountRemain)}`}
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl bg-red-50 px-3 py-2 text-sm dark:bg-red-500/10">
              <p className="text-xs text-red-600 dark:text-red-200">1-7 วัน</p>
              <p className="font-semibold text-red-700 dark:text-red-100">{data.overdueAr.buckets.oneToSeven.toLocaleString("th-TH")}</p>
            </div>
            <div className="rounded-2xl bg-amber-50 px-3 py-2 text-sm dark:bg-amber-500/10">
              <p className="text-xs text-amber-700 dark:text-amber-200">8-30 วัน</p>
              <p className="font-semibold text-amber-800 dark:text-amber-100">{data.overdueAr.buckets.eightToThirty.toLocaleString("th-TH")}</p>
            </div>
            <div className="rounded-2xl bg-gray-100 px-3 py-2 text-sm dark:bg-white/10">
              <p className="text-xs text-gray-600 dark:text-slate-400">30+ วัน</p>
              <p className="font-semibold text-gray-900 dark:text-slate-100">{data.overdueAr.buckets.overThirty.toLocaleString("th-TH")}</p>
            </div>
          </div>
          {data.overdueAr.items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-3">
              {data.overdueAr.items.map((item) => (
                <Link
                  key={item.id}
                  href={`/admin/sales/${item.id}`}
                  className="block rounded-2xl border border-gray-100 px-4 py-3 transition-colors hover:border-red-200 hover:bg-red-50/60 dark:border-white/10 dark:hover:border-red-400/20 dark:hover:bg-red-500/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[#1e3a5f] dark:text-sky-200">{item.saleNo}</p>
                      <p className="mt-1 text-sm font-medium text-gray-900 dark:text-slate-100">{item.customerName}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                        ครบกำหนด {formatDateThai(item.dueDate)} • เกิน {item.daysOverdue.toLocaleString("th-TH")} วัน • {item.fulfillmentType === "DELIVERY" ? "COD/จัดส่ง" : "เครดิตทั่วไป"}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-red-700 dark:text-red-200">
                      ฿{formatCurrency(item.amountRemain)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={Clock3}
          title="Supplier ครบกำหนดจ่าย"
          href="/admin/reports/ap"
          count={data.dueAp.count}
          tone="amber"
          summary={`ยอดค้างจ่ายรวม ฿${formatCurrency(data.dueAp.totalAmountRemain)}`}
        >
          {data.dueAp.items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-3">
              {data.dueAp.items.map((item) => (
                <Link
                  key={item.id}
                  href={`/admin/purchases/${item.id}`}
                  className="block rounded-2xl border border-gray-100 px-4 py-3 transition-colors hover:border-amber-200 hover:bg-amber-50/60 dark:border-white/10 dark:hover:border-amber-400/20 dark:hover:bg-amber-500/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[#1e3a5f] dark:text-sky-200">{item.purchaseNo}</p>
                      <p className="mt-1 text-sm font-medium text-gray-900 dark:text-slate-100">{item.supplierName}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                        ครบกำหนด {formatDateThai(item.dueDate)} • เกิน {item.daysOverdue.toLocaleString("th-TH")} วัน
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-amber-700 dark:text-amber-200">
                      ฿{formatCurrency(item.amountRemain)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={ShieldAlert}
          title="เคลมรอ Supplier ตอบ"
          href="/admin/warranty-claims?status=SENT_TO_SUPPLIER"
          count={data.supplierClaims.count}
          tone="blue"
          summary="ใบเคลมที่ส่ง Supplier แล้วและยังไม่ปิดเคส"
        >
          {data.supplierClaims.items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-3">
              {data.supplierClaims.items.map((item) => (
                <Link
                  key={item.id}
                  href={`/admin/warranty-claims/${item.id}`}
                  className="block rounded-2xl border border-gray-100 px-4 py-3 transition-colors hover:border-sky-200 hover:bg-sky-50/60 dark:border-white/10 dark:hover:border-sky-400/20 dark:hover:bg-sky-500/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[#1e3a5f] dark:text-sky-200">{item.claimNo}</p>
                      <p className="mt-1 text-sm font-medium text-gray-900 dark:text-slate-100">{item.productName}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                        {item.customerName} • {item.supplierName} • {formatDateThai(item.claimDate)}
                      </p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={Boxes}
          title="สินค้าใกล้หรือต่ำกว่าขั้นต่ำ"
          href="/admin/reports/stock"
          count={data.lowStock.count}
          tone="red"
          summary="คำนวณจากสินค้า active ที่ stock ต่ำกว่าหรือเท่ากับ min stock"
        >
          {data.lowStock.items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-3">
              {data.lowStock.items.map((item) => (
                <Link
                  key={item.id}
                  href={`/admin/products/${item.id}`}
                  className="block rounded-2xl border border-gray-100 px-4 py-3 transition-colors hover:border-red-200 hover:bg-red-50/60 dark:border-white/10 dark:hover:border-red-400/20 dark:hover:bg-red-500/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[#1e3a5f] dark:text-sky-200">{item.code}</p>
                      <p className="mt-1 text-sm font-medium text-gray-900 dark:text-slate-100">{item.name}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                        ขั้นต่ำ {formatQuantity(item.minStock)} {item.unitName}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-red-700 dark:text-red-200">
                      {formatQuantity(item.stock)} {item.unitName}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={PackageSearch}
          title="Lot ใกล้หมดอายุ"
          href="/admin/lots/expiry"
          count={data.expiringLots.count}
          tone="amber"
          summary="นับเฉพาะ lot ที่ยังมีของคงเหลือและหมดอายุภายใน 90 วัน"
        >
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-2xl bg-red-50 px-3 py-2 text-sm dark:bg-red-500/10">
              <p className="text-xs text-red-600 dark:text-red-200">ภายใน 30 วัน</p>
              <p className="font-semibold text-red-700 dark:text-red-100">{data.expiringLots.buckets.withinThirtyDays.toLocaleString("th-TH")}</p>
            </div>
            <div className="rounded-2xl bg-amber-50 px-3 py-2 text-sm dark:bg-amber-500/10">
              <p className="text-xs text-amber-700 dark:text-amber-200">31-60 วัน</p>
              <p className="font-semibold text-amber-800 dark:text-amber-100">{data.expiringLots.buckets.withinSixtyDays.toLocaleString("th-TH")}</p>
            </div>
            <div className="rounded-2xl bg-gray-100 px-3 py-2 text-sm dark:bg-white/10">
              <p className="text-xs text-gray-600 dark:text-slate-400">61-90 วัน</p>
              <p className="font-semibold text-gray-900 dark:text-slate-100">{data.expiringLots.buckets.withinNinetyDays.toLocaleString("th-TH")}</p>
            </div>
          </div>
          {data.expiringLots.items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-3">
              {data.expiringLots.items.map((item) => (
                <div
                  key={`${item.productId}:${item.lotNo}`}
                  className="rounded-2xl border border-gray-100 px-4 py-3 dark:border-white/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[#1e3a5f] dark:text-sky-200">
                        {item.productCode} • Lot {item.lotNo}
                      </p>
                      <p className="mt-1 text-sm font-medium text-gray-900 dark:text-slate-100">{item.productName}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                        หมดอายุ {formatDateThai(item.expDate)} • อีก {item.daysLeft.toLocaleString("th-TH")} วัน
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-amber-700 dark:text-amber-200">
                      {formatQuantity(item.qtyOnHand)} {item.unitName}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard
          icon={Wallet}
          title="เงินสด/ธนาคาร ต่ำกว่าเกณฑ์เตือน"
          href="/admin/cash-bank"
          count={data.cashBankBelow.count}
          tone="red"
          summary="บัญชีที่ active และมีการตั้งยอดขั้นต่ำเตือน โดย balance ปัจจุบันต่ำกว่าเกณฑ์"
        >
          {data.cashBankBelow.items.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="space-y-3">
              {data.cashBankBelow.items.map((item) => (
                <Link
                  key={item.id}
                  href="/admin/cash-bank"
                  className="block rounded-2xl border border-gray-100 px-4 py-3 transition-colors hover:border-red-200 hover:bg-red-50/60 dark:border-white/10 dark:hover:border-red-400/20 dark:hover:bg-red-500/5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[#1e3a5f] dark:text-sky-200">{item.code}</p>
                      <p className="mt-1 text-sm font-medium text-gray-900 dark:text-slate-100">{item.name}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                        ประเภท {item.type === "CASH" ? "เงินสด" : "ธนาคาร"} • เกณฑ์เตือน ฿{formatCurrency(item.threshold)}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-red-700 dark:text-red-200">
                      ฿{formatCurrency(item.currentBalance)}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="flex justify-end">
        <Link
          href="/admin/dashboard"
          className="inline-flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-white/10 dark:text-slate-200 dark:hover:bg-white/15"
        >
          ไป Dashboard เดิม
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
};

export default WorkboardPage;
