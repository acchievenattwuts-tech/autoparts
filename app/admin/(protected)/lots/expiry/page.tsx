export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { resolveReportUnit, toReportUnitQty } from "@/lib/report-unit";
import { requirePermission } from "@/lib/require-auth";
import { addThailandDays, getThailandDateKey, parseDateOnlyToDate, formatDateThai } from "@/lib/th-date";
import Pagination from "@/components/shared/Pagination";
import {
  chunkLotKeys,
  compareLotsByExpiry,
  groupLotKeysByProduct,
  lotKeyOf,
  pageSlice,
} from "../lot-report-query";

const LOT_PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{ days?: string; page?: string }>;
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

  const { days = "30", page: pageParam = "1" } = await searchParams;
  const page = Math.max(1, parseInt(pageParam, 10));

  const today = parseDateOnlyToDate(getThailandDateKey());

  const thresholdDate =
    days === "all"
      ? undefined
      : (() => {
          return addThailandDays(today, parseInt(days, 10));
        })();

  // Start from lots that still have stock, THEN look up their expiry. Filtering
  // ProductLot first (with a row cap) let sold-out lots — which are never
  // deleted — use up the cap and silently hide lots that still have stock.
  const lotBalances = await db.lotBalance.findMany({
    where: { qtyOnHand: { gt: 0 } },
    select: { productId: true, lotNo: true, qtyOnHand: true },
  });
  const lotBalanceMap = new Map(
    lotBalances.map((lotBalance) => [lotKeyOf(lotBalance), Number(lotBalance.qtyOnHand)]),
  );

  const matchedLots: { productId: string; lotNo: string; expDate: Date }[] = [];
  for (const keyChunk of chunkLotKeys(lotBalances)) {
    const chunkLots = await db.productLot.findMany({
      where: {
        OR: groupLotKeysByProduct(keyChunk),
        expDate: {
          not: null,
          ...(thresholdDate ? { lte: thresholdDate } : {}),
        },
      },
      select: { productId: true, lotNo: true, expDate: true },
    });
    for (const productLot of chunkLots) {
      if (productLot.expDate) {
        matchedLots.push({ productId: productLot.productId, lotNo: productLot.lotNo, expDate: productLot.expDate });
      }
    }
  }
  matchedLots.sort(compareLotsByExpiry);

  const totalRows = matchedLots.length;
  const totalPages = Math.ceil(totalRows / LOT_PAGE_SIZE);
  const pagedLots = pageSlice(matchedLots, page, LOT_PAGE_SIZE);

  const pageProductIds = [...new Set(pagedLots.map((lot) => lot.productId))];
  const pageProducts =
    pageProductIds.length > 0
      ? await db.product.findMany({
          where: { id: { in: pageProductIds } },
          select: {
            id: true,
            name: true,
            code: true,
            reportUnitName: true,
            units: { select: { name: true, scale: true, isBase: true } },
          },
        })
      : [];
  const productMap = new Map(pageProducts.map((product) => [product.id, product]));

  const pagedRows = pagedLots.flatMap((lot) => {
    const product = productMap.get(lot.productId);
    const balance = lotBalanceMap.get(lotKeyOf(lot));
    if (!product || balance == null || balance <= 0) {
      return [];
    }

    const reportUnit = resolveReportUnit({
      reportUnitName: product.reportUnitName,
      units: product.units,
    });
    const daysUntil = Math.ceil((lot.expDate.getTime() - today.getTime()) / 86_400_000);

    return [
      {
        productLot: { ...lot, product },
        daysUntil,
        unitName: reportUnit.unitName,
        qtyOnHand: toReportUnitQty(balance, reportUnit.scale),
      },
    ];
  });

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
        พบ {totalRows} รายการที่มีสต็อกคงเหลือ
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
            {totalRows === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  ไม่พบ lot ที่ตรงเงื่อนไข
                </td>
              </tr>
            )}
            {pagedRows.map(({ productLot, qtyOnHand, unitName, daysUntil }) => (
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
                    {formatDateThai(productLot.expDate)}
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

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        basePath="/admin/lots/expiry"
        searchParams={{ days }}
      />
    </div>
  );
}
