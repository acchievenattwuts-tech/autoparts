export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";

interface PageProps {
  searchParams: Promise<{ days?: string }>;
}

const DAYS_OPTIONS = [
  { value: "30",  label: "30 วัน" },
  { value: "60",  label: "60 วัน" },
  { value: "90",  label: "90 วัน" },
  { value: "180", label: "180 วัน" },
  { value: "365", label: "1 ปี" },
];

export default async function SlowMovingPage({ searchParams }: PageProps) {
  await requirePermission("lot_reports.view");

  const { days = "90" } = await searchParams;
  const dayNum = parseInt(days, 10) || 90;

  const today = new Date();
  const threshold = new Date(today);
  threshold.setDate(threshold.getDate() - dayNum);

  // 1. Get all lots with qtyOnHand > 0
  const balances = await db.lotBalance.findMany({
    where: { qtyOnHand: { gt: 0 } },
    include: {
      product: { select: { name: true, code: true, saleUnitName: true } },
    },
    orderBy: [{ productId: "asc" }, { lotNo: "asc" }],
    take: 500,
  });

  if (balances.length === 0) {
    return (
      <div className="space-y-4">
        <FilterBar days={days} />
        <p className="text-sm text-muted-foreground">ไม่มีสต็อกคงเหลือในระบบ</p>
      </div>
    );
  }

  // 2. Get latest sale date per (productId, lotNo) via SaleItemLot → SaleItem → Sale
  const lotNos = [...new Set(balances.map((b) => b.lotNo))];
  const saleLots = await db.saleItemLot.findMany({
    where: {
      lotNo: { in: lotNos },
      saleItem: { sale: { status: { not: "CANCELLED" } } },
    },
    select: {
      lotNo: true,
      saleItem: {
        select: {
          productId: true,
          sale: { select: { saleDate: true } },
        },
      },
    },
  });

  // Build map: `productId:lotNo` → latest saleDate
  const lastSaleMap = new Map<string, Date>();
  for (const row of saleLots) {
    const key = `${row.saleItem.productId}:${row.lotNo}`;
    const saleDate = row.saleItem.sale.saleDate;
    const existing = lastSaleMap.get(key);
    if (!existing || saleDate > existing) {
      lastSaleMap.set(key, saleDate);
    }
  }

  // 3. Get expiry dates from ProductLot
  const keys = balances.map((b) => ({ productId: b.productId, lotNo: b.lotNo }));
  const productLots =
    keys.length > 0
      ? await db.productLot.findMany({
          where: { OR: keys },
          select: { productId: true, lotNo: true, expDate: true },
        })
      : [];
  const plMap = new Map(productLots.map((pl) => [`${pl.productId}:${pl.lotNo}`, pl]));

  // 4. Build slow-moving rows
  const rows = balances
    .map((b) => {
      const key = `${b.productId}:${b.lotNo}`;
      const lastSale = lastSaleMap.get(key) ?? null;
      const daysSince = lastSale
        ? Math.floor((today.getTime() - lastSale.getTime()) / 86_400_000)
        : null; // null = never sold
      const pl = plMap.get(key);
      return { ...b, lastSale, daysSince, expDate: pl?.expDate ?? null };
    })
    .filter((r) => r.daysSince === null || r.daysSince > dayNum)
    .sort((a, b) => {
      // never sold first, then longest stagnant
      if (a.daysSince === null && b.daysSince === null) return 0;
      if (a.daysSince === null) return -1;
      if (b.daysSince === null) return 1;
      return b.daysSince - a.daysSince;
    });

  return (
    <div className="space-y-4">
      <FilterBar days={days} />

      <p className="text-sm text-muted-foreground">
        Lot ที่ไม่มีความเคลื่อนไหว (ขายออก) เกิน {dayNum} วัน:{" "}
        <span className="font-semibold text-foreground">{rows.length} รายการ</span>
      </p>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">รหัสสินค้า</th>
              <th className="px-4 py-3 text-left font-medium">ชื่อสินค้า</th>
              <th className="px-4 py-3 text-left font-medium">Lot No</th>
              <th className="px-4 py-3 text-right font-medium">คงเหลือ</th>
              <th className="px-4 py-3 text-left font-medium">หน่วย</th>
              <th className="px-4 py-3 text-left font-medium">วันหมดอายุ</th>
              <th className="px-4 py-3 text-left font-medium">ขายล่าสุด</th>
              <th className="px-4 py-3 text-right font-medium">หยุดนิ่ง (วัน)</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  ไม่พบ Lot ที่ตรงเงื่อนไข
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const isNeverSold = row.daysSince === null;
              const isLong = (row.daysSince ?? 9999) > 180;
              return (
                <tr
                  key={`${row.productId}-${row.lotNo}`}
                  className={`hover:bg-muted/30 ${isNeverSold || isLong ? "bg-amber-50" : ""}`}
                >
                  <td className="px-4 py-2.5 font-mono text-xs">{row.product.code}</td>
                  <td className="px-4 py-2.5">{row.product.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs font-medium">{row.lotNo}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {Number(row.qtyOnHand).toLocaleString("th-TH", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 4,
                    })}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{row.product.saleUnitName}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {row.expDate
                      ? row.expDate.toLocaleDateString("th-TH-u-ca-gregory")
                      : "-"}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {row.lastSale
                      ? row.lastSale.toLocaleDateString("th-TH-u-ca-gregory")
                      : "-"}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {isNeverSold ? (
                      <span className="text-xs font-medium text-amber-700">ไม่เคยขาย</span>
                    ) : (
                      <span className={isLong ? "font-semibold text-red-600" : ""}>
                        {row.daysSince}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilterBar({ days }: { days: string }) {
  return (
    <form method="GET" className="flex flex-wrap gap-3 items-end">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          ไม่มีความเคลื่อนไหวเกิน
        </label>
        <select
          name="days"
          defaultValue={days}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          {DAYS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
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
  );
}
