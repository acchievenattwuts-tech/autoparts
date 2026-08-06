export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Link from "next/link";
import { LineRecipientType } from "@/lib/generated/prisma";
import LineDailySummaryManager from "@/app/admin/(protected)/reports/line-daily-summary/LineDailySummaryManager";
import { resolveBangkokDayKey } from "@/lib/line-daily-summary";
import { getLineDailySummaryQStashStatus } from "@/lib/line-daily-summary-qstash";
import { getLineDailySummarySettings } from "@/lib/line-daily-summary-settings";
import { getLineDailySummaryConfig, resolveConfiguredLineRecipients } from "@/lib/line-messaging";
import { requirePermission } from "@/lib/require-auth";
import { db } from "@/lib/db";

import LineDailySummaryPreview from "./LineDailySummaryPreview";
import LineDailySummaryStatCards from "./LineDailySummaryStatCards";
import { StatCard } from "./summary-presentation";

/** Placeholder while a summary-backed section streams in. */
function SummarySectionSkeleton({
  heightClass,
  count,
}: {
  heightClass: string;
  count: number;
}) {
  return (
    <div className={count > 1 ? "grid gap-3 md:grid-cols-2 xl:grid-cols-4" : ""} aria-busy="true">
      {Array.from({ length: count }).map((_, index) => (
        <div
          key={index}
          className={`animate-pulse rounded-xl border border-gray-200 bg-gray-100 dark:border-white/10 dark:bg-white/5 ${heightClass}`}
        />
      ))}
    </div>
  );
}

interface PageProps {
  searchParams: Promise<{
    date?: string;
  }>;
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
  const availableUserRecipients = recipients
    .filter((recipient) => recipient.type === LineRecipientType.USER)
    .map((recipient) => ({
      id: recipient.id,
      lineId: recipient.lineId,
      type: recipient.type,
      displayName: recipient.displayName,
      sourceName: recipient.sourceName,
      lastWebhookAt: recipient.lastWebhookAt?.toISOString() ?? null,
      linkedUserName: recipient.userLinks?.user.name ?? null,
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
      linkedUserName: recipient.userLinks?.user.name ?? null,
    }));
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">LINE OA Daily Summary</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            preview ข้อความสรุปรายวัน พร้อม test send, webhook recipient capture และการผูกผู้รับแบบ ADMIN
          </p>
        </div>

        <form method="GET" className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-gray-600 dark:text-slate-300">
            วันที่รายงาน
            <input
              type="date"
              name="date"
              defaultValue={reportDayKey}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-ring dark:border-white/10 dark:bg-slate-950/80 dark:text-slate-100"
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
            className="inline-flex h-9 items-center rounded-md bg-gray-100 px-4 text-sm font-medium text-gray-600 hover:bg-gray-200 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15"
          >
            ล้าง
          </Link>
        </form>
      </div>

      <Suspense fallback={<SummarySectionSkeleton heightClass="h-24" count={4} />}>
        <LineDailySummaryStatCards reportDayKey={reportDayKey} compactMode={settings.compactMode} />
      </Suspense>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-slate-950/80">
        <div className="flex flex-col gap-1">
          <h3 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">สถานะการส่งปัจจุบัน</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">
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
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/15 dark:text-amber-100">
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
          lineRecipient: user.lineRecipientLinks?.recipient ?? null,
        }))}
        availableUserRecipients={availableUserRecipients}
        otherRecipients={otherRecipients}
        recentDispatches={recentDispatches.map((dispatch) => ({
          ...dispatch,
          createdAt: dispatch.createdAt.toISOString(),
        }))}
      />

      <Suspense fallback={<SummarySectionSkeleton heightClass="h-[520px]" count={1} />}>
        <LineDailySummaryPreview reportDayKey={reportDayKey} compactMode={settings.compactMode} />
      </Suspense>
    </div>
  );
}
