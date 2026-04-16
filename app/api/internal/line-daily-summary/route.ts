export const dynamic = "force-dynamic";

import type { NextRequest } from "next/server";
import {
  LineDailySummaryDispatchKind,
  LineDailySummaryDispatchStatus,
  LineDailySummaryTargetMode,
} from "@/lib/generated/prisma";
import { resolveBangkokDayKey } from "@/lib/line-daily-summary";
import {
  deliverLineDailySummary,
} from "@/lib/line-daily-summary-delivery";
import {
  getLineDailySummarySettings,
  shouldSendLineDailySummaryNow,
} from "@/lib/line-daily-summary-settings";
import {
  getLineDailySummaryQStashStatus,
  verifyLineDailySummaryQStashSignature,
} from "@/lib/line-daily-summary-qstash";
import { db } from "@/lib/db";

function unauthorizedResponse() {
  return Response.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
}

function formatSchedulerErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown scheduler error";
  return `UNHANDLED_EXCEPTION:${message}`.slice(0, 1000);
}

async function handleScheduledSummary(request: NextRequest) {
  const qstashStatus = getLineDailySummaryQStashStatus();

  if (!qstashStatus.ready) {
    return Response.json(
      { ok: false, error: "QSTASH is not configured" },
      { status: 503 }
    );
  }

  const signature = request.headers.get("upstash-signature");
  if (!signature) {
    return unauthorizedResponse();
  }

  const rawBody = await request.text();
  const isValidSignature = await verifyLineDailySummaryQStashSignature({
    signature,
    body: rawBody,
    url: request.url,
  }).catch(() => false);

  if (!isValidSignature) {
    return unauthorizedResponse();
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
        errorMessage: "QSTASH_INVOKED",
      },
    });
    dispatchId = dispatch.id;

    await db.lineDailySummaryDispatch.update({
      where: { id: dispatchId },
      data: {
        targetMode: settings.targetMode,
        errorMessage: "QSTASH_INVOKED",
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
            errorMessage: formatSchedulerErrorMessage(error),
          },
        })
        .catch(() => undefined);
    }

    return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown scheduler error",
          reportDayKey,
        },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return handleScheduledSummary(request);
}

export async function GET() {
  return Response.json(
    { ok: false, error: "METHOD_NOT_ALLOWED" },
    { status: 405 }
  );
}
