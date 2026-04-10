export const dynamic = "force-dynamic";

import Link from "next/link";
import { LineRecipientType } from "@/lib/generated/prisma";
import LineDailySummaryManager from "@/app/admin/(protected)/reports/line-daily-summary/LineDailySummaryManager";
import { buildLineDailySummary, resolveBangkokDayKey } from "@/lib/line-daily-summary";
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

export default async function LineDailySummaryPage({ searchParams }: PageProps) {
  await requirePermission("reports.view");
  const params = await searchParams;
  const reportDayKey = resolveBangkokDayKey(params.date);

  const [
    summary,
    settings,
    lineConfig,
    resolvedRecipients,
    adminUsers,
    recipients,
    recentDispatches,
  ] = await Promise.all([
    buildLineDailySummary(reportDayKey),
    getLineDailySummarySettings(),
    Promise.resolve(getLineDailySummaryConfig()),
    getLineDailySummarySettings().then((value) => resolveConfiguredLineRecipients(value.targetMode)),
    db.user.findMany({
      where: { role: "ADMIN", isActive: true },
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
        createdAt: true,
      },
    }),
  ]);

  const missingCronSecret = !lineConfig.cronSecret;
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-kanit text-2xl font-bold text-gray-900">LINE OA Daily Summary</h2>
          <p className="text-sm text-gray-500">
            Preview ข้อความสรุปรายวัน พร้อมตั้งเวลาในระบบ, Test Send, webhook recipient capture และ mapping สำหรับส่งหา ADMIN
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
            หน้า admin นี้ยังคง preview ข้อความเดิมไว้เหมือนเดิม แต่เพิ่ม scheduler setting และ admin-targeting เป็น layer ใหม่ด้านบน
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
            title="Cron Secret"
            value={missingCronSecret ? "ยังไม่ตั้งค่า" : "พร้อมใช้งาน"}
            tone={missingCronSecret ? "warn" : "default"}
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
          <h3 className="font-kanit text-lg font-semibold text-gray-900">ข้อความ LINE ที่จะส่ง</h3>
          <p className="mt-1 text-sm text-gray-500">
            วันที่รายงาน {summary.reportDateLabel} ({summary.reportDayKey})
          </p>
          <pre className="mt-4 whitespace-pre-wrap rounded-xl bg-slate-950 p-4 text-sm leading-6 text-slate-100">
            {summary.message}
          </pre>
        </div>

        <div className="space-y-4">
          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="font-kanit text-lg font-semibold text-gray-900">ตัวเลขหลัก</h3>
            <div className="mt-3 space-y-2 text-sm text-gray-700">
              <p>ขายสด: ฿{fmtMoney(summary.money.cashSales)}</p>
              <p>ขายเชื่อ: ฿{fmtMoney(summary.money.creditSales)}</p>
              <p>รับชำระหนี้: ฿{fmtMoney(summary.money.cashInFromReceipts)}</p>
              <p>เงินสด: ฿{fmtMoney(summary.money.cashChannelTotal)}</p>
              <p>เงินโอน: ฿{fmtMoney(summary.money.transferChannelTotal)}</p>
              <p>เจ้าหนี้ค้างจ่าย: ฿{fmtMoney(summary.money.apOutstanding)}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-gray-200 bg-white p-5">
            <h3 className="font-kanit text-lg font-semibold text-gray-900">งานค้าง/ความเสี่ยง</h3>
            <div className="mt-3 space-y-2 text-sm text-gray-700">
              <p>รอจัดส่ง: {summary.counts.pendingDelivery} รายการ</p>
              <p>กำลังจัดส่ง: {summary.counts.outForDelivery} รายการ</p>
              <p>ส่งสำเร็จวันนี้: {summary.counts.deliveredToday} รายการ</p>
              <p>ต่ำกว่าขั้นต่ำ: {summary.counts.lowStockCount} รายการ</p>
              <p>ของหมด: {summary.counts.outOfStockCount} รายการ</p>
              <p>lot ใกล้หมดอายุ: {summary.counts.expiringLotCount} lot</p>
              <p>lot หมดอายุค้างสต๊อก: {summary.counts.expiredLotCount} lot</p>
              <p>เคลมค้างดำเนินการ: {summary.counts.openClaimCount} รายการ</p>
              <p>เอกสารถูกยกเลิกวันนี้: {summary.counts.cancelledDocumentCount} รายการ</p>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
