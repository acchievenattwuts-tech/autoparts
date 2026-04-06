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

function getReceiptSourceLabel(source: "SALE" | "RECEIPT"): string {
  return source === "SALE" ? "ขายสด" : "รับชำระ";
}

function getPaymentSourceLabel(source: "PURCHASE" | "EXPENSE" | "CN_SALE"): string {
  switch (source) {
    case "PURCHASE":
      return "ซื้อสินค้า";
    case "EXPENSE":
      return "ค่าใช้จ่าย";
    case "CN_SALE":
      return "คืนเงิน CN";
    default:
      return source;
  }
}

function SectionHeader({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#1e3a5f]/70">{eyebrow}</p>
      <h2 className="font-kanit text-2xl font-semibold text-gray-900">{title}</h2>
      <p className="text-sm text-gray-500">{subtitle}</p>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  accent = "text-[#1e3a5f]",
  hint,
}: {
  label: string;
  value: string;
  accent?: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`mt-1 font-kanit text-2xl font-bold ${accent}`}>{value}</p>
      <p className="mt-2 text-xs text-gray-400">{hint}</p>
    </div>
  );
}

function TableCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 py-3">
        <h3 className="font-kanit text-lg font-semibold text-gray-900">{title}</h3>
        <p className="text-xs text-gray-500">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

function FilterSummary({ data }: { data: ReportsData }) {
  const filterEntries = [
    [
      "ลูกค้า",
      data.filters.customerCodeFrom || data.filters.customerCodeTo
        ? `${data.filters.customerCodeFrom || "-"} ถึง ${data.filters.customerCodeTo || "-"}`
        : "",
    ],
    [
      "ซัพพลายเออร์",
      data.filters.supplierCodeFrom || data.filters.supplierCodeTo
        ? `${data.filters.supplierCodeFrom || "-"} ถึง ${data.filters.supplierCodeTo || "-"}`
        : "",
    ],
    [
      "รหัสสินค้า",
      data.filters.productCodeFrom || data.filters.productCodeTo
        ? `${data.filters.productCodeFrom || "-"} ถึง ${data.filters.productCodeTo || "-"}`
        : "",
    ],
    [
      "รหัสค่าใช้จ่าย",
      data.filters.expenseCodeFrom || data.filters.expenseCodeTo
        ? `${data.filters.expenseCodeFrom || "-"} ถึง ${data.filters.expenseCodeTo || "-"}`
        : "",
    ],
  ].filter(([, value]) => value);

  if (filterEntries.length === 0) return null;

  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4">
      <p className="mb-2 text-sm font-medium text-gray-600">เงื่อนไขรายงาน</p>
      <div className="flex flex-wrap gap-2 text-xs">
        {filterEntries.map(([label, value]) => (
          <span key={label} className="rounded-full bg-white px-3 py-1 text-gray-600 shadow-sm">
            {label}: {value}
          </span>
        ))}
      </div>
    </div>
  );
}

const ReportsContent = ({ data, compact = false }: ReportsContentProps) => {
  const maxRows = compact ? 12 : 24;

  return (
    <div className={compact ? "space-y-5" : "space-y-8"}>
      <FilterSummary data={data} />

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Overview"
          title="ภาพรวมกิจการ"
          subtitle="สรุปยอดสำคัญของรอบรายงานในมุมขาย รับเงิน จ่ายเงิน และกำไรขาดทุน"
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryCard label="ยอดขายรวม" value={`฿${formatCurrency(data.salesSummary.grossSalesAmount)}`} hint="ก่อนหักยอดคืนขาย" />
          <SummaryCard
            label="ยอดคืนขาย"
            value={`฿${formatCurrency(data.salesSummary.returnAmount)}`}
            accent="text-red-600"
            hint="Credit Note ประเภทคืนสินค้า"
          />
          <SummaryCard label="Net Sale" value={`฿${formatCurrency(data.salesSummary.netSaleAmount)}`} hint="ยอดขายสุทธิหลังหักคืน" />
          <SummaryCard
            label="รับเงินจริง"
            value={`฿${formatCurrency(data.dailyReceipts.totalAmount)}`}
            accent="text-emerald-600"
            hint="ขายสดและใบรับชำระในช่วงรายงาน"
          />
          <SummaryCard
            label="จ่ายเงินจริง"
            value={`฿${formatCurrency(data.dailyPayments.totalAmount)}`}
            accent="text-rose-600"
            hint="ซื้อสินค้า ค่าใช้จ่าย และคืนเงิน CN"
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryCard
            label="กำไรสุทธิ"
            value={`฿${formatCurrency(data.profitLoss.netProfit)}`}
            accent={data.profitLoss.netProfit >= 0 ? "text-emerald-600" : "text-red-600"}
            hint="หลังหักต้นทุนขายและค่าใช้จ่าย"
          />
          <SummaryCard
            label="ลูกหนี้คงค้าง"
            value={`฿${formatCurrency(data.receivables.totalOutstanding)}`}
            accent="text-amber-600"
            hint="ยอดค้างชำระของใบขาย active"
          />
          <SummaryCard
            label="คืนเงิน CN"
            value={`฿${formatCurrency(data.dailyPayments.creditNoteRefundAmount)}`}
            accent="text-orange-600"
            hint="Credit Note ที่คืนเป็นเงินสด/โอน"
          />
          <SummaryCard
            label="VAT คงชำระ"
            value={`฿${formatCurrency(data.profitLoss.vatPayable)}`}
            accent={data.profitLoss.vatPayable >= 0 ? "text-gray-900" : "text-red-600"}
            hint="VAT ขาย - VAT ซื้อ/ค่าใช้จ่าย/คืนขาย"
          />
          <SummaryCard label="มูลค่าสต็อก" value={`฿${formatCurrency(data.stock.totalStockValue)}`} hint="คำนวณจาก stock on hand x avg cost" />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Cashflow"
          title="รายงานรับเงินและจ่ายเงิน"
          subtitle="เพิ่มมุมมองบัญชีเงินให้สรุปและพิมพ์แล้วเห็น source, payment method และ account ที่กระทบจริง"
        />
        <div className="grid gap-4 xl:grid-cols-2">
          <TableCard title="รับเงินรายวัน" subtitle="ขายสดและใบรับชำระ พร้อมบัญชีที่เงินเข้า">
            <div className="grid gap-3 border-b border-gray-100 p-4 md:grid-cols-3">
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-500">รวมรับเงิน</p>
                <p className="font-kanit text-xl font-bold text-[#1e3a5f]">฿{formatCurrency(data.dailyReceipts.totalAmount)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-500">ขายสด</p>
                <p className="font-kanit text-xl font-bold text-gray-900">฿{formatCurrency(data.dailyReceipts.cashSaleAmount)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-500">รับชำระหนี้</p>
                <p className="font-kanit text-xl font-bold text-emerald-600">฿{formatCurrency(data.dailyReceipts.receiptAmount)}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">เอกสาร</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">ลูกค้า</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">ช่องทาง</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">บัญชี</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">จำนวนเงิน</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dailyReceipts.items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">
                        ไม่มีรายการรับเงิน
                      </td>
                    </tr>
                  ) : (
                    data.dailyReceipts.items.slice(0, maxRows).map((item) => (
                      <tr key={`${item.source}-${item.docNo}`} className="border-t border-gray-50">
                        <td className="px-4 py-2">
                          <p className="font-mono text-xs text-[#1e3a5f]">{item.docNo}</p>
                          <p className="text-xs text-gray-400">
                            {getReceiptSourceLabel(item.source)} | {formatDate(item.docDate)}
                          </p>
                        </td>
                        <td className="px-4 py-2">
                          <p className="text-gray-800">{item.customerName}</p>
                          <p className="text-xs text-gray-400">{item.customerCode || "-"}</p>
                        </td>
                        <td className="px-4 py-2 text-gray-600">{item.paymentMethod}</td>
                        <td className="px-4 py-2 text-gray-600">{item.accountName}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(item.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TableCard>

          <TableCard title="จ่ายเงินรายวัน" subtitle="ซื้อสินค้า ค่าใช้จ่าย และคืนเงิน CN พร้อมบัญชีที่เงินออก">
            <div className="grid gap-3 border-b border-gray-100 p-4 md:grid-cols-4">
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-500">รวมจ่ายเงิน</p>
                <p className="font-kanit text-xl font-bold text-[#1e3a5f]">฿{formatCurrency(data.dailyPayments.totalAmount)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-500">ซื้อสินค้า</p>
                <p className="font-kanit text-xl font-bold text-gray-900">฿{formatCurrency(data.dailyPayments.purchaseAmount)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-500">ค่าใช้จ่าย</p>
                <p className="font-kanit text-xl font-bold text-rose-600">฿{formatCurrency(data.dailyPayments.expenseAmount)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-500">คืนเงิน CN</p>
                <p className="font-kanit text-xl font-bold text-orange-600">฿{formatCurrency(data.dailyPayments.creditNoteRefundAmount)}</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">เอกสาร</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">คู่ค้า/รายละเอียด</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">ช่องทาง</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">บัญชี</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">จำนวนเงิน</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dailyPayments.items.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">
                        ไม่มีรายการจ่ายเงิน
                      </td>
                    </tr>
                  ) : (
                    data.dailyPayments.items.slice(0, maxRows).map((item) => (
                      <tr key={`${item.source}-${item.docNo}`} className="border-t border-gray-50">
                        <td className="px-4 py-2">
                          <p className="font-mono text-xs text-[#1e3a5f]">{item.docNo}</p>
                          <p className="text-xs text-gray-400">
                            {getPaymentSourceLabel(item.source)} | {formatDate(item.docDate)}
                          </p>
                        </td>
                        <td className="px-4 py-2">
                          <p className="text-gray-800">{item.counterpartName}</p>
                          <p className="text-xs text-gray-400">{item.counterpartCode || "-"}</p>
                        </td>
                        <td className="px-4 py-2 text-gray-600">{item.paymentMethod}</td>
                        <td className="px-4 py-2 text-gray-600">{item.accountName}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(item.amount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TableCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Operations"
          title="ลูกหนี้ คู่ค้า และผลประกอบการ"
          subtitle="ช่วยดูสถานะลูกหนี้ มูลค่าซื้อสุทธิ และสรุปกำไรขาดทุนในหน้าเดียว"
        />
        <div className="grid gap-4 xl:grid-cols-2">
          <TableCard title="ลูกหนี้คงค้าง (A/R)" subtitle="ยอดค้างชำระและอายุหนี้ของใบขาย active">
            <div className="grid gap-3 border-b border-gray-100 p-4 md:grid-cols-3">
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-500">รวมลูกหนี้</p>
                <p className="font-kanit text-xl font-bold text-[#1e3a5f]">฿{formatCurrency(data.receivables.totalOutstanding)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-500">ลูกหนี้ทั่วไป</p>
                <p className="font-kanit text-xl font-bold text-gray-900">฿{formatCurrency(data.receivables.regularOutstanding)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-500">COD ค้างรับ</p>
                <p className="font-kanit text-xl font-bold text-amber-600">฿{formatCurrency(data.receivables.codPendingOutstanding)}</p>
              </div>
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
                  {data.receivables.items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">
                        ไม่มีลูกหนี้คงค้าง
                      </td>
                    </tr>
                  ) : (
                    data.receivables.items.slice(0, maxRows).map((item) => (
                      <tr key={item.id} className="border-t border-gray-50">
                        <td className="px-4 py-2">
                          <p className="font-mono text-xs text-[#1e3a5f]">{item.saleNo}</p>
                          <p className="text-xs text-gray-400">{formatDate(item.saleDate)}</p>
                        </td>
                        <td className="px-4 py-2">
                          <p className="text-gray-800">{item.customerName}</p>
                          <p className="text-xs text-gray-400">{item.customerCode || item.bucketLabel}</p>
                        </td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(item.amountRemain)}</td>
                        <td className="px-4 py-2 text-right text-gray-600">{item.ageDays} วัน</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TableCard>

          <TableCard title="กำไรขาดทุน" subtitle="สรุปผลการดำเนินงานของรอบรายงาน">
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
                <div key={label} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
                  <span className="text-gray-600">{label}</span>
                  <span className={`font-medium ${Number(value) >= 0 ? "text-gray-900" : "text-red-600"}`}>
                    {Number(value) < 0 ? "-" : ""}฿{formatCurrency(Math.abs(Number(value)))}
                  </span>
                </div>
              ))}
            </div>
          </TableCard>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <TableCard title="สรุปซื้อแยกซัพพลายเออร์" subtitle="ภาพรวมคู่ค้าและยอดซื้อสุทธิ">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">ซัพพลายเออร์</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">เอกสารซื้อ</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">สุทธิ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.suppliers.items.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-400">
                        ไม่มีข้อมูลซื้อ
                      </td>
                    </tr>
                  ) : (
                    data.suppliers.items.slice(0, maxRows).map((item) => (
                      <tr key={item.supplierKey} className="border-t border-gray-50">
                        <td className="px-4 py-2">
                          <p className="text-gray-800">{item.supplierName}</p>
                          <p className="text-xs text-gray-400">
                            {item.supplierCode || "-"} | ซื้อ {formatCurrency(item.purchaseAmount)} | คืน {formatCurrency(item.returnAmount)}
                          </p>
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600">{item.purchaseCount}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(item.netPurchaseAmount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TableCard>

          <TableCard title="สรุปขายแยกลูกค้า" subtitle="มุมมองลูกค้าแบบ accounting-oriented">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">ลูกค้า</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">จำนวนบิล</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">Net sale</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">ค้างชำระ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.customers.items.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">
                        ไม่มีข้อมูลลูกค้า
                      </td>
                    </tr>
                  ) : (
                    data.customers.items.slice(0, maxRows).map((item) => (
                      <tr key={item.customerKey} className="border-t border-gray-50">
                        <td className="px-4 py-2">
                          <p className="text-gray-800">{item.customerName}</p>
                          <p className="text-xs text-gray-400">{item.customerCode || "-"}</p>
                        </td>
                        <td className="px-4 py-2 text-right text-gray-600">{item.invoiceCount}</td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(item.netSalesAmount)}</td>
                        <td className="px-4 py-2 text-right text-amber-700">{formatCurrency(item.outstandingAmount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TableCard>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Tax & Stock"
          title="ภาษี สต็อก และรายการติดตาม"
          subtitle="สรุป VAT มูลค่าสต็อก สินค้าใกล้ขั้นต่ำ และงานติดตามหลังการขาย"
        />
        <div className="grid gap-4 xl:grid-cols-2">
          <TableCard title="VAT Summary" subtitle="ภาพรวมภาษีซื้อ ภาษีขาย และ VAT สุทธิคงชำระ">
            <div className="space-y-2 p-4 text-sm">
              {[
                ["VAT ขาย", data.profitLoss.salesVat],
                ["VAT คืนขาย", -data.profitLoss.creditNoteVat],
                ["VAT ซื้อ", -data.profitLoss.purchaseVat],
                ["VAT ค่าใช้จ่าย", -data.profitLoss.expenseVat],
                ["VAT สุทธิคงชำระ", data.profitLoss.vatPayable],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
                  <span className="text-gray-600">{label}</span>
                  <span className={`font-medium ${Number(value) >= 0 ? "text-gray-900" : "text-red-600"}`}>
                    {Number(value) < 0 ? "-" : ""}฿{formatCurrency(Math.abs(Number(value)))}
                  </span>
                </div>
              ))}
            </div>
          </TableCard>

          <TableCard title="สินค้าใกล้ขั้นต่ำ" subtitle="รายการที่ควรติดตามและวางแผนสั่งซื้อ">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">รหัส</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">สินค้า</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">คงเหลือ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stock.lowStockItems.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-400">
                        ไม่มีสินค้าใกล้ minStock
                      </td>
                    </tr>
                  ) : (
                    data.stock.lowStockItems.slice(0, maxRows).map((item) => (
                      <tr key={item.id} className="border-t border-gray-50">
                        <td className="px-4 py-2 font-mono text-xs text-[#1e3a5f]">{item.code}</td>
                        <td className="px-4 py-2">
                          <p className="text-gray-800">{item.name}</p>
                          <p className="text-xs text-gray-400">{item.categoryName}</p>
                        </td>
                        <td className="px-4 py-2 text-right font-medium text-amber-700">{item.stock}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TableCard>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <TableCard title="มูลค่าสต็อกสูงสุด" subtitle="สินค้าที่ถือมูลค่าในคลังสูงสุด">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">รหัส</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">สินค้า</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">มูลค่า</th>
                  </tr>
                </thead>
                <tbody>
                  {data.stock.highestValueItems.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-400">
                        ไม่มีข้อมูลมูลค่าสต็อก
                      </td>
                    </tr>
                  ) : (
                    data.stock.highestValueItems.slice(0, maxRows).map((item) => (
                      <tr key={item.id} className="border-t border-gray-50">
                        <td className="px-4 py-2 font-mono text-xs text-[#1e3a5f]">{item.code}</td>
                        <td className="px-4 py-2">
                          <p className="text-gray-800">{item.name}</p>
                          <p className="text-xs text-gray-400">
                            {item.categoryName} | คงเหลือ {item.stock}
                          </p>
                        </td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(item.stockValue)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TableCard>

          <TableCard title="ประกันใกล้หมด" subtitle="รายการที่ควรติดตามต่อในงานบริการหลังการขาย">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">ใบขาย</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">สินค้า</th>
                    <th className="px-4 py-2 text-right font-medium text-gray-600">คงเหลือ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.warranties.expiringItems.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-400">
                        ไม่มีรายการประกันใกล้หมด
                      </td>
                    </tr>
                  ) : (
                    data.warranties.expiringItems.slice(0, maxRows).map((item) => (
                      <tr key={item.id} className="border-t border-gray-50">
                        <td className="px-4 py-2">
                          <p className="font-mono text-xs text-[#1e3a5f]">{item.saleNo}</p>
                          <p className="text-xs text-gray-400">{item.customerName}</p>
                        </td>
                        <td className="px-4 py-2">
                          <p className="text-gray-800">{item.productName}</p>
                          <p className="text-xs text-gray-400">{item.productCode}</p>
                        </td>
                        <td className={`px-4 py-2 text-right font-medium ${item.daysLeft < 0 ? "text-red-600" : "text-amber-700"}`}>
                          {item.daysLeft < 0 ? `หมดแล้ว ${Math.abs(item.daysLeft)} วัน` : `${item.daysLeft} วัน`}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TableCard>
        </div>
      </section>
    </div>
  );
};

export default ReportsContent;
