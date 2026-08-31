import { buildRiskRadarItems } from "@/lib/line-daily-summary";
import { formatDateThai, parseDateOnlyToDate } from "@/lib/th-date";

import {
  FlexPreviewSection,
  PreviewMetric,
  fmtMoney,
  fmtPercent,
  keepPreviewItem,
} from "./summary-presentation";
import { getLineDailySummaryForDay } from "./summary-loader";

/** Flex-message preview for the LINE daily summary — awaits the summary build. */
export default async function LineDailySummaryPreview({
  reportDayKey,
  compactMode,
}: {
  reportDayKey: string;
  compactMode: boolean;
}) {
  const summary = await getLineDailySummaryForDay(reportDayKey, compactMode);

  const previewMoneyAndOutstandingItems = [
    keepPreviewItem(compactMode, summary.money.cashInTotal, true)
      ? { label: "เงินเข้ารวม", value: `฿${fmtMoney(summary.money.cashInTotal)}`,
        }
      : null,
    keepPreviewItem(compactMode, summary.money.cashInFromCustomerAdvances)
      ? {
          label: "รับเงินมัดจำลูกค้า",
          value: `฿${fmtMoney(summary.money.cashInFromCustomerAdvances)}`,
        }
      : null,
    keepPreviewItem(compactMode, summary.money.cashInFromSupplierAdvanceRefunds)
      ? {
          label: "รับคืนเงินมัดจำซัพพลายเออร์",
          value: `฿${fmtMoney(summary.money.cashInFromSupplierAdvanceRefunds)}`,
        }
      : null,
    keepPreviewItem(compactMode, summary.money.cashChannelTotal)
      ? { label: "เงินสด", value: `฿${fmtMoney(summary.money.cashChannelTotal)}`,
        }
      : null,
    keepPreviewItem(compactMode, summary.money.transferChannelTotal)
      ? { label: "เงินโอน", value: `฿${fmtMoney(summary.money.transferChannelTotal)}`,
        }
      : null,
    keepPreviewItem(compactMode, summary.money.arOutstanding)
      ? { label: "ลูกหนี้ค้างรับ", value: `฿${fmtMoney(summary.money.arOutstanding)}`,
        }
      : null,
    keepPreviewItem(compactMode, summary.money.codOutstanding)
      ? { label: "COD ค้างรับเงิน", value: `฿${fmtMoney(summary.money.codOutstanding)}`,
        }
      : null,
    keepPreviewItem(compactMode, summary.money.apOutstanding)
      ? { label: "เจ้าหนี้ค้างจ่าย", value: `฿${fmtMoney(summary.money.apOutstanding)}`,
        }
      : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  const previewSalesItems = [
    keepPreviewItem(compactMode, summary.money.salesTotal, true)
      ? { label: "ยอดขายรวม", value: `฿${fmtMoney(summary.money.salesTotal)}` }
      : null,
    keepPreviewItem(compactMode, summary.money.cashSales)
      ? { label: "ขายสด", value: `฿${fmtMoney(summary.money.cashSales)}` }
      : null,
    keepPreviewItem(compactMode, summary.money.creditSales)
      ? { label: "ขายเชื่อ", value: `฿${fmtMoney(summary.money.creditSales)}` }
      : null,
    keepPreviewItem(compactMode, summary.money.costOfGoodsSoldToday)
      ? { label: "ต้นทุนขาย", value: `฿${fmtMoney(summary.money.costOfGoodsSoldToday)}`,
        }
      : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  const previewBalanceItems = [
    ...summary.balances.accounts
      .filter((account) => keepPreviewItem(compactMode, account.balance))
      .map((account) => ({ label: account.label, value: `฿${fmtMoney(account.balance)}`,
      })),
    { label: "รวมทุกบัญชี", value: `฿${fmtMoney(summary.balances.totalBalance)}`,
    },
  ];
  // Month-end only — mirrors buildMonthlyProfitFlexCard so preview and the real
  // Flex card stay identical. Always shows all three rows, even in compact mode.
  const monthly = summary.monthly;
  const previewMonthlyItems = monthly
    ? [
        { label: "รายได้รวม (ก่อน VAT)", value: `฿${fmtMoney(monthly.revenueExVat)}` },
        { label: "ต้นทุน + ค่าใช้จ่ายรวม", value: `฿${fmtMoney(monthly.costAndExpenseAmount)}` },
        ...(monthly.otherIncomeAmount !== 0
          ? [{ label: "รายรับพิเศษ", value: `฿${fmtMoney(monthly.otherIncomeAmount)}` }]
          : []),
        { label: "กำไรสุทธิ", value: `฿${fmtMoney(monthly.netProfitAmount)}` },
      ]
    : [];
  const previewRiskItems = buildRiskRadarItems(summary.risks)
    .filter((item) => keepPreviewItem(compactMode, item.count))
    .map((item) => ({ label: item.label, value: item.value }));

  return (
    <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-slate-950/80">
        <div className="flex flex-col gap-1">
          <h3 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">ข้อความ LINE ที่จะส่งจริง</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            preview นี้แสดงเฉพาะ Flex card เดียวกับที่ระบบส่งจริง สำหรับวันที่ {" "}
            {summary.reportDateLabel} ({summary.reportDayKey})
            {compactMode ? " โดยเปิด compact mode ซ่อนแถวค่า 0" : " โดยแสดงครบทุกแถวตามค่าเดิม"}
          </p>
        </div>

        <div className="line-preview-root mt-4 rounded-[28px] border border-gray-200 bg-white p-4 shadow-sm md:p-5">
          <div className="mx-auto max-w-3xl">
            <div className="mb-3 flex items-center justify-between text-xs font-medium text-slate-600">
              <span>LINE OA preview</span>
              <span>{summary.reportDateLabel}</span>
            </div>

            <div className="rounded-[24px] border border-gray-200 bg-white p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
              <div className="rounded-[24px] bg-gradient-to-br from-emerald-600 via-green-600 to-teal-700 p-5 text-white">
                <p className="text-xs font-semibold tracking-wide text-emerald-100">SME Daily Closing</p>
                <h4 className="mt-2 font-kanit text-2xl font-bold">🌈 สรุปงานประจำวันที่ {summary.reportDateLabel}</h4>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-white/15 p-4 backdrop-blur">
                    <p className="text-xs text-emerald-100">กำไรขั้นต้นวันนี้</p>
                    <p className="mt-1 font-kanit text-2xl font-bold">
                      ฿{fmtMoney(summary.money.grossProfitToday)}({fmtPercent(summary.money.grossMarginPctToday)}%)
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white/15 p-4 backdrop-blur">
                    <p className="text-xs text-emerald-100">เงินเข้าวันนี้</p>
                    <p className="mt-1 font-kanit text-2xl font-bold">฿{fmtMoney(summary.money.cashInTotal)}</p>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <FlexPreviewSection
                  title="🧾 รายละเอียดการขาย"
                  items={previewSalesItems}
                />

                <FlexPreviewSection
                  title="💸 เงินเข้าและยอดค้าง"
                  items={previewMoneyAndOutstandingItems}
                />

                <FlexPreviewSection
                  title="💵 ยอดเงินคงเหลือแต่ละบัญชี"
                  items={previewBalanceItems}
                />

                <FlexPreviewSection
                  title="📡 เรดาร์ความเสี่ยงวันนี้"
                  items={previewRiskItems}
                />

                {monthly ? (
                  <FlexPreviewSection
                    title={`🏁 กำไรสุทธิประจำเดือน ${monthly.monthLabel}`}
                    subtitle={`สรุปทั้งเดือน ${formatDateThai(
                      parseDateOnlyToDate(monthly.monthStartDayKey),
                    )} - ${formatDateThai(parseDateOnlyToDate(monthly.monthEndDayKey))}`}
                    items={previewMonthlyItems}
                  />
                ) : null}

                <div className="rounded-2xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-sky-100">
                  <p className="font-semibold">✨ ปิดท้ายวันนี้</p>
                  <p className="mt-1">
                    จ่ายเงินวันนี้ ฿{fmtMoney(summary.money.expensesToday)} •
                    คืนเงินมัดจำลูกค้า ฿
                    {fmtMoney(summary.money.cashOutForCustomerAdvanceRefunds)} •
                    เงินโอนระหว่างบัญชี ฿{fmtMoney(summary.money.transfersToday)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-slate-950/80">
          <h3 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">ตัวเลขหลัก</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <PreviewMetric label="ขายสด" value={`฿${fmtMoney(summary.money.cashSales)}`} />
            <PreviewMetric label="ขายเชื่อ" value={`฿${fmtMoney(summary.money.creditSales)}`} />
            <PreviewMetric label="รับชำระหนี้" value={`฿${fmtMoney(summary.money.cashInFromReceipts)}`} />
            <PreviewMetric label="รับเงินมัดจำลูกค้า" value={`฿${fmtMoney(summary.money.cashInFromCustomerAdvances)}`} />
            <PreviewMetric label="รับคืนเงินมัดจำซัพพลายเออร์"
              value={`฿${fmtMoney(summary.money.cashInFromSupplierAdvanceRefunds)}`}
            />
            <PreviewMetric
              label="คืนเงินมัดจำลูกค้า"
              value={`฿${fmtMoney(summary.money.cashOutForCustomerAdvanceRefunds)}`}
            />
            <PreviewMetric
              label="เงินสด" value={`฿${fmtMoney(summary.money.cashChannelTotal)}`} />
            <PreviewMetric label="เงินโอน" value={`฿${fmtMoney(summary.money.transferChannelTotal)}`} />
            <PreviewMetric label="เจ้าหนี้ค้างจ่าย" value={`฿${fmtMoney(summary.money.apOutstanding)}`} />
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-slate-950/80">
          <h3 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">งานค้าง/ความเสี่ยง</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <PreviewMetric label="รอจัดส่ง" value={`${summary.counts.pendingDelivery} รายการ`} />
            <PreviewMetric label="กำลังจัดส่ง" value={`${summary.counts.outForDelivery} รายการ`} />
            <PreviewMetric label="ส่งสำเร็จวันนี้" value={`${summary.counts.deliveredToday} รายการ`} />
            <PreviewMetric label="ต่ำกว่าขั้นต่ำ" value={`${summary.counts.lowStockCount} รายการ`} />
            <PreviewMetric label="ของหมด" value={`${summary.counts.outOfStockCount} รายการ`} />
            <PreviewMetric label="lot ใกล้หมดอายุ" value={`${summary.counts.expiringLotCount} lot`} />
            <PreviewMetric label="lot หมดอายุค้างสต๊อก" value={`${summary.counts.expiredLotCount} lot`} />
            <PreviewMetric label="เคลมค้างดำเนินการ" value={`${summary.counts.openClaimCount} รายการ`} />
            <PreviewMetric label="เอกสารถูกยกเลิกวันนี้" value={`${summary.counts.cancelledDocumentCount} รายการ`} />
          </div>
        </section>
      </div>
    </section>
  );
}
