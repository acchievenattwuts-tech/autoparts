export const dynamic = "force-dynamic";

import { ProfitExplanationStatus } from "@/lib/generated/prisma";
import { getProfitDashboardData, type ProfitRevenueBasis } from "@/lib/profit-dashboard";
import { buildProfitExplanationEvidence } from "@/lib/profit-explanation/evidence";
import {
  createProfitExplanationHistory,
  listRecentProfitExplanationHistory,
  pruneExpiredProfitExplanationHistory,
} from "@/lib/profit-explanation/history";
import { generateProfitExplanation } from "@/lib/profit-explanation/service";
import { requirePermission } from "@/lib/require-auth";

function parseBasis(value: unknown): ProfitRevenueBasis {
  return value === "inc_vat" ? "inc_vat" : "ex_vat";
}

function parseFilters(input: Record<string, unknown> | URLSearchParams): {
  from?: string;
  to?: string;
  basis: ProfitRevenueBasis;
} {
  const get = (key: string): unknown => (input instanceof URLSearchParams ? input.get(key) : input[key]);
  const from = get("from");
  const to = get("to");

  return {
    from: typeof from === "string" && from.trim() ? from.trim() : undefined,
    to: typeof to === "string" && to.trim() ? to.trim() : undefined,
    basis: parseBasis(get("basis")),
  };
}

function statusForError(error: unknown): number {
  if (error instanceof Error && error.message === "UNAUTHORIZED") return 401;
  if (error instanceof Error && error.message === "FORBIDDEN") return 403;
  return 500;
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requirePermission("dashboard.view");
    await pruneExpiredProfitExplanationHistory();

    const url = new URL(request.url);
    const data = await getProfitDashboardData(parseFilters(url.searchParams));
    const items = await listRecentProfitExplanationHistory({
      filters: data.filters,
      take: 5,
    });

    return Response.json({ items });
  } catch (error) {
    return Response.json({ error: "PROFIT_EXPLANATION_HISTORY_FAILED" }, { status: statusForError(error) });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const session = await requirePermission("dashboard.view");
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const data = await getProfitDashboardData(parseFilters(body));
    const evidence = buildProfitExplanationEvidence(data);
    const generated = await generateProfitExplanation(evidence);

    await pruneExpiredProfitExplanationHistory();
    const history = await createProfitExplanationHistory({
      filters: data.filters,
      requestedById: session.user.id,
      evidence,
      result: generated.result,
      keyRef: generated.keyRef,
      status: generated.keyRef ? ProfitExplanationStatus.SUCCESS : ProfitExplanationStatus.FAILED,
      errorCode: generated.keyRef ? null : "AI_UNAVAILABLE_OR_FALLBACK",
    });

    return Response.json({
      explanation: generated.result,
      historyId: history.id,
    });
  } catch (error) {
    return Response.json({ error: "PROFIT_EXPLANATION_FAILED" }, { status: statusForError(error) });
  }
}
