export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { resolveReportUnit, toReportUnitQty } from "@/lib/report-unit";
import { requirePermission } from "@/lib/require-auth";
import { formatDateThai, getThailandDateKey, parseDateOnlyToDate, startOfThailandDay } from "@/lib/th-date";
import Pagination from "@/components/shared/Pagination";
import {
  chunkLotKeys,
  classifyLotExpiry,
  groupLotKeysByProduct,
  lotKeyOf,
  pageSlice,
  type LotKey,
} from "../lot-report-query";

const LOT_PAGE_SIZE = 50;

interface PageProps {
  searchParams: Promise<{ q?: string; status?: string; ready?: string; page?: string }>;
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

  const { q = "", status = "all", ready = "", page: pageParam = "1" } = await searchParams;
  const page = Math.max(1, parseInt(pageParam, 10));
  const qTrim = q.trim();
  const shouldShowData = ready === "1";

  const balanceWhere = {
    qtyOnHand: { gt: 0 },
    ...(qTrim
      ? {
          product: {
            OR: [
              { name: { contains: qTrim, mode: "insensitive" as const } },
              { code: { contains: qTrim, mode: "insensitive" as const } },
            ],
          },
        }
      : {}),
  };
  const balanceOrderBy = [{ productId: "asc" as const }, { lotNo: "asc" as const }];
  const today = parseDateOnlyToDate(getThailandDateKey());

  // The status filter is resolved over EVERY lot with stock (narrow key/expiry
  // columns only) before paging, so it is never limited to the first N lots.
  // Only the rows of the requested page load product/unit details.
  let totalRows = 0;
  let pageKeys: LotKey[] = [];
  if (shouldShowData && status === "all") {
    // A non-numeric ?page= yields NaN; keep the old behaviour (empty page)
    // instead of passing NaN to Prisma's skip.
    [totalRows, pageKeys] = await Promise.all([
      db.lotBalance.count({ where: balanceWhere }),
      Number.isFinite(page)
        ? db.lotBalance.findMany({
            where: balanceWhere,
            select: { productId: true, lotNo: true },
            orderBy: balanceOrderBy,
            skip: (page - 1) * LOT_PAGE_SIZE,
            take: LOT_PAGE_SIZE,
          })
        : Promise.resolve([]),
    ]);
  } else if (shouldShowData) {
    const allKeys = await db.lotBalance.findMany({
      where: balanceWhere,
      select: { productId: true, lotNo: true },
      orderBy: balanceOrderBy,
    });
    const expDateByKey = new Map<string, Date | null>();
    for (const keyChunk of chunkLotKeys(allKeys)) {
      const chunkLots = await db.productLot.findMany({
        where: { OR: groupLotKeysByProduct(keyChunk) },
        select: { productId: true, lotNo: true, expDate: true },
      });
      for (const productLot of chunkLots) {
        expDateByKey.set(lotKeyOf(productLot), productLot.expDate);
      }
    }
    const matchingKeys = allKeys.filter((key) => {
      const expDate = expDateByKey.get(lotKeyOf(key)) ?? null;
      return classifyLotExpiry(expDate ? startOfThailandDay(expDate) : null, today).status === status;
    });
    totalRows = matchingKeys.length;
    pageKeys = pageSlice(matchingKeys, page, LOT_PAGE_SIZE);
  }

  const pageKeyFilters = groupLotKeysByProduct(pageKeys);
  const [pageBalances, productLots] =
    pageKeyFilters.length > 0
      ? await Promise.all([
          db.lotBalance.findMany({
            where: { OR: pageKeyFilters, qtyOnHand: { gt: 0 } },
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
          }),
          db.productLot.findMany({
            where: { OR: pageKeyFilters },
            select: { productId: true, lotNo: true, expDate: true, mfgDate: true },
          }),
        ])
      : [[], []];
  const balanceMap = new Map(pageBalances.map((balance) => [lotKeyOf(balance), balance]));
  const balances = pageKeys.flatMap((key) => {
    const balance = balanceMap.get(lotKeyOf(key));
    return balance ? [balance] : [];
  });
  const productLotMap = new Map(
    productLots.map((productLot) => [`${productLot.productId}:${productLot.lotNo}`, productLot]),
  );

  const pagedRows = balances.map((balance) => {
    const productLot = productLotMap.get(`${balance.productId}:${balance.lotNo}`);
    const expDate = productLot?.expDate ?? null;
    const mfgDate = productLot?.mfgDate ?? null;
    const { daysUntil } = classifyLotExpiry(expDate ? startOfThailandDay(expDate) : null, today);
    const reportUnit = resolveReportUnit({
      reportUnitName: balance.product.reportUnitName,
      units: balance.product.units,
    });

    return {
      ...balance,
      expDate,
      mfgDate,
      daysUntil,
      unitName: reportUnit.unitName,
      qtyOnHand: toReportUnitQty(Number(balance.qtyOnHand), reportUnit.scale),
    };
  });

  const totalPages = Math.ceil(totalRows / LOT_PAGE_SIZE);

  return (
    <div className="space-y-4">
      <form method="GET" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="ready" value="1" />
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
        {shouldShowData
          ? `พบ ${totalRows} รายการ`
          : "กรอกชื่อหรือรหัสสินค้า หรือเลือกสถานะก่อน แล้วกดกรองเพื่อแสดงข้อมูล"}
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
            {!shouldShowData && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  ยังไม่ได้แสดงข้อมูล กรุณาค้นหาหรือเลือกสถานะก่อน
                </td>
              </tr>
            )}
            {shouldShowData && totalRows === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  ไม่พบข้อมูล
                </td>
              </tr>
            )}
            {pagedRows.map((row) => (
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
                    {row.mfgDate ? formatDateThai(row.mfgDate) : "-"}
                </td>
                <td className="px-4 py-2.5">
                    {row.expDate ? formatDateThai(row.expDate) : "-"}
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

      {shouldShowData && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          basePath="/admin/lots/balance"
          searchParams={{ q, status, ready }}
        />
      )}
    </div>
  );
}
