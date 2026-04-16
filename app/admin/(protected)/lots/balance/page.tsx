export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { resolveReportUnit, toReportUnitQty } from "@/lib/report-unit";
import { requirePermission } from "@/lib/require-auth";

interface PageProps {
  searchParams: Promise<{ q?: string; status?: string }>;
}

const STATUS_OPTIONS = [
  { value: "all", label: "ทั้งหมด" },
  { value: "ok", label: "ปกติ" },
  { value: "expiring", label: "ใกล้หมดอายุ (≤30 วัน)" },
  { value: "expired", label: "หมดอายุแล้ว" },
  { value: "no-exp", label: "ไม่มีวันหมดอายุ" },
];

function daysClass(days: number | null): string {
  if (days === null) return "bg-gray-100 text-gray-600";
  if (days < 0) return "bg-red-100 text-red-700";
  if (days <= 30) return "bg-orange-100 text-orange-700";
  if (days <= 90) return "bg-yellow-100 text-yellow-700";
  return "bg-green-100 text-green-700";
}

function statusLabel(days: number | null): string {
  if (days === null) return "ไม่มี EXP";
  if (days < 0) return "หมดอายุแล้ว";
  return `อีก ${days} วัน`;
}

export default async function LotBalancePage({ searchParams }: PageProps) {
  await requirePermission("lot_reports.view");

  const { q = "", status = "all" } = await searchParams;
  const qTrim = q.trim();

  const balances = await db.lotBalance.findMany({
    where: {
      qtyOnHand: { gt: 0 },
      ...(qTrim
        ? {
            product: {
              OR: [
                { name: { contains: qTrim, mode: "insensitive" } },
                { code: { contains: qTrim, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    },
    include: {
      product: {
        select: {
          name: true,
          code: true,
          reportUnitName: true,
          units: { select: { name: true, scale: true, isBase: true } },
        },
      },
    },
    orderBy: [{ productId: "asc" }, { lotNo: "asc" }],
    take: 300,
  });

  const keys = balances.map((balance) => ({ productId: balance.productId, lotNo: balance.lotNo }));
  const productLots =
    keys.length > 0
      ? await db.productLot.findMany({
          where: { OR: keys },
          select: { productId: true, lotNo: true, expDate: true, mfgDate: true },
        })
      : [];
  const productLotMap = new Map(
    productLots.map((productLot) => [`${productLot.productId}:${productLot.lotNo}`, productLot]),
  );

  const today = new Date();
  type RowStatus = "ok" | "expiring" | "expired" | "no-exp";

  const rows = balances.map((balance) => {
    const productLot = productLotMap.get(`${balance.productId}:${balance.lotNo}`);
    const expDate = productLot?.expDate ?? null;
    const mfgDate = productLot?.mfgDate ?? null;
    const daysUntil = expDate
      ? Math.ceil((expDate.getTime() - today.getTime()) / 86_400_000)
      : null;
    const rowStatus: RowStatus =
      expDate === null ? "no-exp" : daysUntil! < 0 ? "expired" : daysUntil! <= 30 ? "expiring" : "ok";
    const reportUnit = resolveReportUnit({
      reportUnitName: balance.product.reportUnitName,
      units: balance.product.units,
    });

    return {
      ...balance,
      expDate,
      mfgDate,
      daysUntil,
      rowStatus,
      unitName: reportUnit.unitName,
      qtyOnHand: toReportUnitQty(Number(balance.qtyOnHand), reportUnit.scale),
    };
  });

  const filtered =
    status === "all" ? rows : rows.filter((row) => row.rowStatus === (status as RowStatus));

  return (
    <div className="space-y-4">
      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">ค้นหาสินค้า</label>
          <input
            name="q"
            defaultValue={q}
            placeholder="รหัส / ชื่อสินค้า"
            className="h-9 w-56 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">สถานะ</label>
          <select
            name="status"
            defaultValue={status}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="h-9 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
        >
          กรอง
        </button>
      </form>

      <p className="text-sm text-muted-foreground">
        แสดง {filtered.length} รายการ {filtered.length >= 300 ? "(จำกัด 300 รายการ)" : ""}
      </p>

      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">รหัสสินค้า</th>
              <th className="px-4 py-3 text-left font-medium">ชื่อสินค้า</th>
              <th className="px-4 py-3 text-left font-medium">Lot No</th>
              <th className="px-4 py-3 text-left font-medium">หน่วยนับ</th>
              <th className="px-4 py-3 text-right font-medium">คงเหลือ</th>
              <th className="px-4 py-3 text-left font-medium">วันผลิต</th>
              <th className="px-4 py-3 text-left font-medium">วันหมดอายุ</th>
              <th className="px-4 py-3 text-center font-medium">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  ไม่พบข้อมูล
                </td>
              </tr>
            )}
            {filtered.map((row) => (
              <tr key={`${row.productId}-${row.lotNo}`} className="transition-colors hover:bg-gray-50">
                <td className="px-4 py-2.5 font-mono text-xs">{row.product.code}</td>
                <td className="px-4 py-2.5">{row.product.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs font-medium">{row.lotNo}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{row.unitName}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {row.qtyOnHand.toLocaleString("th-TH", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 4,
                  })}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {row.mfgDate ? row.mfgDate.toLocaleDateString("th-TH-u-ca-gregory") : "-"}
                </td>
                <td className="px-4 py-2.5">
                  {row.expDate ? row.expDate.toLocaleDateString("th-TH-u-ca-gregory") : "-"}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${daysClass(row.daysUntil)}`}
                  >
                    {statusLabel(row.daysUntil)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
