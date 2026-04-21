export const dynamic = "force-dynamic";

import Link from "next/link";
import { LineRecipientType } from "@/lib/generated/prisma";
import LineDailySummaryManager from "@/app/admin/(protected)/reports/line-daily-summary/LineDailySummaryManager";
import { buildLineDailySummary, resolveBangkokDayKey } from "@/lib/line-daily-summary";
import { getLineDailySummaryQStashStatus } from "@/lib/line-daily-summary-qstash";
import { getLineDailySummarySettings } from "@/lib/line-daily-summary-settings";
import { getLineDailySummaryConfig, resolveConfiguredLineRecipients } from "@/lib/line-messaging";
import { requirePermission } from "@/lib/require-auth";
import { db } from "@/lib/db";

interface PageProps {
  searchParams: Promise<{
    date?: string;
  }>;
}

function StatCard({
  title,
  value,
  tone = "default",
}: {
  title: string;
  value: string;
  tone?: "default" | "warn";
}) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        tone === "warn" ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-white"
      }`}
    >
      <p className="text-xs font-medium text-gray-500">{title}</p>
      <p className="mt-1 font-kanit text-xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

function fmtMoney(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function PreviewMetric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-white/70 bg-white/80 px-4 py-3 shadow-sm backdrop-blur">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 font-kanit text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function FlexPreviewSection({
  title,
  items,
}: {
  title: string;
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <div className="mt-3 space-y-2">
        {items.map((item) => (
          <div
            key={`${title}-${item.label}`}
            className="flex items-start justify-between gap-4 border-b border-slate-100 pb-2 text-sm last:border-b-0 last:pb-0"
          >
            <span className="text-slate-500">{item.label}</span>
            <span className="text-right font-semibold text-slate-900">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function keepPreviewItem(compactMode: boolean, rawValue: number, keepWhenZero = false) {
  if (!compactMode) return true;
  if (keepWhenZero) return true;
  return rawValue !== 0;
}

export default async function LineDailySummaryPage({ searchParams }: PageProps) {
  await requirePermission("reports.view");
  const params = await searchParams;
  const reportDayKey = resolveBangkokDayKey(params.date);

  const [
    settings,
    lineConfig,
    qstashStatus,
    resolvedRecipients,
    adminUsers,
    recipients,
    recentDispatches,
  ] = await Promise.all([
    getLineDailySummarySettings(),
    Promise.resolve(getLineDailySummaryConfig()),
    Promise.resolve(getLineDailySummaryQStashStatus()),
    getLineDailySummarySettings().then((value) => resolveConfiguredLineRecipients(value.targetMode)),
    db.user.findMany({
      where: {
        isActive: true,
        appRole: {
          is: {
            name: "ADMIN",
          },
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        lineRecipientLinks: {
          select: {
            recipient: {
              select: {
                id: true,
                lineId: true,
                displayName: true,
              },
            },
          },
          take: 1,
        },
      },
      orderBy: { name: "asc" },
    }),
    db.lineRecipient.findMany({
      orderBy: [{ type: "asc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        lineId: true,
        type: true,
        displayName: true,
        sourceName: true,
        lastWebhookAt: true,
        userLinks: {
          select: {
            user: {
              select: {
                name: true,
              },
            },
          },
          take: 1,
        },
      },
    }),
    db.lineDailySummaryDispatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        reportDayKey: true,
        dispatchKind: true,
        status: true,
        targetMode: true,
        recipientCount: true,
        sentCount: true,
        errorMessage: true,
        createdAt: true,
      },
    }),
  ]);
  const summary = await buildLineDailySummary(reportDayKey, {
    compactMode: settings.compactMode,
  });

  const totalRiskItems = summary.counts.lowStockCount + summary.counts.outOfStockCount;
  const availableUserRecipients = recipients
    .filter((recipient) => recipient.type === LineRecipientType.USER)
    .map((recipient) => ({
      id: recipient.id,
      lineId: recipient.lineId,
      type: recipient.type,
      displayName: recipient.displayName,
      sourceName: recipient.sourceName,
      lastWebhookAt: recipient.lastWebhookAt?.toISOString() ?? null,
      linkedUserName: recipient.userLinks[0]?.user.name ?? null,
    }));
  const otherRecipients = recipients
    .filter((recipient) => recipient.type !== LineRecipientType.USER)
    .map((recipient) => ({
      id: recipient.id,
      lineId: recipient.lineId,
      type: recipient.type,
      displayName: recipient.displayName,
      sourceName: recipient.sourceName,
      lastWebhookAt: recipient.lastWebhookAt?.toISOString() ?? null,
      linkedUserName: recipient.userLinks[0]?.user.name ?? null,
    }));
  const followUpCount =
    summary.counts.pendingDelivery +
    summary.counts.lowStockCount +
    summary.counts.outOfStockCount +
    summary.counts.openClaimCount +
    summary.counts.cancelledDocumentCount;
  const previewMoneyAndOutstandingItems = [
    keepPreviewItem(settings.compactMode, summary.money.cashInTotal, true)
      ? { label: "เงินเข้ารวม", value: `฿${fmtMoney(summary.money.cashInTotal)}` }
      : null,
    keepPreviewItem(settings.compactMode, summary.money.cashChannelTotal)
      ? { label: "เงินสด", value: `฿${fmtMoney(summary.money.cashChannelTotal)}` }
      : null,
    keepPreviewItem(settings.compactMode, summary.money.transferChannelTotal)
      ? { label: "เงินโอน", value: `฿${fmtMoney(summary.money.transferChannelTotal)}` }
      : null,
    keepPreviewItem(settings.compactMode, summary.money.arOutstanding)
      ? { label: "ลูกหนี้ค้างรับ", value: `฿${fmtMoney(summary.money.arOutstanding)}` }
      : null,
    keepPreviewItem(settings.compactMode, summary.money.codOutstanding)
      ? { label: "COD ค้างรับเงิน", value: `฿${fmtMoney(summary.money.codOutstanding)}` }
      : null,
    keepPreviewItem(settings.compactMode, summary.money.apOutstanding)
      ? { label: "เจ้าหนี้ค้างจ่าย", value: `฿${fmtMoney(summary.money.apOutstanding)}` }
      : null,
  ].filter((item): item is { label: string; value: string } => item !== null);
  const previewRiskItems = [
    keepPreviewItem(settings.compactMode, summary.counts.pendingDelivery)
      ? { label: "รอจัดส่ง", value: `${summary.counts.pendingDelivery} รายการ` }
      : null,
    keepPreviewItem(settings.compactMode, summary.counts.outForDelivery)
      ? { label: "กำลังจัดส่ง", value: `${summary.counts.outForDelivery} รายการ` }
      : null,
    keepPreviewItem(settings.compactMode, summary.counts.lowStockCount)
      ? { label: "สต๊อกต่ำขั้นต่ำ", value: `${summary.counts.lowStockCount} รายการ` }
      : null,
    keepPreviewItem(settings.compactMode, summary.counts.outOfStockCount)
      ? { label: "ของหมด", value: `${summary.counts.outOfStockCount} รายการ` }
      : null,
    keepPreviewItem(settings.compactMode, summary.counts.expiringLotCount)
      ? { label: "lot ใกล้หมดอายุ", value: `${summary.counts.expiringLotCount} lot` }
      : null,
    keepPreviewItem(settings.compactMode, summary.counts.openClaimCount)
      ? { label: "เคลมค้าง", value: `${summary.counts.openClaimCount} รายการ` }
      : null,
    keepPreviewItem(settings.compactMode, summary.counts.cancelledDocumentCount)
      ? { label: "เอกสารถูกยกเลิก", value: `${summary.counts.cancelledDocumentCount} รายการ` }
      : null,
  ].filter((item): item is { label: string; value: string } => item !== null);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-kanit text-2xl font-bold text-gray-900">LINE OA Daily Summary</h2>
          <p className="text-sm text-gray-500">
            preview ข้อความสรุปรายวัน พร้อม test send, webhook recipient capture และการผูกผู้รับแบบ ADMIN
          </p>
        </div>

        <form method="GET" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600">
            วันที่รายงาน
            <input
              type="date"
              name="date"
              defaultValue={reportDayKey}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <button
            type="submit"
            className="h-9 rounded-md bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055]"
          >
            แสดงตัวอย่าง
          </button>
          <Link
            href="/admin/reports/line-daily-summary"
            className="inline-flex h-9 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200"
          >
            ล้าง
          </Link>
        </form>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard title="ยอดขายวันนี้" value={`฿${fmtMoney(summary.money.salesTotal)}`} />
        <StatCard title="เงินรับเข้าวันนี้" value={`฿${fmtMoney(summary.money.cashInTotal)}`} />
        <StatCard
          title="ลูกหนี้ + COD คงค้าง"
          value={`฿${fmtMoney(summary.money.arOutstanding + summary.money.codOutstanding)}`}
        />
        <StatCard
          title="สต๊อกเสี่ยงวันนี้"
          value={`${totalRiskItems} รายการ`}
          tone={totalRiskItems > 0 ? "warn" : "default"}
        />
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-1">
          <h3 className="font-kanit text-lg font-semibold text-gray-900">สถานะการส่งปัจจุบัน</h3>
          <p className="text-sm text-gray-500">
            หน้านี้ใช้ข้อความ preview เดียวกับข้อความที่ระบบส่งจริง และยังคงใช้ logic คำนวณเดิมทั้งหมด
          </p>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="ผู้รับตาม target ปัจจุบัน"
            value={`${resolvedRecipients.recipientIds.length} ปลายทาง`}
            tone={resolvedRecipients.recipientIds.length > 0 ? "default" : "warn"}
          />
          <StatCard
            title="Channel Token"
            value={lineConfig.channelAccessToken ? "พร้อมใช้งาน" : "ยังไม่ตั้งค่า"}
            tone={lineConfig.channelAccessToken ? "default" : "warn"}
          />
          <StatCard
            title="Channel Secret"
            value={lineConfig.channelSecret ? "พร้อม webhook" : "ยังไม่ตั้งค่า"}
            tone={lineConfig.channelSecret ? "default" : "warn"}
          />
          <StatCard
            title="QStash"
            value={qstashStatus.ready ? "พร้อมใช้งาน" : "ยังตั้งค่าไม่ครบ"}
            tone={qstashStatus.ready ? "default" : "warn"}
          />
          <StatCard
            title="QSTASH_URL"
            value={qstashStatus.qstashUrlReady ? "พร้อมใช้งาน" : "ยังไม่ตั้งค่า"}
            tone={qstashStatus.qstashUrlReady ? "default" : "warn"}
          />
          <StatCard
            title="APP_BASE_URL"
            value={qstashStatus.appBaseUrlReady ? "พร้อมใช้งาน" : "ยังไม่ตั้งค่า"}
            tone={qstashStatus.appBaseUrlReady ? "default" : "warn"}
          />
        </div>

        {(lineConfig.missingDeliveryEnv.length > 0 || resolvedRecipients.missingDeliveryEnv.length > 0) && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">รายการที่ยังต้องเตรียมก่อนส่งจริง</p>
            <p className="mt-1">
              {[...lineConfig.missingDeliveryEnv, ...resolvedRecipients.missingDeliveryEnv].join(", ")}
            </p>
          </div>
        )}
      </section>

      <LineDailySummaryManager
        reportDayKey={reportDayKey}
        settings={settings}
        adminUsers={adminUsers.map((user) => ({
          id: user.id,
          name: user.name,
          email: user.email,
          lineRecipient: user.lineRecipientLinks[0]?.recipient ?? null,
        }))}
        availableUserRecipients={availableUserRecipients}
        otherRecipients={otherRecipients}
        recentDispatches={recentDispatches.map((dispatch) => ({
          ...dispatch,
          createdAt: dispatch.createdAt.toISOString(),
        }))}
      />

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex flex-col gap-1">
            <h3 className="font-kanit text-lg font-semibold text-gray-900">ข้อความ LINE ที่จะส่งจริง</h3>
            <p className="text-sm text-gray-500">
              preview นี้แสดงเฉพาะ Flex card เดียวกับที่ระบบส่งจริง สำหรับวันที่ {summary.reportDateLabel} ({summary.reportDayKey})
              {settings.compactMode ? " โดยเปิด compact mode ซ่อนแถวค่า 0" : " โดยแสดงครบทุกแถวตามค่าเดิม"}
            </p>
          </div>

          <div className="mt-4 rounded-[28px] border border-emerald-100 bg-[radial-gradient(circle_at_top,_#f0fdf4,_#dcfce7_40%,_#bbf7d0_100%)] p-4 md:p-5">
            <div className="mx-auto max-w-3xl">
              <div className="mb-1 flex items-center justify-between text-xs font-medium text-emerald-900/80">
                <span>LINE OA preview</span>
                <span>{summary.reportDateLabel}</span>
              </div>

              <div className="rounded-[24px] border border-white/90 bg-slate-50 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
                <div className="rounded-[24px] bg-gradient-to-br from-emerald-600 via-green-600 to-teal-700 p-5 text-white">
                  <p className="text-xs font-semibold tracking-wide text-emerald-100">SME Daily Closing</p>
                  <h4 className="mt-2 font-kanit text-2xl font-bold">🌈 สรุปงานประจำวันที่ {summary.reportDateLabel}</h4>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl bg-white/15 p-4 backdrop-blur">
                      <p className="text-xs text-emerald-100">กำไรขั้นต้นวันนี้</p>
                      <p className="mt-1 font-kanit text-2xl font-bold">
                        ฿{fmtMoney(summary.money.grossProfitToday)}({summary.money.grossMarginPctToday.toLocaleString("th-TH", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}%)
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/15 p-4 backdrop-blur">
                      <p className="text-xs text-emerald-100">รายการต้องติดตาม</p>
                      <p className="mt-1 font-kanit text-2xl font-bold">{followUpCount}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <FlexPreviewSection
                    title="🧾 รายละเอียดการขาย"
                    items={[
                      { label: "ยอดขายรวม", value: `฿${fmtMoney(summary.money.salesTotal)}` },
                      { label: "ขายสด", value: `฿${fmtMoney(summary.money.cashSales)}` },
                      { label: "ขายเชื่อ", value: `฿${fmtMoney(summary.money.creditSales)}` },
                      { label: "ต้นทุนขาย", value: `฿${fmtMoney(summary.money.costOfGoodsSoldToday)}` },
                    ]}
                  />

                  <FlexPreviewSection
                    title="💸 เงินเข้าและยอดค้าง"
                    items={[
                      { label: "เงินเข้ารวม", value: `฿${fmtMoney(summary.money.cashInTotal)}` },
                      { label: "เงินสด", value: `฿${fmtMoney(summary.money.cashChannelTotal)}` },
                      { label: "เงินโอน", value: `฿${fmtMoney(summary.money.transferChannelTotal)}` },
                      { label: "ลูกหนี้ค้างรับ", value: `฿${fmtMoney(summary.money.arOutstanding)}` },
                      { label: "COD ค้างรับเงิน", value: `฿${fmtMoney(summary.money.codOutstanding)}` },
                      { label: "เจ้าหนี้ค้างจ่าย", value: `฿${fmtMoney(summary.money.apOutstanding)}` },
                    ]}
                  />

                  <FlexPreviewSection
                    title="🚚 งานค้างและความเสี่ยง"
                    items={[
                      { label: "รอจัดส่ง", value: `${summary.counts.pendingDelivery} รายการ` },
                      { label: "กำลังจัดส่ง", value: `${summary.counts.outForDelivery} รายการ` },
                      { label: "สต๊อกต่ำขั้นต่ำ", value: `${summary.counts.lowStockCount} รายการ` },
                      { label: "ของหมด", value: `${summary.counts.outOfStockCount} รายการ` },
                      { label: "lot ใกล้หมดอายุ", value: `${summary.counts.expiringLotCount} lot` },
                      { label: "เคลมค้าง", value: `${summary.counts.openClaimCount} รายการ` },
                      { label: "เอกสารถูกยกเลิก", value: `${summary.counts.cancelledDocumentCount} รายการ` },
                    ]}
                  />

                  <div className="rounded-2xl bg-sky-50 px-4 py-3 text-sm text-sky-900 ring-1 ring-sky-100">
                    <p className="font-semibold">✨ ปิดท้ายวันนี้</p>
                    <p className="mt-1">
                      ค่าใช้จ่ายวันนี้ ฿{fmtMoney(summary.money.expensesToday)} • เงินโอนระหว่างบัญชี ฿{fmtMoney(summary.money.transfersToday)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="font-kanit text-lg font-semibold text-gray-900">ตัวเลขหลัก</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <PreviewMetric label="ขายสด" value={`฿${fmtMoney(summary.money.cashSales)}`} />
              <PreviewMetric label="ขายเชื่อ" value={`฿${fmtMoney(summary.money.creditSales)}`} />
              <PreviewMetric label="รับชำระหนี้" value={`฿${fmtMoney(summary.money.cashInFromReceipts)}`} />
              <PreviewMetric label="เงินสด" value={`฿${fmtMoney(summary.money.cashChannelTotal)}`} />
              <PreviewMetric label="เงินโอน" value={`฿${fmtMoney(summary.money.transferChannelTotal)}`} />
              <PreviewMetric label="เจ้าหนี้ค้างจ่าย" value={`฿${fmtMoney(summary.money.apOutstanding)}`} />
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="font-kanit text-lg font-semibold text-gray-900">งานค้าง/ความเสี่ยง</h3>
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
    </div>
  );
}
