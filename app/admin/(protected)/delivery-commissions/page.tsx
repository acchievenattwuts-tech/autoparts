export const dynamic = "force-dynamic";

import Link from "next/link";
import { FileSpreadsheet, FileText, Truck } from "lucide-react";

import Pagination from "@/components/shared/Pagination";
import type { SelectOption } from "@/components/shared/SearchableSelect";
import { hasPermissionAccess } from "@/lib/access-control";
import { db } from "@/lib/db";
import { DocStatus, FulfillmentType, SalePaymentType, ShippingStatus } from "@/lib/generated/prisma";
import type { Prisma } from "@/lib/generated/prisma";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { SHIPPING_STATUS_BADGE, SHIPPING_STATUS_LABEL } from "@/lib/shipping";
import { getSiteConfig } from "@/lib/site-config";
import {
  formatDateOnlyForInput,
  formatDateThai,
  formatDateTimeThai,
  getThailandDateKey,
  getThailandMonthStartDateKey,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

import DeliveryCommissionsReportFilter from "./DeliveryCommissionsReportFilter";
import PayoutPanel from "./PayoutPanel";

type TabKey = "payouts" | "report";
const REPORT_PAGE_SIZE = 50;
const MAX_PAYOUT_SALES = 200;

interface PageProps {
  searchParams: Promise<{
    tab?: string;
    deliveryStaffId?: string;
    fromDate?: string;
    toDate?: string;
    highlight?: string;
    rFrom?: string;
    rTo?: string;
    rStaffId?: string;
    customerId?: string;
    unpaidOnly?: string;
    page?: string;
  }>;
}

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

type PaymentStatus = "PAID" | "PARTIAL" | "UNPAID";
function getPaymentStatus(
  paymentType: SalePaymentType,
  netAmount: number,
  amountRemain: number,
): PaymentStatus {
  if (paymentType === SalePaymentType.CASH_SALE) return "PAID";
  if (amountRemain <= 0) return "PAID";
  if (amountRemain >= netAmount) return "UNPAID";
  return "PARTIAL";
}

const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  PAID: "ชำระครบ",
  PARTIAL: "ชำระบางส่วน",
  UNPAID: "ยังไม่ชำระ",
};
const PAYMENT_STATUS_BADGE: Record<PaymentStatus, string> = {
  PAID: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200",
  PARTIAL: "bg-amber-100 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200",
  UNPAID: "bg-red-100 text-red-700 dark:bg-red-400/10 dark:text-red-200",
};

export default async function DeliveryCommissionsPage({ searchParams }: PageProps) {
  await requirePermission("delivery_commissions.view");

  const params = await searchParams;
  const activeTab: TabKey = params.tab === "report" ? "report" : "payouts";
  const { role, permissions } = await getSessionPermissionContext();
  const canCreate = hasPermissionAccess(role, permissions, "delivery_commissions.create");
  const canCancel = hasPermissionAccess(role, permissions, "delivery_commissions.cancel");

  const tabBaseClass =
    "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition";
  const tabActiveClass = "bg-[#1e3a5f] text-white shadow dark:bg-sky-500 dark:text-slate-950";
  const tabInactiveClass =
    "text-gray-600 hover:bg-gray-100 dark:text-slate-300 dark:hover:bg-white/10";

  const header = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Truck size={24} className="text-[#1e3a5f] dark:text-sky-300" />
        <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
          ทำจ่ายค่าส่งพนักงาน
        </h1>
      </div>
      <div className="flex flex-wrap gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm dark:border-white/10 dark:bg-[#111827]">
        <Link
          href="/admin/delivery-commissions?tab=payouts"
          className={`${tabBaseClass} ${activeTab === "payouts" ? tabActiveClass : tabInactiveClass}`}
        >
          ทำจ่าย / ประวัติ
        </Link>
        <Link
          href="/admin/delivery-commissions?tab=report"
          className={`${tabBaseClass} ${activeTab === "report" ? tabActiveClass : tabInactiveClass}`}
        >
          รายงานบิลจัดส่ง
        </Link>
      </div>
    </div>
  );

  if (activeTab === "report") {
    return (
      <div className="space-y-6">
        {header}
        <ReportTab params={params} />
      </div>
    );
  }

  const today = getThailandDateKey();
  const fromDateKey = params.fromDate || getThailandMonthStartDateKey();
  const toDateKey = params.toDate || today;
  const deliveryStaffId = params.deliveryStaffId || "";
  const highlightId = params.highlight || "";
  const fromDate = parseDateOnlyToStartOfDay(fromDateKey);
  const toDate = parseDateOnlyToEndOfDay(toDateKey);

  const eligibleWhere: Prisma.SaleWhereInput = deliveryStaffId
    ? {
        status: DocStatus.ACTIVE,
        fulfillmentType: FulfillmentType.DELIVERY,
        shippingStatus: ShippingStatus.DELIVERED,
        deliveryStaffId,
        saleDate: { gte: fromDate, lte: toDate },
        shippingFee: { gt: 0 },
        deliveryCommissionItems: { none: { activeSaleId: { not: null } } },
      }
    : { id: { in: [] } };

  const [config, users, accounts, expenseCode, eligibleSales, totalEligibleSales, recentRuns] =
    await Promise.all([
      getSiteConfig(),
      db.user.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true, email: true },
      }),
      db.cashBankAccount.findMany({
        where: { isActive: true },
        orderBy: [{ type: "asc" }, { code: "asc" }],
        select: { id: true, code: true, name: true },
      }),
      db.expenseCode.findFirst({
        where: { isDeliveryCommission: true, isActive: true },
        select: { code: true, name: true },
      }),
      db.sale.findMany({
        where: eligibleWhere,
        orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
        take: MAX_PAYOUT_SALES,
        select: {
          id: true,
          saleNo: true,
          saleDate: true,
          customerName: true,
          shippingFee: true,
          netAmount: true,
        },
      }),
      db.sale.count({ where: eligibleWhere }),
      db.deliveryCommissionRun.findMany({
        orderBy: [{ payDate: "desc" }, { runNo: "desc" }],
        take: 30,
        include: {
          deliveryStaff: { select: { name: true } },
          expense: { select: { id: true, expenseNo: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);

  const percent = Number(config.deliveryCommissionPercent);
  const previewRows = eligibleSales.map((sale) => {
    const shippingFee = Number(sale.shippingFee);
    return {
      id: sale.id,
      saleNo: sale.saleNo,
      saleDate: sale.saleDate.toISOString(),
      customerName: sale.customerName ?? null,
      netAmount: Number(sale.netAmount),
      shippingFee,
      commissionAmount: roundMoney((shippingFee * percent) / 100),
    };
  });
  const shippingFeeTotal = roundMoney(previewRows.reduce((sum, row) => sum + row.shippingFee, 0));
  const commissionTotal = roundMoney(previewRows.reduce((sum, row) => sum + row.commissionAmount, 0));
  const staffOptions: SelectOption[] = users.map((user) => ({
    id: user.id,
    label: user.name,
    sublabel: user.email,
  }));
  const accountOptions: SelectOption[] = accounts.map((account) => ({
    id: account.id,
    label: `${account.code} ${account.name}`,
  }));

  return (
    <div className="space-y-6">
      {header}
      <p className="text-sm text-gray-500 dark:text-slate-400">
        ดึงบิลจัดส่งที่ส่งแล้วและยังไม่ได้ทำจ่าย เพื่อสร้างค่าใช้จ่ายและตัดเงินจากบัญชีที่เลือก
      </p>
      <PayoutPanel
        staffOptions={staffOptions}
        accountOptions={accountOptions}
        deliveryStaffId={deliveryStaffId}
        fromDate={fromDateKey}
        toDate={toDateKey}
        today={today}
        highlightId={highlightId}
        percent={percent}
        shippingFeeTotal={shippingFeeTotal}
        commissionTotal={commissionTotal}
        previewRows={previewRows}
        totalEligibleSales={totalEligibleSales}
        expenseCodeLabel={expenseCode ? `${expenseCode.code} ${expenseCode.name}` : null}
        canCreate={canCreate}
        canCancel={canCancel}
        recentRuns={recentRuns.map((run) => ({
          id: run.id,
          runNo: run.runNo,
          payDate: formatDateOnlyForInput(run.payDate),
          deliveryStaffName: run.deliveryStaff.name,
          expenseId: run.expense?.id ?? null,
          expenseNo: run.expense?.expenseNo ?? null,
          itemCount: run._count.items,
          commissionTotal: Number(run.commissionTotal),
          status: run.status,
        }))}
      />
    </div>
  );
}

async function ReportTab({ params }: { params: Awaited<PageProps["searchParams"]> }) {
  const rFromKey = params.rFrom || "";
  const rToKey = params.rTo || "";
  const customerId = params.customerId || "";
  const rStaffId = params.rStaffId || "";
  const unpaidOnly = params.unpaidOnly === "1";
  const page = Math.max(1, Number(params.page) || 1);

  const config = await getSiteConfig();
  const currentPercent = Number(config.deliveryCommissionPercent);

  const [customers, staff] = await Promise.all([
    db.customer.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, code: true, name: true },
      take: 1000,
    }),
    db.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
  ]);

  const customerOptions: SelectOption[] = customers.map((c) => ({
    id: c.id,
    label: c.name,
    sublabel: c.code ?? undefined,
  }));
  const staffOptions: SelectOption[] = staff.map((u) => ({
    id: u.id,
    label: u.name,
    sublabel: u.email,
  }));

  const where: Prisma.SaleWhereInput = {
    status: DocStatus.ACTIVE,
    fulfillmentType: FulfillmentType.DELIVERY,
  };
  if (rFromKey || rToKey) {
    const range: Prisma.DateTimeFilter = {};
    if (rFromKey) range.gte = parseDateOnlyToStartOfDay(rFromKey);
    if (rToKey) range.lte = parseDateOnlyToEndOfDay(rToKey);
    where.saleDate = range;
  }
  if (customerId) where.customerId = customerId;
  if (rStaffId) where.deliveryStaffId = rStaffId;
  if (unpaidOnly) where.amountRemain = { gt: 0 };

  const [totalCount, sales] = await Promise.all([
    db.sale.count({ where }),
    db.sale.findMany({
      where,
      orderBy: [{ saleDate: "desc" }, { saleNo: "desc" }],
      skip: (page - 1) * REPORT_PAGE_SIZE,
      take: REPORT_PAGE_SIZE,
      select: {
        id: true,
        saleNo: true,
        saleDate: true,
        customerName: true,
        netAmount: true,
        amountRemain: true,
        shippingFee: true,
        paymentType: true,
        shippingStatus: true,
        deliveryStaff: { select: { name: true } },
        deliveryProofs: {
          orderBy: { capturedAt: "desc" },
          take: 1,
          select: { capturedAt: true },
        },
        deliveryCommissionItems: {
          where: { run: { status: DocStatus.ACTIVE } },
          take: 1,
          select: {
            commissionAmount: true,
            commissionPercent: true,
            run: { select: { id: true, runNo: true } },
          },
        },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(totalCount / REPORT_PAGE_SIZE));

  const aggregates = sales.reduce(
    (acc, sale) => {
      const shippingFee = Number(sale.shippingFee ?? 0);
      const paid = sale.deliveryCommissionItems[0];
      const commissionAmount = paid
        ? Number(paid.commissionAmount)
        : roundMoney((shippingFee * currentPercent) / 100);
      acc.shippingFeeTotal += shippingFee;
      acc.commissionTotal += commissionAmount;
      if (paid) acc.paidCount += 1;
      else acc.unpaidCount += 1;
      return acc;
    },
    { shippingFeeTotal: 0, commissionTotal: 0, paidCount: 0, unpaidCount: 0 },
  );

  const baseSearchParams: Record<string, string> = { tab: "report" };
  if (rFromKey) baseSearchParams.rFrom = rFromKey;
  if (rToKey) baseSearchParams.rTo = rToKey;
  if (customerId) baseSearchParams.customerId = customerId;
  if (rStaffId) baseSearchParams.rStaffId = rStaffId;
  if (unpaidOnly) baseSearchParams.unpaidOnly = "1";

  const exportParams = new URLSearchParams();
  if (rFromKey) exportParams.set("rFrom", rFromKey);
  if (rToKey) exportParams.set("rTo", rToKey);
  if (customerId) exportParams.set("customerId", customerId);
  if (rStaffId) exportParams.set("rStaffId", rStaffId);
  if (unpaidOnly) exportParams.set("unpaidOnly", "1");
  const exportQuery = exportParams.toString() ? `?${exportParams.toString()}` : "";
  const exportCsvHref = `/admin/delivery-commissions/export${exportQuery}`;
  const exportExcelHref = `/admin/delivery-commissions/export-excel${exportQuery}`;

  return (
    <div className="space-y-4">
      <DeliveryCommissionsReportFilter
        initialFromDate={rFromKey}
        initialToDate={rToKey}
        initialCustomerId={customerId}
        initialDeliveryStaffId={rStaffId}
        initialUnpaidOnly={unpaidOnly}
        customerOptions={customerOptions}
        staffOptions={staffOptions}
      />

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <p className="text-xs text-gray-500 dark:text-slate-400">บิลทั้งหมด</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-slate-100">{totalCount.toLocaleString("th-TH")}</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <p className="text-xs text-gray-500 dark:text-slate-400">ทำจ่ายแล้ว / ยังไม่จ่าย (หน้านี้)</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-slate-100">
            {aggregates.paidCount} / {aggregates.unpaidCount}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <p className="text-xs text-gray-500 dark:text-slate-400">ยอดค่าส่งรวม (หน้านี้)</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-slate-100">฿{money(roundMoney(aggregates.shippingFeeTotal))}</p>
        </div>
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 shadow-sm dark:border-orange-400/20 dark:bg-orange-400/10">
          <p className="text-xs text-orange-700 dark:text-orange-200">ยอดทำจ่ายพนักงาน (หน้านี้)</p>
          <p className="mt-1 text-2xl font-semibold text-orange-700 dark:text-orange-100">฿{money(roundMoney(aggregates.commissionTotal))}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-gray-500 dark:text-slate-400">
          พบทั้งหมด {totalCount.toLocaleString("th-TH")} บิล
          {totalCount > 10000 ? <span className="text-orange-600"> (export จะจำกัดที่ 10,000 แถวแรก)</span> : null}
        </p>
        <div className="flex gap-2">
          <a
            href={exportCsvHref}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-gray-600 px-3 text-sm font-medium text-white hover:bg-gray-700"
          >
            <FileText size={14} />
            CSV
          </a>
          <a
            href={exportExcelHref}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3 text-sm font-medium text-white hover:bg-green-700"
          >
            <FileSpreadsheet size={14} />
            Excel
          </a>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-white/10">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500 dark:bg-slate-950/60 dark:text-slate-400">
              <tr>
                <th className="px-3 py-3">วันที่ขาย</th>
                <th className="px-3 py-3">วันที่ส่ง</th>
                <th className="px-3 py-3">เลขที่บิล</th>
                <th className="px-3 py-3">ลูกค้า</th>
                <th className="px-3 py-3">พนักงานส่ง</th>
                <th className="px-3 py-3 text-right">ยอดบิล</th>
                <th className="px-3 py-3 text-right">ค่าส่ง</th>
                <th className="px-3 py-3 text-right">ยอดทำจ่าย</th>
                <th className="px-3 py-3">สถานะจัดส่ง</th>
                <th className="px-3 py-3">สถานะชำระ</th>
                <th className="px-3 py-3">ทำจ่ายค่าส่ง</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {sales.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-gray-400 dark:text-slate-500">
                    ไม่พบข้อมูลตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                sales.map((sale) => {
                  const shippingFee = Number(sale.shippingFee ?? 0);
                  const netAmount = Number(sale.netAmount);
                  const amountRemain = Number(sale.amountRemain);
                  const paymentStatus = getPaymentStatus(sale.paymentType, netAmount, amountRemain);
                  const paidItem = sale.deliveryCommissionItems[0];
                  const commissionAmount = paidItem
                    ? Number(paidItem.commissionAmount)
                    : roundMoney((shippingFee * currentPercent) / 100);
                  const proof = sale.deliveryProofs[0];
                  return (
                    <tr key={sale.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                      <td className="px-3 py-3 whitespace-nowrap text-gray-600 dark:text-slate-300">{formatDateThai(sale.saleDate)}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-gray-600 dark:text-slate-300">
                        {proof ? formatDateTimeThai(proof.capturedAt) : "-"}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap font-mono font-medium text-[#1e3a5f] dark:text-sky-300">
                        <Link href={`/admin/sales/${sale.id}`} className="hover:underline">{sale.saleNo}</Link>
                      </td>
                      <td className="px-3 py-3 text-gray-700 dark:text-slate-200">{sale.customerName || "-"}</td>
                      <td className="px-3 py-3 text-gray-700 dark:text-slate-200">{sale.deliveryStaff?.name ?? "-"}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-right text-gray-700 dark:text-slate-200">฿{money(netAmount)}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-right text-gray-700 dark:text-slate-200">฿{money(shippingFee)}</td>
                      <td className="px-3 py-3 whitespace-nowrap text-right font-semibold text-orange-600 dark:text-orange-300">
                        ฿{money(commissionAmount)}
                        {!paidItem ? <span className="ml-1 text-[10px] text-gray-400">*</span> : null}
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${SHIPPING_STATUS_BADGE[sale.shippingStatus]}`}>
                          {SHIPPING_STATUS_LABEL[sale.shippingStatus]}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${PAYMENT_STATUS_BADGE[paymentStatus]}`}>
                          {PAYMENT_STATUS_LABEL[paymentStatus]}
                        </span>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        {paidItem ? (
                          <Link
                            href={`/admin/delivery-commissions?tab=payouts&highlight=${paidItem.run.id}#run-${paidItem.run.id}`}
                            className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/20"
                          >
                            จ่ายแล้ว · {paidItem.run.runNo}
                          </Link>
                        ) : (
                          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500 dark:bg-white/10 dark:text-slate-400">
                            ยังไม่จ่าย
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {sales.some((sale) => sale.deliveryCommissionItems.length === 0) ? (
        <p className="text-xs text-gray-400 dark:text-slate-500">
          * ยอดทำจ่ายของบิลที่ยังไม่ทำจ่ายคำนวณจาก % ปัจจุบัน ({currentPercent}%) — ยอดจริงจะถูก snapshot ตอนสร้างเอกสารทำจ่าย
        </p>
      ) : null}

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        basePath="/admin/delivery-commissions"
        searchParams={baseSearchParams}
      />
    </div>
  );
}
