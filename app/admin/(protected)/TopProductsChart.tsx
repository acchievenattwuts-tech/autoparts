"use client";

export type TopProductsChartDatum = {
  name: string;
  qty: number;
  revenue: number;
};

const formatRevenue = (value: unknown) => {
  const numericValue = Number(value ?? 0);
  return numericValue.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};

const formatQuantity = (value: unknown) => Number(value ?? 0).toLocaleString("th-TH");

const TopProductsChart = ({ data }: { data: TopProductsChartDatum[] }) => {
  const maxQty = Math.max(1, ...data.map((item) => item.qty));

  return (
    <div className="rounded-2xl border border-gray-100 bg-white/95 p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/80">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-kanit font-semibold text-gray-800 dark:text-slate-100">
            สินค้าขายดี Top 10 (เดือนนี้)
          </h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
            เรียงตามจำนวนชิ้นที่ขายได้ พร้อมยอดขายรวมของสินค้าแต่ละรายการ
          </p>
        </div>
      </div>
      {data.length > 0 ? (
        <div className="space-y-3">
          {data.map((item, index) => {
            const percent = Math.max(6, Math.round((item.qty / maxQty) * 100));

            return (
              <div
                key={`${item.name}-${index}`}
                className="rounded-xl border border-gray-100 bg-gray-50/80 p-3 dark:border-white/10 dark:bg-white/[0.03]"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-xs font-semibold text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200">
                    {index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium leading-snug text-gray-900 dark:text-slate-100">
                      {item.name}
                    </p>
                    <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-gray-500 dark:text-slate-400 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                      <span>
                        ขาย{" "}
                        <span className="font-semibold text-emerald-700 dark:text-emerald-200">
                          {formatQuantity(item.qty)} ชิ้น
                        </span>
                      </span>
                      <span>
                        ยอดขาย{" "}
                        <span className="font-semibold text-gray-900 dark:text-slate-100">
                          ฿{formatRevenue(item.revenue)}
                        </span>
                      </span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full bg-emerald-500 dark:bg-emerald-400"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex h-[320px] items-center justify-center rounded-xl border border-dashed border-gray-200 text-sm text-gray-500 dark:border-white/10 dark:text-slate-400">
          ยังไม่มีข้อมูลสินค้าขายดีของเดือนนี้
        </div>
      )}
    </div>
  );
};

export default TopProductsChart;
