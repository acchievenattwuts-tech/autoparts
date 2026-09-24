export const dynamic = "force-dynamic";

import { ProfitExplanationStatus } from "@/lib/generated/prisma";
import {
  getProfitDashboardData,
  resolveProfitDashboardFilters,
  type ProfitRevenueBasis,
} from "@/lib/profit-dashboard";
import { buildProfitExplanationEvidence } from "@/lib/profit-explanation/evidence";
import {
  createProfitExplanationHistory,
  listRecentProfitExplanationHistory,
  pruneExpiredProfitExplanationHistory,
} from "@/lib/profit-explanation/history";
import { generateProfitExplanation } from "@/lib/profit-explanation/service";
import { checkRateLimit } from "@/lib/rate-limit";
import { requirePermission } from "@/lib/require-auth";
import { isDateOnlyString } from "@/lib/th-date";
import { z } from "zod";

/** Missing, null and blank values mean "not given", so the dashboard defaults apply as before. */
const blankToUndefined = (value: unknown): unknown => {
  if (value === null) return undefined;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

// isDateOnlyString = YYYY-MM-DD that parses (Thailand offset) to a valid Date.
const dateOnlySchema = z.preprocess(
  blankToUndefined,
  z.string().refine((value) => isDateOnlyString(value)).optional(),
);

/** Shared by GET (query string) and POST (JSON body). */
const profitExplanationFiltersSchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
  basis: z.preprocess(blankToUndefined, z.enum(["ex_vat", "inc_vat"]).default("ex_vat")),
});

type ProfitExplanationFilters = {
  from?: string;
  to?: string;
  basis: ProfitRevenueBasis;
};

function parseFilters(input: Record<string, unknown> | URLSearchParams): ProfitExplanationFilters | null {
  const get = (key: string): unknown => (input instanceof URLSearchParams ? input.get(key) : input[key]);
  const parsed = profitExplanationFiltersSchema.safeParse({
    from: get("from"),
    to: get("to"),
    basis: get("basis"),
  });
  return parsed.success ? parsed.data : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidFiltersResponse(): Response {
  return Response.json({ error: "PROFIT_EXPLANATION_INVALID_FILTERS" }, { status: 400 });
}

const MAX_ERROR_MESSAGE_LENGTH = 500;

/** Each POST computes the dashboard and calls Gemini, so it is capped per user. GET (history) is not. */
const GENERATE_RATE_LIMIT_MAX_REQUESTS = 5;
const GENERATE_RATE_LIMIT_WINDOW_MS = 10 * 60_000;
const MS_PER_SECOND = 1000;

function rateLimitedResponse(resetAt: number): Response {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - Date.now()) / MS_PER_SECOND));
  return Response.json(
    { error: "PROFIT_EXPLANATION_RATE_LIMITED", retryAfterSeconds },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

/** Housekeeping only: a failed prune must not fail reading or creating history. */
async function pruneExpiredHistoryBestEffort(): Promise<void> {
  try {
    await pruneExpiredProfitExplanationHistory();
  } catch (error) {
    console.error("[profit-explanation] pruning expired history failed", error);
  }
}

function statusForError(error: unknown): number {
  if (error instanceof Error && error.message === "UNAUTHORIZED") return 401;
  if (error instanceof Error && error.message === "FORBIDDEN") return 403;
  return 500;
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requirePermission("dashboard.view");
    await pruneExpiredHistoryBestEffort();

    // Only the normalized filters are needed to find history rows; this is the
    // same resolver getProfitDashboardData() applies, without computing the
    // whole dashboard.
    const url = new URL(request.url);
    const input = parseFilters(url.searchParams);
    if (!input) return invalidFiltersResponse();
    const filters = resolveProfitDashboardFilters(input);
    const items = await listRecentProfitExplanationHistory({
      filters,
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
    const body: unknown = await request.json().catch(() => ({}));
    const input = isPlainObject(body) ? parseFilters(body) : null;
    if (!input) return invalidFiltersResponse();
    // Checked before the dashboard aggregate and the Gemini call; invalid
    // filters (400 above) do not consume the user's quota.
    const rate = await checkRateLimit({
      key: `profit-explanation:${session.user.id}`,
      limit: GENERATE_RATE_LIMIT_MAX_REQUESTS,
      windowMs: GENERATE_RATE_LIMIT_WINDOW_MS,
    });
    if (!rate.ok) return rateLimitedResponse(rate.resetAt);
    const data = await getProfitDashboardData(input);
    const evidence = buildProfitExplanationEvidence(data);
    const generated = await generateProfitExplanation(evidence);

    await pruneExpiredHistoryBestEffort();
    // SUCCESS only when the AI answer was actually used; an answer that failed
    // parsing/validation (fallback shown instead) is recorded as FAILED.
    const succeeded = Boolean(generated.keyRef) && generated.rejectionReason === null;
    const history = await createProfitExplanationHistory({
      filters: data.filters,
      requestedById: session.user.id,
      evidence,
      result: generated.result,
      keyRef: generated.keyRef,
      status: succeeded ? ProfitExplanationStatus.SUCCESS : ProfitExplanationStatus.FAILED,
      errorCode: !generated.keyRef ? "AI_UNAVAILABLE_OR_FALLBACK" : succeeded ? null : "AI_RESPONSE_REJECTED",
      errorMessage: generated.rejectionReason?.slice(0, MAX_ERROR_MESSAGE_LENGTH) ?? null,
    });

    return Response.json({
      explanation: generated.result,
      historyId: history.id,
    });
  } catch (error) {
    return Response.json({ error: "PROFIT_EXPLANATION_FAILED" }, { status: statusForError(error) });
  }
}
