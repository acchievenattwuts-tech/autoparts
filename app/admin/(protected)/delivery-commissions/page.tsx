export const dynamic = "force-dynamic";

import { Truck } from "lucide-react";

import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import { hasPermissionAccess } from "@/lib/access-control";
import { db } from "@/lib/db";
import { DocStatus, FulfillmentType, ShippingStatus } from "@/lib/generated/prisma";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { getSiteConfig } from "@/lib/site-config";
import {
  formatDateOnlyForInput,
  formatDateThai,
  getThailandDateKey,
  getThailandMonthStartDateKey,
  parseDateOnlyToEndOfDay,
  parseDateOnlyToStartOfDay,
} from "@/lib/th-date";

import { cancelDeliveryCommissionRun, createDeliveryCommissionRun } from "./actions";

interface PageProps {
  searchParams: Promise<{
    deliveryStaffId?: string;
    fromDate?: string;
    toDate?: string;
  }>;
}

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export default async function DeliveryCommissionsPage({ searchParams }: PageProps) {
  await requirePermission("delivery_commissions.view");
  const createRunAction = async (formData: FormData) => {
    "use server";
    await createDeliveryCommissionRun(formData);
  };
  const cancelRunAction = async (formData: FormData) => {
    "use server";
    await cancelDeliveryCommissionRun(formData);
  };

  const { role, permissions } = await getSessionPermissionContext();
  const canCreate = hasPermissionAccess(role, permissions, "delivery_commissions.create");
  const canCancel = hasPermissionAccess(role, permissions, "delivery_commissions.cancel");

  const params = await searchParams;
  const today = getThailandDateKey();
  const fromDateKey = params.fromDate || getThailandMonthStartDateKey();
  const toDateKey = params.toDate || today;
  const deliveryStaffId = params.deliveryStaffId || "";
  const fromDate = parseDateOnlyToStartOfDay(fromDateKey);
  const toDate = parseDateOnlyToEndOfDay(toDateKey);

  const [config, users, accounts, expenseCode, eligibleSales, recentRuns] = await Promise.all([
    getSiteConfig(),
    db.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
    db.cashBankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ type: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, type: true },
    }),
    db.expenseCode.findFirst({
      where: { isDeliveryCommission: true, isActive: true },
      select: { code: true, name: true },
    }),
    deliveryStaffId
      ? db.sale.findMany({
          where: {
            status: DocStatus.ACTIVE,
            fulfillmentType: FulfillmentType.DELIVERY,
            shippingStatus: ShippingStatus.DELIVERED,
            deliveryStaffId,
            saleDate: { gte: fromDate, lte: toDate },
            shippingFee: { gt: 0 },
            deliveryCommissionItems: { none: { run: { status: DocStatus.ACTIVE } } },
          },
          orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
          select: {
            id: true,
            saleNo: true,
            saleDate: true,
            customerName: true,
            shippingFee: true,
            netAmount: true,
          },
        })
      : Promise.resolve([]),
    db.deliveryCommissionRun.findMany({
      orderBy: [{ payDate: "desc" }, { runNo: "desc" }],
      take: 30,
      include: {
        deliveryStaff: { select: { name: true } },
        cashBankAccount: { select: { code: true, name: true } },
        expense: { select: { expenseNo: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);

  const percent = Number(config.deliveryCommissionPercent);
  const previewRows = eligibleSales.map((sale) => {
    const shippingFee = Number(sale.shippingFee);
    return {
      ...sale,
      shippingFee,
      commissionAmount: roundMoney((shippingFee * percent) / 100),
    };
  });
  const shippingFeeTotal = roundMoney(previewRows.reduce((sum, row) => sum + row.shippingFee, 0));
  const commissionTotal = roundMoney(previewRows.reduce((sum, row) => sum + row.commissionAmount, 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Truck size={24} className="text-[#1e3a5f] dark:text-sky-300" />
          <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
            ทำจ่ายค่าส่งพนักงาน
          </h1>
        </div>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          ดึงบิลจัดส่งที่ส่งแล้วและยังไม่ได้ทำจ่าย เพื่อสร้างค่าใช้จ่ายและตัดเงินจากบัญชีที่เลือก
        </p>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
        <AdminSearchForm method="GET" className="grid gap-3 md:grid-cols-[1.3fr_1fr_1fr_auto]">
          <label className="text-sm">
            <span className="mb-1 block text-gray-600 dark:text-slate-300">พนักงานส่ง</span>
            <select
              name="deliveryStaffId"
              defaultValue={deliveryStaffId}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
            >
              <option value="">เลือกพนักงานส่ง</option>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.email})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600 dark:text-slate-300">จากวันที่</span>
            <input
              type="date"
              name="fromDate"
              defaultValue={fromDateKey}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-gray-600 dark:text-slate-300">ถึงวันที่</span>
            <input
              type="date"
              name="toDate"
              defaultValue={toDateKey}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
            />
          </label>
          <div className="flex items-end">
            <AdminSearchSubmitButton className="inline-flex w-full justify-center rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#162d4a]">
              แสดงรายการ
            </AdminSearchSubmitButton>
          </div>
        </AdminSearchForm>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <p className="text-xs text-gray-500 dark:text-slate-400">เปอร์เซ็นต์ทำจ่าย</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-slate-100">{percent}%</p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <p className="text-xs text-gray-500 dark:text-slate-400">ยอดค่าส่งรวม</p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-slate-100">฿{money(shippingFeeTotal)}</p>
        </div>
        <div className="rounded-xl border border-orange-200 bg-orange-50 p-4 shadow-sm dark:border-orange-400/20 dark:bg-orange-400/10">
          <p className="text-xs text-orange-700 dark:text-orange-200">ยอดทำจ่ายพนักงาน</p>
          <p className="mt-1 text-2xl font-semibold text-orange-700 dark:text-orange-100">฿{money(commissionTotal)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-white/10 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">เอกสารที่พร้อมทำจ่าย</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              รหัสค่าใช้จ่าย: {expenseCode ? `${expenseCode.code} ${expenseCode.name}` : "ยังไม่ได้ตั้งค่า"}
            </p>
          </div>
          {canCreate && previewRows.length > 0 && expenseCode ? (
            <form action={createRunAction} className="flex flex-col gap-2 md:min-w-[360px]">
              <input type="hidden" name="deliveryStaffId" value={deliveryStaffId} />
              <input type="hidden" name="fromDate" value={fromDateKey} />
              <input type="hidden" name="toDate" value={toDateKey} />
              {previewRows.map((row) => (
                <input key={row.id} type="hidden" name="saleIds" value={row.id} />
              ))}
              <div className="grid gap-2 md:grid-cols-2">
                <input
                  type="date"
                  name="payDate"
                  defaultValue={today}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                />
                <select
                  name="cashBankAccountId"
                  required
                  className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="">บัญชีที่จ่ายออก</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.code} {account.name}
                    </option>
                  ))}
                </select>
              </div>
              <input
                name="note"
                placeholder="หมายเหตุ"
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                type="submit"
                className="rounded-lg bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
              >
                สร้างทำจ่าย ฿{money(commissionTotal)}
              </button>
            </form>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-white/10">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500 dark:bg-slate-950/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">วันที่</th>
                <th className="px-4 py-3">เลขที่บิล</th>
                <th className="px-4 py-3">ลูกค้า</th>
                <th className="px-4 py-3 text-right">ยอดบิล</th>
                <th className="px-4 py-3 text-right">ค่าส่ง</th>
                <th className="px-4 py-3 text-right">ยอดพนักงานได้</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {previewRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400 dark:text-slate-500">
                    {deliveryStaffId ? "ไม่พบเอกสารที่พร้อมทำจ่าย" : "เลือกพนักงานส่งเพื่อแสดงรายการ"}
                  </td>
                </tr>
              ) : (
                previewRows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-white/5">
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{formatDateThai(row.saleDate)}</td>
                    <td className="px-4 py-3 font-mono font-medium text-[#1e3a5f] dark:text-sky-300">{row.saleNo}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-slate-200">{row.customerName || "-"}</td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-200">฿{money(Number(row.netAmount))}</td>
                    <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-200">฿{money(row.shippingFee)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-orange-600 dark:text-orange-300">฿{money(row.commissionAmount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="border-b border-gray-100 p-4 dark:border-white/10">
          <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">ประวัติทำจ่ายล่าสุด</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-white/10">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500 dark:bg-slate-950/60 dark:text-slate-400">
              <tr>
                <th className="px-4 py-3">วันที่จ่าย</th>
                <th className="px-4 py-3">เลขที่</th>
                <th className="px-4 py-3">พนักงานส่ง</th>
                <th className="px-4 py-3">เอกสารค่าใช้จ่าย</th>
                <th className="px-4 py-3 text-right">จำนวนบิล</th>
                <th className="px-4 py-3 text-right">ยอดจ่าย</th>
                <th className="px-4 py-3">สถานะ</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-white/10">
              {recentRuns.map((run) => (
                <tr key={run.id}>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{formatDateOnlyForInput(run.payDate)}</td>
                  <td className="px-4 py-3 font-mono text-[#1e3a5f] dark:text-sky-300">{run.runNo}</td>
                  <td className="px-4 py-3 text-gray-700 dark:text-slate-200">{run.deliveryStaff.name}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{run.expense?.expenseNo ?? "-"}</td>
                  <td className="px-4 py-3 text-right text-gray-700 dark:text-slate-200">{run._count.items}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-slate-100">฿{money(Number(run.commissionTotal))}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      run.status === "ACTIVE"
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200"
                        : "bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-slate-400"
                    }`}>
                      {run.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิก"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canCancel && run.status === "ACTIVE" ? (
                      <form action={cancelRunAction} className="inline-flex gap-2">
                        <input type="hidden" name="runId" value={run.id} />
                        <input type="hidden" name="cancelNote" value="ยกเลิกจากหน้าทำจ่ายค่าส่งพนักงาน" />
                        <button type="submit" className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-400/20 dark:text-red-300 dark:hover:bg-red-400/10">
                          ยกเลิก
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
