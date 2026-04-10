export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import { buildLineDailySummary, resolveBangkokDayKey } from "@/lib/line-daily-summary";
import { getLineDailySummaryConfig, pushLineTextMessage } from "@/lib/line-messaging";

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
  const reportDayKey = resolveBangkokDayKey(searchParams.get("date") ?? undefined);
  const dryRun = searchParams.get("dryRun") === "1";
  const summary = await buildLineDailySummary(reportDayKey);

  if (dryRun) {
    return Response.json({
      ok: true,
      dryRun: true,
      reportDayKey: summary.reportDayKey,
      recipientCount: config.recipientIds.length,
      missingDeliveryEnv: config.missingDeliveryEnv,
      message: summary.message,
    });
  }

  if (config.missingDeliveryEnv.length > 0 || !config.channelAccessToken) {
    return Response.json(
      {
        ok: false,
        error: "LINE delivery config is incomplete",
        missingDeliveryEnv: config.missingDeliveryEnv,
      },
      { status: 503 }
    );
  }

  const result = await pushLineTextMessage({
    channelAccessToken: config.channelAccessToken,
    recipientIds: config.recipientIds,
    text: summary.message,
  });

  return Response.json({
    ok: true,
    reportDayKey: summary.reportDayKey,
    sentCount: result.sentCount,
    recipientIds: result.recipientIds,
  });
}
