export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { resolveReportUnit, toReportUnitQty } from "@/lib/report-unit";
import { requirePermission } from "@/lib/require-auth";

interface PageProps {
  searchParams: Promise<{ days?: string }>;
}

const DAYS_OPTIONS = [
  { value: "7", label: "7 วัน" },
  { value: "30", label: "30 วัน" },
  { value: "60", label: "60 วัน" },
  { value: "90", label: "90 วัน" },
  { value: "180", label: "180 วัน" },
  { value: "all", label: "ทั้งหมด (มีวันหมดอายุ)" },
];

function rowBg(daysUntil: number): string {
  if (daysUntil < 0) return "bg-red-50";
  if (daysUntil <= 30) return "bg-orange-50";
  if (daysUntil <= 90) return "bg-yellow-50";
  return "";
}

function badgeClass(daysUntil: number): string {
  if (daysUntil < 0) return "bg-red-100 text-red-700";
  if (daysUntil <= 30) return "bg-orange-100 text-orange-700";
  if (daysUntil <= 90) return "bg-yellow-100 text-yellow-700";
  return "bg-green-100 text-green-700";
}

function badgeLabel(daysUntil: number): string {
  if (daysUntil < 0) return `หมดอายุแล้ว ${Math.abs(daysUntil)} วัน`;
  if (daysUntil === 0) return "หมดอายุวันนี้";
  return `อีก ${daysUntil} วัน`;
}

export default async function LotExpiryPage({ searchParams }: PageProps) {
  await requirePermission("lot_reports.view");

  const { days = "30" } = await searchParams;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const thresholdDate =
    days === "all"
      ? undefined
      : (() => {
          const date = new Date(today);
          date.setDate(date.getDate() + parseInt(days, 10));
          return date;
        })();

  const productLots = await db.productLot.findMany({
    where: {
      expDate: {
        not: null,
        ...(thresholdDate ? { lte: thresholdDate } : {}),
      },
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
    orderBy: { expDate: "asc" },
    take: 300,
  });

  const keys = productLots.map((productLot) => ({
    productId: productLot.productId,
    lotNo: productLot.lotNo,
  }));
  const lotBalances =
    keys.length > 0
      ? await db.lotBalance.findMany({
          where: { OR: keys, qtyOnHand: { gt: 0 } },
          select: { productId: true, lotNo: true, qtyOnHand: true },
        })
      : [];
  const lotBalanceMap = new Map(
    lotBalances.map((lotBalance) => [
      `${lotBalance.productId}:${lotBalance.lotNo}`,
      Number(lotBalance.qtyOnHand),
    ]),
  );

  const rows = productLots
    .map((productLot) => {
      const balance = lotBalanceMap.get(`${productLot.productId}:${productLot.lotNo}`);
      if (balance == null || balance <= 0) {
        return null;
      }

      const reportUnit = resolveReportUnit({
        reportUnitName: productLot.product.reportUnitName,
        units: productLot.product.units,
      });
      const daysUntil = Math.ceil(
        (productLot.expDate!.getTime() - today.getTime()) / 86_400_000,
      );

      return {
        productLot,
        daysUntil,
        unitName: reportUnit.unitName,
        qtyOnHand: toReportUnitQty(balance, reportUnit.scale),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return (
    <div className="space-y-4">
      <form method="GET" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">แสดง lot หมดอายุภายใน</label>
          <select
            name="days"
            defaultValue={days}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {DAYS_OPTIONS.map((option) => (
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
        แสดง {rows.length} รายการที่มีสต็อกคงเหลือ
        {rows.length >= 300 ? " (จำกัด 300 รายการ)" : ""}
      </p>

      <div className="flex flex-wrap gap-3 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full bg-red-400" /> หมดอายุแล้ว
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full bg-orange-400" /> ≤ 30 วัน
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full bg-yellow-400" /> ≤ 90 วัน
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded-full bg-green-400" /> &gt; 90 วัน
        </span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">รหัสสินค้า</th>
              <th className="px-4 py-3 text-left font-medium">ชื่อสินค้า</th>
              <th className="px-4 py-3 text-left font-medium">Lot No</th>
              <th className="px-4 py-3 text-left font-medium">หน่วยนับ</th>
              <th className="px-4 py-3 text-right font-medium">คงเหลือ</th>
              <th className="px-4 py-3 text-left font-medium">วันหมดอายุ</th>
              <th className="px-4 py-3 text-center font-medium">สถานะ</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  ไม่พบ lot ที่ตรงเงื่อนไข
                </td>
              </tr>
            )}
            {rows.map(({ productLot, qtyOnHand, unitName, daysUntil }) => (
              <tr
                key={`${productLot.productId}-${productLot.lotNo}`}
                className={`transition-colors hover:brightness-95 ${rowBg(daysUntil)}`}
              >
                <td className="px-4 py-2.5 font-mono text-xs">{productLot.product.code}</td>
                <td className="px-4 py-2.5">{productLot.product.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs font-medium">{productLot.lotNo}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{unitName}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {qtyOnHand.toLocaleString("th-TH", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 4,
                  })}
                </td>
                <td className="px-4 py-2.5 tabular-nums">
                  {productLot.expDate!.toLocaleDateString("th-TH-u-ca-gregory")}
                </td>
                <td className="px-4 py-2.5 text-center">
                  <span
                    className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${badgeClass(daysUntil)}`}
                  >
                    {badgeLabel(daysUntil)}
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
