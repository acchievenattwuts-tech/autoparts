export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, ReceiptText } from "lucide-react";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import ReportTableShell from "@/components/shared/ReportTableShell";
import { db } from "@/lib/db";
import { saleChannelLabel } from "@/lib/report-queries";
import { requirePermission } from "@/lib/require-auth";
import {
  buildSalesLineProfitQuery,
  parseSalesLineProfitFilters,
  querySalesLineProfitData,
  type SalesBillProfitRow,
  type SalesLineProfitRow,
} from "@/lib/sales-line-profit-report";
import { formatDateThai } from "@/lib/th-date";
import SalesLineProfitFilters from "./SalesLineProfitFilters";

const money = (value: number) =>
  value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = (value: number) =>
  value.toLocaleString("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 4 });
const percent = (value: number) => `${value.toFixed(2)}%`;
const optionalMoney = (value: number | null) => (value === null ? "—" : money(value));
const valueTone = (value: number) =>
  value < -0.004
    ? "text-rose-600 dark:text-rose-300"
    : value > 0.004
      ? "text-emerald-700 dark:text-emerald-300"
      : "text-slate-700 dark:text-slate-200";

function DocumentTypeBadge({ sourceType }: { sourceType: "SALE" | "SALE_RETURN" }) {
  const isReturn = sourceType === "SALE_RETURN";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        isReturn
          ? "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-200"
          : "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200"
      }`}
    >
      {isReturn ? "คืนสินค้า" : "ขาย"}
    </span>
  );
}

function BillCards({ bills }: { bills: SalesBillProfitRow[] }) {
  return (
    <div className="space-y-3 lg:hidden">
      {bills.map((bill) => (
        <article
          key={`${bill.sourceType}:${bill.sourceId}`}
          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#101b2e]"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <Link href={bill.href} className="font-mono font-semibold text-sky-700 hover:underline dark:text-sky-300">
                {bill.docNo}
              </Link>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {formatDateThai(bill.docDate)} · {saleChannelLabel(bill.channel)}
              </p>
            </div>
            <DocumentTypeBadge sourceType={bill.sourceType} />
          </div>
          <p className="mt-3 text-sm text-slate-700 dark:text-slate-200">{bill.customerName}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-slate-500">ยอดสุทธิไม่รวม VAT</dt><dd className="tabular-nums">{money(bill.netSalesExVat)}</dd></div>
            <div><dt className="text-xs text-slate-500">ต้นทุน</dt><dd className="tabular-nums">{money(bill.costAmount)}</dd></div>
            <div><dt className="text-xs text-slate-500">กำไรขั้นต้น</dt><dd className={`font-semibold tabular-nums ${valueTone(bill.grossProfit)}`}>{money(bill.grossProfit)}</dd></div>
            <div><dt className="text-xs text-slate-500">GP%</dt><dd className="font-semibold tabular-nums">{percent(bill.marginPct)}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function LineCards({ lines }: { lines: SalesLineProfitRow[] }) {
  return (
    <div className="space-y-3 lg:hidden">
      {lines.map((line) => (
        <article
          key={`${line.sourceType}:${line.sourceLineId}`}
          className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#101b2e]"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono text-xs text-slate-500 dark:text-slate-400">{line.productCode}</p>
              <p className="font-medium text-slate-900 dark:text-slate-100">{line.productName}</p>
            </div>
            <DocumentTypeBadge sourceType={line.sourceType} />
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            <Link href={line.href} className="font-mono text-sky-700 hover:underline dark:text-sky-300">{line.docNo}</Link>
            {` · ${line.customerName}`}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div><dt className="text-xs text-slate-500">จำนวน</dt><dd>{quantity(line.quantity)} {line.unitName}</dd></div>
            <div><dt className="text-xs text-slate-500">ราคาตั้ง/หน่วย</dt><dd className="tabular-nums">{optionalMoney(line.unitListPrice)}</dd></div>
            <div><dt className="text-xs text-slate-500">ส่วนลดรายการ</dt><dd className="tabular-nums">{optionalMoney(line.lineDiscount)}</dd></div>
            <div><dt className="text-xs text-slate-500">ส่วนลดท้ายบิลที่ปัน</dt><dd className="tabular-nums">{optionalMoney(line.allocatedBillDiscount)}</dd></div>
            <div><dt className="text-xs text-slate-500">ยอดสุทธิไม่รวม VAT</dt><dd className="tabular-nums">{money(line.netSalesExVat)}</dd></div>
            <div><dt className="text-xs text-slate-500">ต้นทุน</dt><dd className="tabular-nums">{money(line.costAmount)}</dd></div>
            <div><dt className="text-xs text-slate-500">กำไรขั้นต้น</dt><dd className={`font-semibold tabular-nums ${valueTone(line.grossProfit)}`}>{money(line.grossProfit)}</dd></div>
            <div><dt className="text-xs text-slate-500">GP%</dt><dd className="font-semibold tabular-nums">{percent(line.marginPct)}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}

export default async function SalesLineProfitPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const [, params] = await Promise.all([requirePermission("reports.view"), searchParams]);
  const filters = parseSalesLineProfitFilters(params);
  const [data, customers, categories, products] = await Promise.all([
    querySalesLineProfitData(filters),
    db.customer.findMany({
      where: { isActive: true },
      orderBy: [{ code: "asc" }, { name: "asc" }],
      select: { id: true, code: true, name: true },
      take: 1_000,
    }),
    db.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.product.findMany({
      where: { isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
      take: 2_000,
    }),
  ]);
  const query = buildSalesLineProfitQuery(filters);
  const totalBillDiscount = data.bills.reduce((sum, bill) => sum + bill.billDiscount, 0);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="รายงานการขาย"
        title="กำไรขั้นต้นรายบิล–รายสินค้า"
        description="ดูทั้งกำไรรวมของแต่ละบิลและกำไรของสินค้าแต่ละรายการ โดยส่วนลดท้ายบิลใช้ยอดที่ปันกลับใน FactProfit ชุดเดียวกับรายงานกำไรหลัก"
        actions={
          <Link
            href="/admin/reports/sales"
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm text-slate-700 hover:bg-slate-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5"
          >
            <ArrowLeft size={15} /> Sales Register
          </Link>
        }
      />

      <SalesLineProfitFilters
        defaults={{
          from: filters.fromStr,
          to: filters.toStr,
          channel: filters.channel,
          customerIds: filters.customerIds,
          categoryId: filters.categoryId ?? "",
          productCodeFrom: filters.productCodeFrom ?? "",
          productCodeTo: filters.productCodeTo ?? "",
          productIds: filters.productIds,
          status: filters.status,
          includeReturns: filters.includeReturns,
        }}
        customerOptions={customers.map((customer) => ({
          id: customer.id,
          label: customer.name,
          sublabel: customer.code ?? undefined,
        }))}
        categoryOptions={categories.map((category) => ({ id: category.id, label: category.name }))}
        productOptions={products.map((product) => ({
          id: product.id,
          label: product.name,
          sublabel: product.code,
        }))}
        exportHref={`/admin/reports/sales-line-profit/export?${query}`}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["ยอดก่อนส่วนลดรายการ", optionalMoney(data.totals.amountBeforeLineDiscount)],
          ["ส่วนลดระดับรายการ", optionalMoney(data.totals.lineDiscount)],
          ["ยอดหลังส่วนลดรายการ", optionalMoney(data.totals.amountAfterLineDiscount)],
          ["ส่วนลดท้ายบิลที่ปัน", optionalMoney(data.totals.allocatedBillDiscount)],
          ["ค่าจัดส่งสุทธิรวม VAT", money(data.totals.shippingAmountIncVat)],
          ["ยอดขายสุทธิรวม VAT", money(data.totals.netSalesIncVat)],
          ["ยอดขายสุทธิไม่รวม VAT", money(data.totals.netSalesExVat)],
          ["ต้นทุน", money(data.totals.costAmount)],
          ["กำไรขั้นต้น", money(data.totals.grossProfit)],
          ["GP%", percent(data.totals.marginPct)],
        ].map(([label, value], index) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#101b2e]">
            <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${index === 8 ? valueTone(data.totals.grossProfit) : "text-slate-900 dark:text-slate-100"}`}>{value}</p>
          </div>
        ))}
      </section>

      {data.totals.amountBeforeLineDiscount === null ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          ยอดก่อนส่วนลดและส่วนลดระดับรายการไม่แสดงเมื่อชุดข้อมูลเกิน 10,000 รายการ กรุณากรองช่วงให้แคบลง
        </p>
      ) : null}

      {(data.billRowsTruncated || data.lineRowsTruncated) ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100">
          หน้าจอแสดงสูงสุด 500 บิล/500 รายการเพื่อรักษาความเร็ว กรุณากรองช่วงให้แคบลงหรือ Export Excel เพื่อดูได้สูงสุด 10,000 รายการ
        </div>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100"><ReceiptText size={18} /> กำไรต่อบิล</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">รวมสินค้าและค่าจัดส่งของบิล · ส่วนลดท้ายบิลรวม {money(totalBillDiscount)} บาท</p>
          </div>
          <p className="text-sm text-slate-500">{data.bills.length.toLocaleString("th-TH")} เอกสาร</p>
        </div>

        <BillCards bills={data.bills} />
        <div className="hidden lg:block">
          <ReportTableShell tableClassName="min-w-[1260px]">
            <thead className="bg-[#1e3a5f] text-white dark:bg-sky-950">
              <tr>
                <th className="px-3 py-2.5 text-left">วันที่</th><th className="px-3 py-2.5 text-left">เอกสาร</th><th className="px-3 py-2.5 text-left">ประเภท</th><th className="px-3 py-2.5 text-left">อ้างอิงบิลขาย</th><th className="px-3 py-2.5 text-left">ลูกค้า</th><th className="px-3 py-2.5 text-left">ช่องทาง</th><th className="px-3 py-2.5 text-right">ส่วนลดท้ายบิล</th><th className="px-3 py-2.5 text-right">สุทธิรวม VAT</th><th className="px-3 py-2.5 text-right">สุทธิไม่รวม VAT</th><th className="px-3 py-2.5 text-right">ต้นทุน</th><th className="px-3 py-2.5 text-right">กำไรขั้นต้น</th><th className="px-3 py-2.5 text-right">GP%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {data.bills.length === 0 ? <tr><td colSpan={12} className="p-10 text-center text-slate-400">ไม่พบข้อมูล</td></tr> : data.bills.map((bill) => (
                <tr key={`${bill.sourceType}:${bill.sourceId}`} className="hover:bg-slate-50 dark:hover:bg-white/5">
                  <td className="whitespace-nowrap px-3 py-2">{formatDateThai(bill.docDate)}</td>
                  <td className="px-3 py-2"><Link href={bill.href} className="font-mono text-sky-700 hover:underline dark:text-sky-300">{bill.docNo}</Link></td>
                  <td className="px-3 py-2"><DocumentTypeBadge sourceType={bill.sourceType} /></td>
                  <td className="px-3 py-2 font-mono text-xs">{bill.referenceDocNo ?? "—"}</td>
                  <td className="px-3 py-2">{bill.customerName}</td><td className="px-3 py-2">{saleChannelLabel(bill.channel)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(bill.billDiscount)}</td><td className="px-3 py-2 text-right tabular-nums">{money(bill.netSalesIncVat)}</td><td className="px-3 py-2 text-right tabular-nums">{money(bill.netSalesExVat)}</td><td className="px-3 py-2 text-right tabular-nums">{money(bill.costAmount)}</td><td className={`px-3 py-2 text-right font-semibold tabular-nums ${valueTone(bill.grossProfit)}`}>{money(bill.grossProfit)}</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{percent(bill.marginPct)}</td>
                </tr>
              ))}
            </tbody>
          </ReportTableShell>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><h2 className="font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">กำไรต่อสินค้าในบิล</h2><p className="text-xs text-slate-500 dark:text-slate-400">ส่วนลดท้ายบิลถูกปันตามสัดส่วนยอดหลังส่วนลดรายการ</p></div>
          <p className="text-sm text-slate-500">แสดง {data.lines.length.toLocaleString("th-TH")} จาก {data.totalLineCount.toLocaleString("th-TH")} รายการ</p>
        </div>

        <LineCards lines={data.lines} />
        <div className="hidden lg:block">
          <ReportTableShell tableClassName="min-w-[1900px]">
            <thead className="bg-[#1e3a5f] text-white dark:bg-sky-950"><tr><th className="px-3 py-2.5 text-left">วันที่</th><th className="px-3 py-2.5 text-left">เอกสาร</th><th className="px-3 py-2.5 text-left">ประเภท</th><th className="px-3 py-2.5 text-left">ลูกค้า</th><th className="px-3 py-2.5 text-left">ช่องทาง</th><th className="px-3 py-2.5 text-left">รหัสสินค้า</th><th className="px-3 py-2.5 text-left">สินค้า</th><th className="px-3 py-2.5 text-right">จำนวน</th><th className="px-3 py-2.5 text-right">ราคาตั้ง/หน่วย</th><th className="px-3 py-2.5 text-right">ก่อนส่วนลด</th><th className="px-3 py-2.5 text-right">ส่วนลดรายการ</th><th className="px-3 py-2.5 text-right">หลังส่วนลดรายการ</th><th className="px-3 py-2.5 text-right">ปันส่วนลดท้ายบิล</th><th className="px-3 py-2.5 text-right">สุทธิรวม VAT</th><th className="px-3 py-2.5 text-right">สุทธิไม่รวม VAT</th><th className="px-3 py-2.5 text-right">ต้นทุน</th><th className="px-3 py-2.5 text-right">กำไรขั้นต้น</th><th className="px-3 py-2.5 text-right">GP%</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {data.lines.length === 0 ? <tr><td colSpan={18} className="p-10 text-center text-slate-400">ไม่พบข้อมูล</td></tr> : data.lines.map((line) => (
                <tr key={`${line.sourceType}:${line.sourceLineId}`} className="hover:bg-slate-50 dark:hover:bg-white/5">
                  <td className="whitespace-nowrap px-3 py-2">{formatDateThai(line.docDate)}</td><td className="px-3 py-2"><Link href={line.href} className="font-mono text-sky-700 hover:underline dark:text-sky-300">{line.docNo}</Link></td><td className="px-3 py-2"><DocumentTypeBadge sourceType={line.sourceType} /></td><td className="px-3 py-2">{line.customerName}</td><td className="px-3 py-2">{saleChannelLabel(line.channel)}</td><td className="px-3 py-2 font-mono text-xs">{line.productCode}</td><td className="px-3 py-2">{line.productName}</td><td className="px-3 py-2 text-right tabular-nums">{quantity(line.quantity)} {line.unitName}</td><td className="px-3 py-2 text-right tabular-nums">{optionalMoney(line.unitListPrice)}</td><td className="px-3 py-2 text-right tabular-nums">{optionalMoney(line.amountBeforeLineDiscount)}</td><td className="px-3 py-2 text-right tabular-nums">{optionalMoney(line.lineDiscount)}</td><td className="px-3 py-2 text-right tabular-nums">{money(line.amountAfterLineDiscount)}</td><td className="px-3 py-2 text-right tabular-nums">{optionalMoney(line.allocatedBillDiscount)}</td><td className="px-3 py-2 text-right tabular-nums">{money(line.netSalesIncVat)}</td><td className="px-3 py-2 text-right tabular-nums">{money(line.netSalesExVat)}</td><td className="px-3 py-2 text-right tabular-nums">{money(line.costAmount)}</td><td className={`px-3 py-2 text-right font-semibold tabular-nums ${valueTone(line.grossProfit)}`}>{money(line.grossProfit)}</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{percent(line.marginPct)}</td>
                </tr>
              ))}
            </tbody>
          </ReportTableShell>
        </div>
      </section>
    </div>
  );
}
