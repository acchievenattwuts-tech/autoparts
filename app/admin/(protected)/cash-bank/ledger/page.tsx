export const dynamic = "force-dynamic";

import Link from "next/link";
import { getActiveCashBankAccountOptions } from "@/lib/cash-bank-accounts";
import {
  parseCashBankReportFilters,
  queryCashBankLedgerData,
} from "@/lib/cash-bank-report-queries";
import { requirePermission } from "@/lib/require-auth";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

function formatDate(value: Date): string {
  return value.toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default async function CashBankLedgerPage({ searchParams }: PageProps) {
  await requirePermission("cash_bank.view");
  const params = await searchParams;
  const filters = parseCashBankReportFilters(params);

  const [accounts, ledger] = await Promise.all([
    getActiveCashBankAccountOptions(),
    queryCashBankLedgerData(filters),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900">Cash / Bank Ledger</h1>
          <p className="text-sm text-gray-500">
            ดูสมุดเคลื่อนไหวเงินรายบัญชี พร้อม filter, source, เอกสารต้นทาง และ running balance
          </p>
        </div>
        <div className="hidden">
          <Link href="/admin/cash-bank" className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
            จัดการบัญชี
          </Link>
          <Link href="/admin/cash-bank/transfers" className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#163055]">
            โอนเงิน
          </Link>
          <Link href="/admin/cash-bank/adjustments" className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
            ปรับยอดเงิน
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <form method="GET" className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-sm font-medium text-gray-700">
            บัญชี
            <select
              name="accountId"
              defaultValue={filters.accountId ?? ""}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">ทุกบัญชี</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} - {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">
            ตั้งแต่วันที่
            <input
              type="date"
              name="from"
              defaultValue={filters.fromStr}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm font-medium text-gray-700">
            ถึงวันที่
            <input
              type="date"
              name="to"
              defaultValue={filters.toStr}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm font-medium text-gray-700">
            Source
            <select
              name="sourceType"
              defaultValue={filters.sourceType}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="ALL">ทั้งหมด</option>
              <option value="SALE">ขายสินค้า</option>
              <option value="RECEIPT">รับชำระหนี้</option>
              <option value="PURCHASE">ซื้อสินค้า</option>
              <option value="EXPENSE">ค่าใช้จ่าย</option>
              <option value="CN_SALE">CN ขาย</option>
              <option value="CN_PURCHASE">CN ซื้อ</option>
              <option value="SUPPLIER_ADVANCE">เงินมัดจำซัพพลายเออร์</option>
              <option value="SUPPLIER_PAYMENT">จ่ายชำระซัพพลายเออร์</option>
              <option value="TRANSFER">โอนเงิน</option>
              <option value="ADJUSTMENT">ปรับยอดเงิน</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#163055]">
              แสดงรายการ
            </button>
            <Link href="/admin/cash-bank/ledger" className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
              ล้าง
            </Link>
          </div>
        </form>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-xs text-gray-500">ยอดยกมา</p>
            <p className="font-kanit text-xl font-bold text-gray-900">{formatCurrency(ledger.openingBalance)}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3">
            <p className="text-xs text-emerald-700">รวมรับ</p>
            <p className="font-kanit text-xl font-bold text-emerald-700">{formatCurrency(ledger.totalIn)}</p>
          </div>
          <div className="rounded-xl bg-rose-50 p-3">
            <p className="text-xs text-rose-700">รวมจ่าย</p>
            <p className="font-kanit text-xl font-bold text-rose-700">{formatCurrency(ledger.totalOut)}</p>
          </div>
          <div className="rounded-xl bg-blue-50 p-3">
            <p className="text-xs text-blue-700">ยอดคงเหลือปลายงวด</p>
            <p className="font-kanit text-xl font-bold text-[#1e3a5f]">{formatCurrency(ledger.endingBalance)}</p>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">วันที่</th>
                <th className="px-3 py-2 text-left font-medium">บัญชี</th>
                <th className="px-3 py-2 text-left font-medium">อ้างอิง</th>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="px-3 py-2 text-left font-medium">เอกสารต้นทาง</th>
                <th className="px-3 py-2 text-left font-medium">หมายเหตุ</th>
                <th className="px-3 py-2 text-right font-medium">รับเข้า</th>
                <th className="px-3 py-2 text-right font-medium">จ่ายออก</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-gray-400">
                    ไม่พบ movement ตามเงื่อนไขที่เลือก
                  </td>
                </tr>
              ) : (
                ledger.rows.map((row) => (
                  <tr key={`${row.accountId}-${row.rowNo}`} className="border-t border-gray-100">
                    <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(row.txnDate)}</td>
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-900">{row.accountName}</p>
                      <p className="text-xs text-gray-400">{row.accountCode}</p>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">{row.referenceNo}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                        {row.sourceLabel}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      {row.sourceHref ? (
                        <Link href={row.sourceHref} className="text-sm font-medium text-[#1e3a5f] hover:underline">
                          เปิดเอกสาร
                        </Link>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-gray-500">{row.note || "-"}</td>
                    <td className="px-3 py-2 text-right font-medium text-emerald-700">
                      {row.inAmount > 0 ? formatCurrency(row.inAmount) : "-"}
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-rose-700">
                      {row.outAmount > 0 ? formatCurrency(row.outAmount) : "-"}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatCurrency(row.balanceAfter)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
