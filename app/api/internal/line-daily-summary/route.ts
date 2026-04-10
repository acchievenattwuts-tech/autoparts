export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import { LineDailySummaryDispatchKind } from "@/lib/generated/prisma";
import { buildLineDailySummary, resolveBangkokDayKey } from "@/lib/line-daily-summary";
import { deliverLineDailySummary } from "@/lib/line-daily-summary-delivery";
import {
  getLineDailySummarySettings,
  shouldSendLineDailySummaryNow,
} from "@/lib/line-daily-summary-settings";
import { getLineDailySummaryConfig, resolveConfiguredLineRecipients } from "@/lib/line-messaging";

function unauthorizedResponse() {
  return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const config = getLineDailySummaryConfig();

  if (!config.cronSecret) {
    return Response.json(
      { ok: false, error: "CRON_SECRET is not configured" },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${config.cronSecret}`) {
    return unauthorizedResponse();
  }

  const { searchParams } = new URL(request.url);
  const settings = await getLineDailySummarySettings();
  const dryRun = searchParams.get("dryRun") === "1";
  const forcedReportDayKey = searchParams.get("date");

  if (dryRun) {
    const reportDayKey = resolveBangkokDayKey(forcedReportDayKey ?? undefined);
    const [summary, recipients] = await Promise.all([
      buildLineDailySummary(reportDayKey),
      resolveConfiguredLineRecipients(settings.targetMode),
    ]);

    return Response.json({
      ok: true,
      dryRun: true,
      reportDayKey: summary.reportDayKey,
      settings,
      recipientCount: recipients.recipientIds.length,
      recipients: recipients.recipientIds,
      missingDeliveryEnv: [...config.missingDeliveryEnv, ...recipients.missingDeliveryEnv],
      message: summary.message,
    });
  }

  const scheduleCheck = shouldSendLineDailySummaryNow(settings, new Date());
  if (!scheduleCheck.ok) {
    return Response.json({
      ok: true,
      skipped: true,
      reason: scheduleCheck.reason,
      settings,
    });
  }

  const reportDayKey = scheduleCheck.reportDayKey;

  const result = await deliverLineDailySummary({
    reportDayKey,
    dispatchKind: LineDailySummaryDispatchKind.SCHEDULED,
    targetMode: settings.targetMode,
  });

  if (!result.ok && result.status === "SKIPPED") {
    return Response.json({
      ok: true,
      skipped: true,
      reason: result.reason,
      reportDayKey: result.reportDayKey,
    });
  }

  if (!result.ok) {
    return Response.json(
      {
        ok: false,
        error: result.reason,
        reportDayKey: result.reportDayKey,
        missingDeliveryEnv: result.missingDeliveryEnv ?? [],
      },
      { status: 503 }
    );
  }

  return Response.json({
    ok: true,
    reportDayKey: result.reportDayKey,
    sentCount: result.sentCount,
    recipientIds: result.recipientIds,
  });
}
