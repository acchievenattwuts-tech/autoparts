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

export default async function APReportPage({ searchParams }: PageProps) {
  await requirePermission("reports.view");
  const params = await searchParams;

  const hasFilter = params.from || params.to || params.supplierId;

  type PurchaseRow = {
    id: string;
    purchaseNo: string;
    purchaseDate: Date;
    supplier: { name: string } | null;
    totalAmount: unknown;
    amountRemain: unknown;
  };

  type AdvanceRow = {
    id: string;
    advanceNo: string;
    advanceDate: Date;
    supplier: { name: string } | null;
    totalAmount: unknown;
    amountRemain: unknown;
  };

  type CNRow = {
    id: string;
    returnNo: string;
    returnDate: Date;
    supplier: { name: string } | null;
    totalAmount: unknown;
    amountRemain: unknown;
  };

  let purchases: PurchaseRow[] = [];
  let advances: AdvanceRow[] = [];
  let cnCredits: CNRow[] = [];
  let suppliers: { id: string; name: string }[] = [];

  const dateWhere = (field: string) =>
    params.from || params.to
      ? {
          [field]: {
            ...(params.from ? { gte: new Date(params.from) } : {}),
            ...(params.to ? { lte: new Date(params.to + "T23:59:59") } : {}),
          },
        }
      : {};

  if (hasFilter) {
    [purchases, advances, cnCredits, suppliers] = await Promise.all([
      db.purchase.findMany({
        where: {
          purchaseType: "CREDIT_PURCHASE",
          status: "ACTIVE",
          amountRemain: { gt: 0 },
          ...(params.supplierId ? { supplierId: params.supplierId } : {}),
          ...dateWhere("purchaseDate"),
        },
        orderBy: { purchaseDate: "asc" },
        take: 200,
        select: {
          id: true,
          purchaseNo: true,
          purchaseDate: true,
          supplier: { select: { name: true } },
          totalAmount: true,
          amountRemain: true,
        },
      }),
      db.supplierAdvance.findMany({
        where: {
          status: "ACTIVE",
          amountRemain: { gt: 0 },
          ...(params.supplierId ? { supplierId: params.supplierId } : {}),
          ...dateWhere("advanceDate"),
        },
        orderBy: { advanceDate: "asc" },
        take: 200,
        select: {
          id: true,
          advanceNo: true,
          advanceDate: true,
          supplier: { select: { name: true } },
          totalAmount: true,
          amountRemain: true,
        },
      }),
      db.purchaseReturn.findMany({
        where: {
          settlementType: "SUPPLIER_CREDIT",
          status: "ACTIVE",
          amountRemain: { gt: 0 },
          ...(params.supplierId ? { supplierId: params.supplierId } : {}),
          ...dateWhere("returnDate"),
        },
        orderBy: { returnDate: "asc" },
        take: 200,
        select: {
          id: true,
          returnNo: true,
          returnDate: true,
          supplier: { select: { name: true } },
          totalAmount: true,
          amountRemain: true,
        },
      }),
      db.supplier.findMany({
        where: { isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
        take: 500,
      }),
    ]);
  } else {
    suppliers = await db.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 500,
    });
  }

  const totalPayable = purchases.reduce((sum, r) => sum + Number(r.amountRemain), 0);
  const totalAdvance = advances.reduce((sum, r) => sum + Number(r.amountRemain), 0);
  const totalCN = cnCredits.reduce((sum, r) => sum + Number(r.amountRemain), 0);
  const netPayable = totalPayable - totalAdvance - totalCN;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-kanit text-2xl font-bold text-gray-900">เจ้าหนี้คงค้าง (AP)</h1>
        <p className="text-sm text-gray-500">
          ยอดค้างจ่ายซัพพลายเออร์ เงินมัดจำคงเหลือ และเครดิต CN คืนสินค้า
        </p>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          วันที่เอกสาร (ตั้งแต่)
          <input
            type="date"
            name="from"
            defaultValue={params.from ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          วันที่เอกสาร (ถึง)
          <input
            type="date"
            name="to"
            defaultValue={params.to ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
          ซัพพลายเออร์
          <select
            name="supplierId"
            defaultValue={params.supplierId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">ทั้งหมด</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
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
          href="/admin/reports/ap"
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
        <div className="space-y-6">
          {/* Net Position Summary */}
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-xl border border-gray-100 bg-rose-50 p-4 shadow-sm">
              <p className="text-xs text-rose-600">ค้างจ่ายซัพพลายเออร์</p>
              <p className="font-kanit text-xl font-bold text-rose-700">฿{formatCurrency(totalPayable)}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-emerald-50 p-4 shadow-sm">
              <p className="text-xs text-emerald-600">เงินมัดจำคงเหลือ (ลบ)</p>
              <p className="font-kanit text-xl font-bold text-emerald-700">฿{formatCurrency(totalAdvance)}</p>
            </div>
            <div className="rounded-xl border border-gray-100 bg-amber-50 p-4 shadow-sm">
              <p className="text-xs text-amber-700">เครดิต CN คืนสินค้า (ลบ)</p>
              <p className="font-kanit text-xl font-bold text-amber-700">฿{formatCurrency(totalCN)}</p>
            </div>
            <div className={`rounded-xl border p-4 shadow-sm ${netPayable >= 0 ? "border-gray-100 bg-[#1e3a5f]/5" : "border-emerald-100 bg-emerald-50"}`}>
              <p className="text-xs text-gray-600">ยอดสุทธิคงค้าง</p>
              <p className={`font-kanit text-xl font-bold ${netPayable >= 0 ? "text-[#1e3a5f]" : "text-emerald-700"}`}>
                ฿{formatCurrency(Math.abs(netPayable))} {netPayable < 0 ? "(เกินจ่าย)" : ""}
              </p>
            </div>
          </div>

          {/* AP Outstanding - Purchases */}
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="font-kanit text-base font-semibold text-gray-900">ค้างจ่ายซัพพลายเออร์ (ซื้อเชื่อ)</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">เลขที่</th>
                    <th className="px-3 py-2 text-left font-medium">วันที่ซื้อ</th>
                    <th className="px-3 py-2 text-left font-medium">ซัพพลายเออร์</th>
                    <th className="px-3 py-2 text-right font-medium">ยอดซื้อ</th>
                    <th className="px-3 py-2 text-right font-medium">ค้างจ่าย</th>
                    <th className="px-3 py-2 text-center font-medium">เอกสาร</th>
                  </tr>
                </thead>
                <tbody>
                  {purchases.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-gray-400">ไม่พบรายการ</td>
                    </tr>
                  ) : (
                    purchases.map((row) => (
                      <tr key={row.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">{row.purchaseNo}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(row.purchaseDate)}</td>
                        <td className="px-3 py-2 text-gray-800">{row.supplier?.name ?? "-"}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(Number(row.totalAmount))}</td>
                        <td className="px-3 py-2 text-right font-medium text-rose-700">{formatCurrency(Number(row.amountRemain))}</td>
                        <td className="px-3 py-2 text-center">
                          <Link href={`/admin/purchases/${row.id}`} className="text-xs font-medium text-[#1e3a5f] hover:underline">เปิด</Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Supplier Advances */}
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="font-kanit text-base font-semibold text-gray-900">เงินมัดจำซัพพลายเออร์คงเหลือ</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">เลขที่</th>
                    <th className="px-3 py-2 text-left font-medium">วันที่</th>
                    <th className="px-3 py-2 text-left font-medium">ซัพพลายเออร์</th>
                    <th className="px-3 py-2 text-right font-medium">ยอดมัดจำ</th>
                    <th className="px-3 py-2 text-right font-medium">คงเหลือ</th>
                    <th className="px-3 py-2 text-center font-medium">เอกสาร</th>
                  </tr>
                </thead>
                <tbody>
                  {advances.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-gray-400">ไม่พบรายการ</td>
                    </tr>
                  ) : (
                    advances.map((row) => (
                      <tr key={row.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">{row.advanceNo}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(row.advanceDate)}</td>
                        <td className="px-3 py-2 text-gray-800">{row.supplier?.name ?? "-"}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(Number(row.totalAmount))}</td>
                        <td className="px-3 py-2 text-right font-medium text-emerald-700">{formatCurrency(Number(row.amountRemain))}</td>
                        <td className="px-3 py-2 text-center">
                          <Link href={`/admin/supplier-advances/${row.id}`} className="text-xs font-medium text-[#1e3a5f] hover:underline">เปิด</Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* CN Purchase Credit */}
          <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="font-kanit text-base font-semibold text-gray-900">เครดิตคืนสินค้า (CN Purchase) คงเหลือ</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-600">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">เลขที่</th>
                    <th className="px-3 py-2 text-left font-medium">วันที่คืน</th>
                    <th className="px-3 py-2 text-left font-medium">ซัพพลายเออร์</th>
                    <th className="px-3 py-2 text-right font-medium">ยอดคืน</th>
                    <th className="px-3 py-2 text-right font-medium">คงเหลือ</th>
                    <th className="px-3 py-2 text-center font-medium">เอกสาร</th>
                  </tr>
                </thead>
                <tbody>
                  {cnCredits.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-gray-400">ไม่พบรายการ</td>
                    </tr>
                  ) : (
                    cnCredits.map((row) => (
                      <tr key={row.id} className="border-t border-gray-100">
                        <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">{row.returnNo}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(row.returnDate)}</td>
                        <td className="px-3 py-2 text-gray-800">{row.supplier?.name ?? "-"}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(Number(row.totalAmount))}</td>
                        <td className="px-3 py-2 text-right font-medium text-amber-700">{formatCurrency(Number(row.amountRemain))}</td>
                        <td className="px-3 py-2 text-center">
                          <Link href={`/admin/purchase-returns/${row.id}`} className="text-xs font-medium text-[#1e3a5f] hover:underline">เปิด</Link>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
