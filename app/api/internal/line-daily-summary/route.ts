export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import {
  LineDailySummaryDispatchKind,
  LineDailySummaryDispatchStatus,
  LineDailySummaryTargetMode,
} from "@/lib/generated/prisma";
import { buildLineDailySummary, resolveBangkokDayKey } from "@/lib/line-daily-summary";
import {
  deliverLineDailySummary,
} from "@/lib/line-daily-summary-delivery";
import {
  getLineDailySummarySettings,
  shouldSendLineDailySummaryNow,
} from "@/lib/line-daily-summary-settings";
import { getLineDailySummaryConfig, resolveConfiguredLineRecipients } from "@/lib/line-messaging";
import { db } from "@/lib/db";

function unauthorizedResponse() {
  return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
}

function formatCronErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown cron error";
  return `UNHANDLED_EXCEPTION:${message}`.slice(0, 1000);
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
  const dryRun = searchParams.get("dryRun") === "1";
  const forcedReportDayKey = searchParams.get("date");

  if (dryRun) {
    const settings = await getLineDailySummarySettings();
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

  const reportDayKey = resolveBangkokDayKey();
  let dispatchId: string | null = null;

  try {
    const settings = await getLineDailySummarySettings();
    const scheduleCheck = shouldSendLineDailySummaryNow(settings, new Date());

    if (!scheduleCheck.ok && scheduleCheck.reason === "TOO_EARLY") {
      return Response.json({
        ok: true,
        skipped: true,
        reason: scheduleCheck.reason,
        reportDayKey,
        settings,
      });
    }

    const dispatch = await db.lineDailySummaryDispatch.create({
      data: {
        reportDayKey,
        dispatchKind: LineDailySummaryDispatchKind.SCHEDULED,
        status: LineDailySummaryDispatchStatus.PROCESSING,
        targetMode: settings.targetMode ?? LineDailySummaryTargetMode.ENV_IDS,
        errorMessage: "CRON_INVOKED",
      },
    });
    dispatchId = dispatch.id;

    await db.lineDailySummaryDispatch.update({
      where: { id: dispatchId },
      data: {
        targetMode: settings.targetMode,
        errorMessage: "CRON_INVOKED",
      },
    });

    if (!scheduleCheck.ok) {
      await db.lineDailySummaryDispatch.update({
        where: { id: dispatchId },
        data: {
          status: LineDailySummaryDispatchStatus.SKIPPED,
          targetMode: settings.targetMode,
          errorMessage: scheduleCheck.reason,
        },
      });

      return Response.json({
        ok: true,
        skipped: true,
        reason: scheduleCheck.reason,
        reportDayKey,
        settings,
      });
    }

    const result = await deliverLineDailySummary({
      reportDayKey: scheduleCheck.reportDayKey,
      dispatchKind: LineDailySummaryDispatchKind.SCHEDULED,
      targetMode: settings.targetMode,
      existingDispatchId: dispatchId,
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
  } catch (error) {
    if (dispatchId) {
      await db.lineDailySummaryDispatch
        .update({
          where: { id: dispatchId },
          data: {
            status: LineDailySummaryDispatchStatus.FAILED,
            errorMessage: formatCronErrorMessage(error),
          },
        })
        .catch(() => undefined);
    }

    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown cron error",
        reportDayKey,
      },
      { status: 500 }
    );
  }
}
