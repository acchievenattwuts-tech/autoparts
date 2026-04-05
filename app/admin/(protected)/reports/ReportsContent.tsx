import type { ReportsData } from "@/lib/reports";

type ReportsContentProps = {
  data: ReportsData;
  compact?: boolean;
};

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: Date): string {
  return value.toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function SummaryTable({
  title,
  rows,
}: {
  title: string;
  rows: ReportsData["salesSummary"]["byDay"];
}) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="font-kanit text-lg font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-600">ช่วงเวลา</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">จำนวนบิล</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">ยอดสุทธิ</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">ก่อน VAT</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">VAT</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">
                  ไม่มีข้อมูลในช่วงที่เลือก
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.label} className="border-t border-gray-50">
                  <td className="px-4 py-2 text-gray-700">{row.label}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{row.invoiceCount}</td>
                  <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(row.netAmount)}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{formatCurrency(row.subtotalAmount)}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{formatCurrency(row.vatAmount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ReportsContent = ({ data, compact = false }: ReportsContentProps) => {
  const sectionGap = compact ? "space-y-4" : "space-y-6";

  return (
    <div className={sectionGap}>
      <section className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">ยอดขายสุทธิ</p>
            <p className="mt-1 font-kanit text-2xl font-bold text-[#1e3a5f]">
              ฿{formatCurrency(data.salesSummary.totalNetAmount)}
            </p>
            <p className="text-xs text-gray-400">
              {data.range.from} ถึง {data.range.to}
            </p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">จำนวนบิลขาย</p>
            <p className="mt-1 font-kanit text-2xl font-bold text-gray-900">
              {data.salesSummary.totalInvoices.toLocaleString("th-TH")}
            </p>
            <p className="text-xs text-gray-400">เฉพาะเอกสาร ACTIVE</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">กำไรสุทธิ</p>
            <p className={`mt-1 font-kanit text-2xl font-bold ${data.profitLoss.netProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              ฿{formatCurrency(data.profitLoss.netProfit)}
            </p>
            <p className="text-xs text-gray-400">หลังหักค่าใช้จ่ายแล้ว</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">สินค้าใกล้ minStock</p>
            <p className="mt-1 font-kanit text-2xl font-bold text-amber-600">
              {data.stock.lowStockCount.toLocaleString("th-TH")}
            </p>
            <p className="text-xs text-gray-400">รายการที่ต้องติดตาม</p>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <SummaryTable title="ยอดขายรายวัน" rows={data.salesSummary.byDay} />
          <SummaryTable title="ยอดขายรายสัปดาห์" rows={data.salesSummary.byWeek} />
          <SummaryTable title="ยอดขายรายเดือน" rows={data.salesSummary.byMonth} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="font-kanit text-lg font-semibold text-gray-900">กำไรขาดทุน</h3>
          </div>
          <div className="space-y-2 p-4 text-sm">
            {[
              ["ยอดขายรวม", data.profitLoss.grossSales],
              ["หัก Credit Note", -data.profitLoss.salesReturns],
              ["รายได้สุทธิ", data.profitLoss.netRevenue],
              ["ต้นทุนขาย", -data.profitLoss.costOfGoodsSold],
              ["กำไรขั้นต้น", data.profitLoss.grossProfit],
              ["ค่าใช้จ่าย", -data.profitLoss.expenseTotal],
              ["กำไรสุทธิ", data.profitLoss.netProfit],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                <span className="text-gray-600">{label}</span>
                <span className={`font-medium ${Number(value) >= 0 ? "text-gray-900" : "text-red-600"}`}>
                  {Number(value) < 0 ? "-" : ""}฿{formatCurrency(Math.abs(Number(value)))}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="font-kanit text-lg font-semibold text-gray-900">VAT Breakdown</h3>
          </div>
          <div className="space-y-2 p-4 text-sm">
            {[
              ["VAT ขาย", data.profitLoss.salesVat],
              ["VAT จาก Credit Note", -data.profitLoss.creditNoteVat],
              ["VAT ซื้อ", -data.profitLoss.purchaseVat],
              ["VAT ค่าใช้จ่าย", -data.profitLoss.expenseVat],
              ["VAT สุทธิคงชำระ", data.profitLoss.vatPayable],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                <span className="text-gray-600">{label}</span>
                <span className={`font-medium ${Number(value) >= 0 ? "text-gray-900" : "text-red-600"}`}>
                  {Number(value) < 0 ? "-" : ""}฿{formatCurrency(Math.abs(Number(value)))}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="font-kanit text-lg font-semibold text-gray-900">สต็อกคงเหลือและสินค้าใกล้ minStock</h3>
          </div>
          <div className="grid gap-3 border-b border-gray-100 p-4 md:grid-cols-3">
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">สินค้า Active</p>
              <p className="font-kanit text-xl font-bold text-gray-900">{data.stock.activeProductCount.toLocaleString("th-TH")}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">หน่วยคงเหลือรวม</p>
              <p className="font-kanit text-xl font-bold text-gray-900">{data.stock.totalUnitsOnHand.toLocaleString("th-TH")}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">มูลค่าสต็อกโดยประมาณ</p>
              <p className="font-kanit text-xl font-bold text-[#1e3a5f]">฿{formatCurrency(data.stock.totalStockValue)}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">รหัส</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">สินค้า</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">คงเหลือ</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">ขั้นต่ำ</th>
                </tr>
              </thead>
              <tbody>
                {data.stock.lowStockItems.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">
                      ไม่มีสินค้าที่ต่ำกว่า minStock
                    </td>
                  </tr>
                ) : (
                  data.stock.lowStockItems.slice(0, compact ? 20 : 40).map((item) => (
                    <tr key={item.id} className="border-t border-gray-50">
                      <td className="px-4 py-2 font-mono text-xs text-[#1e3a5f]">{item.code}</td>
                      <td className="px-4 py-2">
                        <p className="text-gray-800">{item.name}</p>
                        <p className="text-xs text-gray-400">{item.categoryName}</p>
                      </td>
                      <td className="px-4 py-2 text-right font-medium text-amber-700">{item.stock}</td>
                      <td className="px-4 py-2 text-right text-gray-600">{item.minStock}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="font-kanit text-lg font-semibold text-gray-900">ประกันใกล้หมด</h3>
          </div>
          <div className="grid gap-3 border-b border-gray-100 p-4 md:grid-cols-2">
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">ใกล้หมดใน 30 วัน</p>
              <p className="font-kanit text-xl font-bold text-amber-600">{data.warranties.expiringSoonCount.toLocaleString("th-TH")}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">หมดประกันแล้ว</p>
              <p className="font-kanit text-xl font-bold text-red-600">{data.warranties.expiredCount.toLocaleString("th-TH")}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">ใบขาย</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">ลูกค้า</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">สินค้า</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">วันหมดประกัน</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">คงเหลือ</th>
                </tr>
              </thead>
              <tbody>
                {data.warranties.expiringItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">
                      ไม่มีรายการประกันใกล้หมด
                    </td>
                  </tr>
                ) : (
                  data.warranties.expiringItems.slice(0, compact ? 20 : 40).map((item) => (
                    <tr key={item.id} className="border-t border-gray-50">
                      <td className="px-4 py-2 font-mono text-xs text-[#1e3a5f]">{item.saleNo}</td>
                      <td className="px-4 py-2 text-gray-600">{item.customerName}</td>
                      <td className="px-4 py-2">
                        <p className="text-gray-800">{item.productName}</p>
                        <p className="text-xs text-gray-400">[{item.productCode}]</p>
                      </td>
                      <td className="px-4 py-2 text-gray-600">{formatDate(item.endDate)}</td>
                      <td className={`px-4 py-2 text-right font-medium ${item.daysLeft < 0 ? "text-red-600" : "text-amber-700"}`}>
                        {item.daysLeft < 0 ? `หมดแล้ว ${Math.abs(item.daysLeft)} วัน` : `${item.daysLeft} วัน`}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {!compact && (
        <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="font-kanit text-lg font-semibold text-gray-900">สินค้ามูลค่าสต็อกสูงสุด</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">รหัส</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">สินค้า</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">คงเหลือ</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">ต้นทุนเฉลี่ย</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">มูลค่า</th>
                </tr>
              </thead>
              <tbody>
                {data.stock.highestValueItems.map((item) => (
                  <tr key={item.id} className="border-t border-gray-50">
                    <td className="px-4 py-2 font-mono text-xs text-[#1e3a5f]">{item.code}</td>
                    <td className="px-4 py-2">
                      <p className="text-gray-800">{item.name}</p>
                      <p className="text-xs text-gray-400">{item.categoryName}</p>
                    </td>
                    <td className="px-4 py-2 text-right text-gray-600">{item.stock}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{formatCurrency(item.avgCost)}</td>
                    <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(item.stockValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
};

export default ReportsContent;
