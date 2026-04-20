import type { ReportsData } from "@/lib/reports";
import { formatDateThai } from "@/lib/th-date";

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
  return formatDateThai(value);
}

function getReceiptSourceLabel(source: "SALE" | "RECEIPT" | "PURCHASE_RETURN"): string {
  switch (source) {
    case "SALE":
      return "ขายสด";
    case "RECEIPT":
      return "รับชำระ";
    case "PURCHASE_RETURN":
      return "รับเงินคืนซื้อ";
    default:
      return source;
  }
}

function getPaymentSourceLabel(
  source: "PURCHASE" | "EXPENSE" | "CN_SALE" | "SUPPLIER_ADVANCE" | "SUPPLIER_PAYMENT"
): string {
  switch (source) {
    case "PURCHASE":
      return "ซื้อสินค้า";
    case "EXPENSE":
      return "ค่าใช้จ่าย";
    case "CN_SALE":
      return "คืนเงิน CN";
    case "SUPPLIER_ADVANCE":
      return "มัดจำซัพพลายเออร์";
    case "SUPPLIER_PAYMENT":
      return "จ่ายซัพพลายเออร์";
    default:
      return source;
  }
}

function getClaimTypeLabel(claimType: string): string {
  return claimType === "REPLACE_NOW" ? "เปลี่ยนให้ทันที" : "ลูกค้ารอเคลม";
}

function getClaimStatusLabel(status: string): string {
  return status === "DRAFT" ? "รอส่งเคลม" : "ส่งซัพพลายเออร์แล้ว";
}

function getClaimStatusClass(status: string): string {
  return status === "DRAFT" ? "bg-yellow-100 text-yellow-700" : "bg-blue-100 text-blue-700";
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

function ScopePill({
  label,
  tone = "date",
}: {
  label: string;
  tone?: "date" | "snapshot";
}) {
  const className =
    tone === "snapshot"
      ? "border-sky-200 bg-sky-50 text-sky-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${className}`}>{label}</span>;
}

function SummaryCard({
  label,
  value,
  accent = "text-[#1e3a5f]",
  hint,
  className = "",
}: {
  label: string;
  value: string;
  accent?: string;
  hint: string;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-gray-100 bg-white p-4 shadow-sm ${className}`}>
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

function ScopeSummary() {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm">
        <ScopePill label="ตามช่วงวันที่รายงาน" tone="date" />
        <p className="mt-3 font-kanit text-lg font-semibold text-emerald-950">ข้อมูลที่เปลี่ยนตามช่วงวันที่รายงาน</p>
        <p className="mt-1 text-sm text-emerald-900">
          ใช้กับ section Overview, Cashflow และ Operations โดยอิงช่วงวันที่และตัวกรองที่เลือก
        </p>
      </div>
      <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 shadow-sm">
        <ScopePill label="สถานะปัจจุบัน" tone="snapshot" />
        <p className="mt-3 font-kanit text-lg font-semibold text-sky-950">ข้อมูลที่ไม่ผูกกับช่วงวันที่รายงาน</p>
        <p className="mt-1 text-sm text-sky-900">
          ใช้กับ section Stock เพื่อแสดงสต็อกคงเหลือ มูลค่าสต็อก และเคลมค้างตามสถานะล่าสุด
        </p>
      </div>
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
      "สินค้า",
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

  return (
    <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <ScopePill label={`ช่วงรายงาน ${data.range.from} ถึง ${data.range.to}`} tone="date" />
        {filterEntries.map(([label, value]) => (
          <span key={label} className="rounded-full bg-white px-3 py-1 text-xs text-gray-600 shadow-sm">
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
      <ScopeSummary />

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Overview"
          title="ภาพรวมกิจการ"
          subtitle="สรุปตัวเลขสำคัญของรอบรายงานในมุมขาย รับเงิน จ่ายเงิน ลูกหนี้ และเจ้าหนี้"
        />
        <div className="flex flex-wrap gap-2">
          <ScopePill label="section นี้อิงช่วงวันที่รายงาน" tone="date" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
          <SummaryCard
            label="ยอดขายรวม"
            value={`฿${formatCurrency(data.salesSummary.grossSalesAmount)}`}
            hint="ก่อนหักยอดคืนขาย"
            className="md:col-span-2 xl:col-span-3"
          />
          <SummaryCard
            label="ยอดคืนขาย"
            value={`฿${formatCurrency(data.salesSummary.returnAmount)}`}
            accent="text-red-600"
            hint="Credit Note ประเภทคืนสินค้า"
            className="xl:col-span-3"
          />
          <SummaryCard
            label="Net Sale"
            value={`฿${formatCurrency(data.salesSummary.netSaleAmount)}`}
            hint="ยอดขายสุทธิหลังหักคืน"
            className="xl:col-span-3"
          />
          <SummaryCard
            label="รับเงินจริง"
            value={`฿${formatCurrency(data.dailyReceipts.totalAmount)}`}
            accent="text-emerald-600"
            hint="ขายสด ใบรับชำระ และรับเงินคืนจากใบคืนซื้อ"
            className="xl:col-span-3"
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
          <SummaryCard
            label="จ่ายเงินจริง"
            value={`฿${formatCurrency(data.dailyPayments.totalAmount)}`}
            accent="text-rose-600"
            hint="ซื้อสินค้า ค่าใช้จ่าย คืนเงิน CN มัดจำ และจ่ายซัพพลายเออร์"
            className="xl:col-span-4"
          />
          <SummaryCard
            label="ลูกหนี้คงค้าง"
            value={`฿${formatCurrency(data.receivables.totalOutstanding)}`}
            accent="text-amber-600"
            hint="ยอดค้างชำระของใบขาย active"
            className="xl:col-span-4"
          />
          <SummaryCard
            label="คืนเงิน CN"
            value={`฿${formatCurrency(data.dailyPayments.creditNoteRefundAmount)}`}
            accent="text-orange-600"
            hint="Credit Note ที่คืนเป็นเงินสดหรือโอน"
            className="xl:col-span-4"
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
          <SummaryCard
            label="A/P Outstanding"
            value={`฿${formatCurrency(data.payables.purchaseOutstanding)}`}
            accent="text-rose-700"
            hint="เจ้าหนี้คงค้างจากใบซื้อเชื่อ"
            className="xl:col-span-4"
          />
          <SummaryCard
            label="Supplier Advance Outstanding"
            value={`฿${formatCurrency(data.payables.advanceOutstanding)}`}
            accent="text-emerald-700"
            hint="เงินมัดจำซัพพลายเออร์ที่ยังไม่ถูกใช้"
            className="xl:col-span-4"
          />
          <SummaryCard
            label="CN Credit Outstanding"
            value={`฿${formatCurrency(data.payables.purchaseReturnCreditOutstanding)}`}
            accent="text-amber-700"
            hint="เครดิตใบคืนซื้อที่ยังรอหักชำระ"
            className="md:col-span-2 xl:col-span-4"
          />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader
          eyebrow="Cashflow"
          title="รายงานรับเงินและจ่ายเงิน"
          subtitle="แสดงความเคลื่อนไหวรับเงินและจ่ายเงินตามช่วงวันที่ พร้อม source ช่องทาง และบัญชีที่กระทบจริง"
        />
        <div className="flex flex-wrap gap-2">
          <ScopePill label="section นี้อิงช่วงวันที่รายงาน" tone="date" />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <TableCard title="รับเงินรายวัน" subtitle="ขายสด ใบรับชำระ และรับเงินคืนจากใบคืนซื้อ พร้อมบัญชีที่เงินเข้า">
            <div className="grid gap-3 border-b border-gray-100 p-4 md:grid-cols-2 xl:grid-cols-4">
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
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-500">รับเงินคืนซื้อ</p>
                <p className="font-kanit text-xl font-bold text-cyan-700">฿{formatCurrency(data.dailyReceipts.purchaseReturnRefundAmount)}</p>
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

          <TableCard title="จ่ายเงินรายวัน" subtitle="ซื้อสินค้า ค่าใช้จ่าย คืนเงิน CN มัดจำ และจ่ายซัพพลายเออร์ พร้อมบัญชีที่เงินออก">
            <div className="grid gap-3 border-b border-gray-100 p-4 md:grid-cols-2 xl:grid-cols-5">
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
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-500">มัดจำซัพพลายเออร์</p>
                <p className="font-kanit text-xl font-bold text-emerald-700">฿{formatCurrency(data.dailyPayments.supplierAdvanceAmount)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-xs text-gray-500">จ่ายซัพพลายเออร์</p>
                <p className="font-kanit text-xl font-bold text-rose-700">฿{formatCurrency(data.dailyPayments.supplierPaymentAmount)}</p>
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
          title="ลูกหนี้ คู่ค้า และลูกค้า"
          subtitle="มุมมองการปฏิบัติการตามช่วงวันที่ โดยตัดกำไรขาดทุนออกจาก section นี้แล้ว"
        />
        <div className="flex flex-wrap gap-2">
          <ScopePill label="section นี้อิงช่วงวันที่รายงาน" tone="date" />
        </div>
        <div className="grid gap-4">
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
          eyebrow="Stock"
          title="สต็อกและรายการติดตาม"
          subtitle="มุมมองสถานะปัจจุบันของมูลค่าสต็อก สินค้าใกล้ขั้นต่ำ และเคลมค้างดำเนินการ"
        />
        <div className="flex flex-wrap gap-2">
          <ScopePill label="section นี้ไม่อิงช่วงวันที่รายงาน" tone="snapshot" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12">
          <SummaryCard
            label="มูลค่าสต็อก"
            value={`฿${formatCurrency(data.stock.totalStockValue)}`}
            hint="คำนวณจาก stock on hand x avg cost ล่าสุด"
            className="xl:col-span-3"
          />
          <SummaryCard
            label="จำนวนสินค้าที่ใช้งาน"
            value={data.stock.activeProductCount.toLocaleString("th-TH")}
            hint="นับจากสินค้า active ทั้งหมดในระบบ"
            className="xl:col-span-3"
          />
          <SummaryCard
            label="สินค้าใกล้ขั้นต่ำ"
            value={data.stock.lowStockCount.toLocaleString("th-TH")}
            accent="text-amber-600"
            hint="รายการที่ stock on hand ต่ำกว่าหรือเท่าจุดขั้นต่ำ"
            className="xl:col-span-3"
          />
          <SummaryCard
            label="เคลมค้างดำเนินการ"
            value={data.openClaims.totalOpenCount.toLocaleString("th-TH")}
            accent="text-sky-700"
            hint="สถานะ รอส่งเคลม และ ส่งซัพพลายเออร์แล้ว ที่ยังไม่ปิดเคลม"
            className="xl:col-span-3"
          />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
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
                        ไม่มีสินค้าใกล้ขั้นต่ำ
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
                          <p className="text-xs text-gray-400">{item.categoryName} | คงเหลือ {item.stock}</p>
                        </td>
                        <td className="px-4 py-2 text-right font-medium text-gray-900">{formatCurrency(item.stockValue)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </TableCard>
        </div>

        <div className="grid gap-4">
          <TableCard
            title="รายการเคลมค้างดำเนินการ"
            subtitle="แสดงเฉพาะเคลมสถานะ รอส่งเคลม และ ส่งซัพพลายเออร์แล้ว โดยไม่ผูกกับช่วงวันที่รายงาน"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">เลขที่เคลม / วันที่เคลม</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">สินค้า</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">ลูกค้า / ใบขาย</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">ประเภทเคลม</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">ชื่อซัพ</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-600">สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.openClaims.items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400">
                        ไม่มีรายการเคลมที่ยังไม่ปิดเคลม
                      </td>
                    </tr>
                  ) : (
                    data.openClaims.items.slice(0, maxRows).map((item) => (
                      <tr key={item.id} className="border-t border-gray-50">
                        <td className="px-4 py-2">
                          <p className="font-mono text-xs text-[#1e3a5f]">{item.claimNo}</p>
                          <p className="text-xs text-gray-400">{formatDate(item.claimDate)}</p>
                        </td>
                        <td className="px-4 py-2">
                          <p className="text-gray-800">{item.productName}</p>
                          <p className="text-xs text-gray-400">{item.productCode}</p>
                        </td>
                        <td className="px-4 py-2">
                          <p className="text-gray-800">{item.customerName}</p>
                          <p className="font-mono text-xs text-gray-400">{item.saleNo}</p>
                        </td>
                        <td className="px-4 py-2 text-gray-600">{getClaimTypeLabel(item.claimType)}</td>
                        <td className="px-4 py-2 text-gray-600">{item.supplierName}</td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getClaimStatusClass(item.status)}`}>
                            {getClaimStatusLabel(item.status)}
                          </span>
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
