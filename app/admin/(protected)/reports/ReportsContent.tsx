import type { ReportsData } from "@/lib/reports";

type ReportsContentProps = {
  data: ReportsData;
  compact?: boolean;
};

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
              <th className="px-4 py-2 text-right font-medium text-gray-600">เอกสาร</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">ยอดขาย</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">ยอดคืน</th>
              <th className="px-4 py-2 text-right font-medium text-gray-600">Net sale</th>
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
                  <td className="px-4 py-2 text-right text-gray-600">{row.documentCount}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{formatCurrency(row.grossSalesAmount)}</td>
                  <td className="px-4 py-2 text-right text-red-600">{formatCurrency(row.returnAmount)}</td>
                  <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(row.netSaleAmount)}</td>
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
  const filterEntries = [
    ["ลูกค้า", data.filters.customerCodeFrom || data.filters.customerCodeTo ? `${data.filters.customerCodeFrom || "-"} ถึง ${data.filters.customerCodeTo || "-"}` : ""],
    ["ซัพพลายเออร์", data.filters.supplierCodeFrom || data.filters.supplierCodeTo ? `${data.filters.supplierCodeFrom || "-"} ถึง ${data.filters.supplierCodeTo || "-"}` : ""],
    ["รหัสสินค้า", data.filters.productCodeFrom || data.filters.productCodeTo ? `${data.filters.productCodeFrom || "-"} ถึง ${data.filters.productCodeTo || "-"}` : ""],
    ["รหัสค่าใช้จ่าย", data.filters.expenseCodeFrom || data.filters.expenseCodeTo ? `${data.filters.expenseCodeFrom || "-"} ถึง ${data.filters.expenseCodeTo || "-"}` : ""],
  ].filter(([, value]) => value);

  return (
    <div className={compact ? "space-y-4" : "space-y-6"}>
      {filterEntries.length > 0 && (
        <section className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
          <p className="mb-2 text-sm font-medium text-gray-600">ตัวกรองที่ใช้งาน</p>
          <div className="flex flex-wrap gap-2 text-xs">
            {filterEntries.map(([label, value]) => (
              <span key={label} className="rounded-full bg-white px-3 py-1 text-gray-600 shadow-sm">
                {label}: {value}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">ยอดขายรวม</p>
            <p className="mt-1 font-kanit text-2xl font-bold text-gray-900">฿{formatCurrency(data.salesSummary.grossSalesAmount)}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">ยอดคืนขาย</p>
            <p className="mt-1 font-kanit text-2xl font-bold text-red-600">฿{formatCurrency(data.salesSummary.returnAmount)}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">Net sale</p>
            <p className="mt-1 font-kanit text-2xl font-bold text-[#1e3a5f]">฿{formatCurrency(data.salesSummary.netSaleAmount)}</p>
          </div>
          <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">กำไรสุทธิ</p>
            <p className={`mt-1 font-kanit text-2xl font-bold ${data.profitLoss.netProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              ฿{formatCurrency(data.profitLoss.netProfit)}
            </p>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <SummaryTable title="ขายรายวัน" rows={data.salesSummary.byDay} />
          <SummaryTable title="ขายรายสัปดาห์" rows={data.salesSummary.byWeek} />
          <SummaryTable title="ขายรายเดือน" rows={data.salesSummary.byMonth} />
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
              ["ยอดคืนขาย", -data.profitLoss.salesReturns],
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
              ["VAT คืนขาย", -data.profitLoss.creditNoteVat],
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
            <h3 className="font-kanit text-lg font-semibold text-gray-900">รายงานรับเงินประจำวัน</h3>
          </div>
          <div className="grid gap-3 border-b border-gray-100 p-4 md:grid-cols-3">
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">รวมรับเงิน</p><p className="font-kanit text-xl font-bold text-[#1e3a5f]">฿{formatCurrency(data.dailyReceipts.totalAmount)}</p></div>
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">ขายสด</p><p className="font-kanit text-xl font-bold text-gray-900">฿{formatCurrency(data.dailyReceipts.cashSaleAmount)}</p></div>
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">ใบเสร็จรับเงิน</p><p className="font-kanit text-xl font-bold text-emerald-600">฿{formatCurrency(data.dailyReceipts.receiptAmount)}</p></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">เอกสาร</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">ลูกค้า</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">ชำระ</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody>
                {data.dailyReceipts.items.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">ไม่มีข้อมูลรับเงิน</td></tr> : data.dailyReceipts.items.slice(0, compact ? 15 : 30).map((item) => (
                  <tr key={`${item.source}-${item.docNo}`} className="border-t border-gray-50">
                    <td className="px-4 py-2"><p className="font-mono text-xs text-[#1e3a5f]">{item.docNo}</p><p className="text-xs text-gray-400">{item.source === "SALE" ? "ขายสด" : "ใบเสร็จ"} | {formatDate(item.docDate)}</p></td>
                    <td className="px-4 py-2"><p className="text-gray-800">{item.customerName}</p><p className="text-xs text-gray-400">{item.customerCode || "-"}</p></td>
                    <td className="px-4 py-2 text-gray-600">{item.paymentMethod}</td>
                    <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="font-kanit text-lg font-semibold text-gray-900">รายงานจ่ายเงินประจำวัน</h3>
          </div>
          <div className="grid gap-3 border-b border-gray-100 p-4 md:grid-cols-3">
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">รวมจ่ายเงิน</p><p className="font-kanit text-xl font-bold text-[#1e3a5f]">฿{formatCurrency(data.dailyPayments.totalAmount)}</p></div>
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">ซื้อสินค้า</p><p className="font-kanit text-xl font-bold text-gray-900">฿{formatCurrency(data.dailyPayments.purchaseAmount)}</p></div>
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">ค่าใช้จ่าย</p><p className="font-kanit text-xl font-bold text-red-600">฿{formatCurrency(data.dailyPayments.expenseAmount)}</p></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">เอกสาร</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">คู่ค้า/รายละเอียด</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">ชำระ</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">จำนวนเงิน</th>
                </tr>
              </thead>
              <tbody>
                {data.dailyPayments.items.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">ไม่มีข้อมูลจ่ายเงิน</td></tr> : data.dailyPayments.items.slice(0, compact ? 15 : 30).map((item) => (
                  <tr key={`${item.source}-${item.docNo}`} className="border-t border-gray-50">
                    <td className="px-4 py-2"><p className="font-mono text-xs text-[#1e3a5f]">{item.docNo}</p><p className="text-xs text-gray-400">{item.source === "PURCHASE" ? "ซื้อสินค้า" : "ค่าใช้จ่าย"} | {formatDate(item.docDate)}</p></td>
                    <td className="px-4 py-2"><p className="text-gray-800">{item.counterpartName}</p><p className="text-xs text-gray-400">{item.counterpartCode || "-"}</p></td>
                    <td className="px-4 py-2 text-gray-600">{item.paymentMethod}</td>
                    <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="font-kanit text-lg font-semibold text-gray-900">รายงานค่าใช้จ่าย</h3>
          </div>
          <div className="grid gap-3 border-b border-gray-100 p-4 md:grid-cols-3">
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">ยอดรวม</p><p className="font-kanit text-xl font-bold text-gray-900">฿{formatCurrency(data.expenses.totalAmount)}</p></div>
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">VAT</p><p className="font-kanit text-xl font-bold text-amber-600">฿{formatCurrency(data.expenses.totalVatAmount)}</p></div>
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">ยอดสุทธิ</p><p className="font-kanit text-xl font-bold text-[#1e3a5f]">฿{formatCurrency(data.expenses.totalNetAmount)}</p></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">รหัส</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">รายการ</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">สุทธิ</th>
                </tr>
              </thead>
              <tbody>
                {data.expenses.items.length === 0 ? <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-400">ไม่มีข้อมูลค่าใช้จ่าย</td></tr> : data.expenses.items.slice(0, compact ? 15 : 30).map((item) => (
                  <tr key={item.expenseCode} className="border-t border-gray-50">
                    <td className="px-4 py-2 font-mono text-xs text-[#1e3a5f]">{item.expenseCode}</td>
                    <td className="px-4 py-2 text-gray-800">{item.expenseName}<p className="text-xs text-gray-400">{item.documentCount} รายการ</p></td>
                    <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(item.netAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3">
            <h3 className="font-kanit text-lg font-semibold text-gray-900">ลูกหนี้ค้างชำระ</h3>
          </div>
          <div className="grid gap-3 border-b border-gray-100 p-4 md:grid-cols-3">
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">รวม</p><p className="font-kanit text-xl font-bold text-[#1e3a5f]">฿{formatCurrency(data.receivables.totalOutstanding)}</p></div>
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">ลูกหนี้ทั่วไป</p><p className="font-kanit text-xl font-bold text-gray-900">฿{formatCurrency(data.receivables.regularOutstanding)}</p></div>
            <div className="rounded-lg bg-gray-50 p-3"><p className="text-xs text-gray-500">COD ค้างรับ</p><p className="font-kanit text-xl font-bold text-amber-600">฿{formatCurrency(data.receivables.codPendingOutstanding)}</p></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">เลขที่ขาย</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-600">ลูกค้า</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">ยอดค้าง</th>
                  <th className="px-4 py-2 text-right font-medium text-gray-600">อายุหนี้</th>
                </tr>
              </thead>
              <tbody>
                {data.receivables.items.length === 0 ? <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">ไม่มีลูกหนี้ค้างชำระ</td></tr> : data.receivables.items.slice(0, compact ? 15 : 30).map((item) => (
                  <tr key={item.id} className="border-t border-gray-50">
                    <td className="px-4 py-2"><p className="font-mono text-xs text-[#1e3a5f]">{item.saleNo}</p><p className="text-xs text-gray-400">{formatDate(item.saleDate)}</p></td>
                    <td className="px-4 py-2"><p className="text-gray-800">{item.customerName}</p><p className="text-xs text-gray-400">{item.customerCode || item.bucketLabel}</p></td>
                    <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(item.amountRemain)}</td>
                    <td className="px-4 py-2 text-right text-gray-600">{item.ageDays} วัน</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3"><h3 className="font-kanit text-lg font-semibold text-gray-900">สรุปซื้อแยกซัพพลายเออร์</h3></div>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50"><tr><th className="px-4 py-2 text-left font-medium text-gray-600">ซัพพลายเออร์</th><th className="px-4 py-2 text-right font-medium text-gray-600">ซื้อสุทธิ</th></tr></thead><tbody>{data.suppliers.items.length === 0 ? <tr><td colSpan={2} className="px-4 py-6 text-center text-sm text-gray-400">ไม่มีข้อมูลซื้อ</td></tr> : data.suppliers.items.slice(0, compact ? 15 : 30).map((item) => <tr key={item.supplierKey} className="border-t border-gray-50"><td className="px-4 py-2"><p className="text-gray-800">{item.supplierName}</p><p className="text-xs text-gray-400">{item.supplierCode || "-"} | ซื้อ {formatCurrency(item.purchaseAmount)} | คืน {formatCurrency(item.returnAmount)}</p></td><td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(item.netPurchaseAmount)}</td></tr>)}</tbody></table></div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3"><h3 className="font-kanit text-lg font-semibold text-gray-900">สรุปขายแยกลูกค้า</h3></div>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50"><tr><th className="px-4 py-2 text-left font-medium text-gray-600">ลูกค้า</th><th className="px-4 py-2 text-right font-medium text-gray-600">Net sale</th></tr></thead><tbody>{data.customers.items.length === 0 ? <tr><td colSpan={2} className="px-4 py-6 text-center text-sm text-gray-400">ไม่มีข้อมูลขาย</td></tr> : data.customers.items.slice(0, compact ? 15 : 30).map((item) => <tr key={item.customerKey} className="border-t border-gray-50"><td className="px-4 py-2"><p className="text-gray-800">{item.customerName}</p><p className="text-xs text-gray-400">{item.customerCode || "-"} | ค้าง {formatCurrency(item.outstandingAmount)}</p></td><td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(item.netSalesAmount)}</td></tr>)}</tbody></table></div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3"><h3 className="font-kanit text-lg font-semibold text-gray-900">สต็อกคงเหลือและสินค้าใกล้ minStock</h3></div>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50"><tr><th className="px-4 py-2 text-left font-medium text-gray-600">รหัส</th><th className="px-4 py-2 text-left font-medium text-gray-600">สินค้า</th><th className="px-4 py-2 text-right font-medium text-gray-600">คงเหลือ</th></tr></thead><tbody>{data.stock.lowStockItems.length === 0 ? <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-400">ไม่มีสินค้าใกล้ minStock</td></tr> : data.stock.lowStockItems.slice(0, compact ? 15 : 30).map((item) => <tr key={item.id} className="border-t border-gray-50"><td className="px-4 py-2 font-mono text-xs text-[#1e3a5f]">{item.code}</td><td className="px-4 py-2 text-gray-800">{item.name}<p className="text-xs text-gray-400">{item.categoryName}</p></td><td className="px-4 py-2 text-right font-medium text-amber-700">{item.stock}</td></tr>)}</tbody></table></div>
        </div>

        <div className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3"><h3 className="font-kanit text-lg font-semibold text-gray-900">ประกันใกล้หมด</h3></div>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50"><tr><th className="px-4 py-2 text-left font-medium text-gray-600">ใบขาย</th><th className="px-4 py-2 text-left font-medium text-gray-600">สินค้า</th><th className="px-4 py-2 text-right font-medium text-gray-600">คงเหลือ</th></tr></thead><tbody>{data.warranties.expiringItems.length === 0 ? <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-400">ไม่มีรายการประกัน</td></tr> : data.warranties.expiringItems.slice(0, compact ? 15 : 30).map((item) => <tr key={item.id} className="border-t border-gray-50"><td className="px-4 py-2"><p className="font-mono text-xs text-[#1e3a5f]">{item.saleNo}</p><p className="text-xs text-gray-400">{item.customerName}</p></td><td className="px-4 py-2 text-gray-800">{item.productName}<p className="text-xs text-gray-400">{item.productCode}</p></td><td className={`px-4 py-2 text-right font-medium ${item.daysLeft < 0 ? "text-red-600" : "text-amber-700"}`}>{item.daysLeft < 0 ? `หมดแล้ว ${Math.abs(item.daysLeft)} วัน` : `${item.daysLeft} วัน`}</td></tr>)}</tbody></table></div>
        </div>
      </section>

      {!compact && (
        <section className="rounded-xl border border-gray-100 bg-white shadow-sm">
          <div className="border-b border-gray-100 px-4 py-3"><h3 className="font-kanit text-lg font-semibold text-gray-900">สินค้ามูลค่าสต็อกสูงสุด</h3></div>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-gray-50"><tr><th className="px-4 py-2 text-left font-medium text-gray-600">รหัส</th><th className="px-4 py-2 text-left font-medium text-gray-600">สินค้า</th><th className="px-4 py-2 text-right font-medium text-gray-600">มูลค่า</th></tr></thead><tbody>{data.stock.highestValueItems.map((item) => <tr key={item.id} className="border-t border-gray-50"><td className="px-4 py-2 font-mono text-xs text-[#1e3a5f]">{item.code}</td><td className="px-4 py-2 text-gray-800">{item.name}<p className="text-xs text-gray-400">{item.categoryName} | คงเหลือ {item.stock}</p></td><td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(item.stockValue)}</td></tr>)}</tbody></table></div>
        </section>
      )}
    </div>
  );
};

export default ReportsContent;
