export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/lib/db";
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

export default async function ARReportPage({ searchParams }: PageProps) {
  await requirePermission("reports.view");
  const params = await searchParams;

  const hasFilter = params.from || params.to || params.customerId;

  type ARRow = {
    id: string;
    saleNo: string;
    saleDate: Date;
    customerName: string | null;
    customerId: string | null;
    customer: { name: string } | null;
    totalAmount: unknown;
    amountRemain: unknown;
    creditTerm: number | null;
  };

  let rows: ARRow[] = [];
  let customers: { id: string; name: string }[] = [];

  if (hasFilter) {
    [rows, customers] = await Promise.all([
      db.sale.findMany({
        where: {
          paymentType: "CREDIT_SALE",
          status: "ACTIVE",
          amountRemain: { gt: 0 },
          ...(params.customerId ? { customerId: params.customerId } : {}),
          ...(params.from || params.to
            ? {
                saleDate: {
                  ...(params.from ? { gte: new Date(params.from) } : {}),
                  ...(params.to ? { lte: new Date(params.to + "T23:59:59") } : {}),
                },
              }
            : {}),
        },
        orderBy: { saleDate: "asc" },
        take: 200,
        select: {
          id: true,
          saleNo: true,
          saleDate: true,
          customerName: true,
          customerId: true,
          customer: { select: { name: true } },
          totalAmount: true,
          amountRemain: true,
          creditTerm: true,
        },
      }),
      db.customer.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
        take: 500,
      }),
    ]);
  } else {
    customers = await db.customer.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 500,
    });
  }

  const totalRemain = rows.reduce((sum, row) => sum + Number(row.amountRemain), 0);
  const totalAmount = rows.reduce((sum, row) => sum + Number(row.totalAmount), 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900">ลูกหนี้ค้างชำระ (AR)</h1>
        <p className="text-sm text-gray-500">
          รายการขายเชื่อที่ยังค้างชำระ — เลือกช่วงวันที่หรือลูกค้าก่อนแสดงข้อมูล
        </p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          วันที่ขาย (ตั้งแต่)
          <input
            type="date"
            name="from"
            defaultValue={params.from ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          วันที่ขาย (ถึง)
          <input
            type="date"
            name="to"
            defaultValue={params.to ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ลูกค้า
          <select
            name="customerId"
            defaultValue={params.customerId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">ทุกลูกค้า</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-9 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]"
        >
          แสดงรายการ
        </button>
        <Link
          href="/admin/reports/ar"
          className="h-9 inline-flex items-center rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          ล้าง
        </Link>
      </form>

      {!hasFilter ? (
        <div className="rounded-xl border border-gray-100 bg-white p-12 text-center shadow-sm">
          <p className="text-gray-400">เลือกเงื่อนไขแล้วกด &ldquo;แสดงรายการ&rdquo; เพื่อดูข้อมูล</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">จำนวนเอกสาร</p>
              <p className="font-kanit text-2xl font-bold text-gray-900">{rows.length}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
              <p className="text-xs text-gray-500">ยอดขายรวม</p>
              <p className="font-kanit text-2xl font-bold text-gray-900">฿{formatCurrency(totalAmount)}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-rose-50 p-4 shadow-sm">
              <p className="text-xs text-rose-600">ยอดค้างชำระรวม</p>
              <p className="font-kanit text-2xl font-bold text-rose-700">฿{formatCurrency(totalRemain)}</p>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">เลขที่</th>
                    <th className="px-3 py-2 text-left font-medium">วันที่ขาย</th>
                    <th className="px-3 py-2 text-left font-medium">ลูกค้า</th>
                    <th className="px-3 py-2 text-right font-medium">ยอดขาย</th>
                    <th className="px-3 py-2 text-right font-medium">ค้างชำระ</th>
                    <th className="px-3 py-2 text-right font-medium">เครดิต (วัน)</th>
                    <th className="px-3 py-2 text-center font-medium">เอกสาร</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-gray-400">
                        ไม่พบลูกหนี้ค้างชำระตามเงื่อนไขที่เลือก
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => (
                      <tr key={row.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">{row.saleNo}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(row.saleDate)}</td>
                        <td className="px-3 py-2 text-gray-800">
                          {row.customer?.name ?? row.customerName ?? "-"}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-700">
                          {formatCurrency(Number(row.totalAmount))}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-rose-700">
                          {formatCurrency(Number(row.amountRemain))}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500">
                          {row.creditTerm != null ? `${row.creditTerm} วัน` : "-"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <Link
                            href={`/admin/sales/${row.id}`}
                            className="text-xs font-medium text-[#1e3a5f] hover:underline"
                          >
                            เปิด
                          </Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
