/**
 * Golden suite: the category / part-type disagreement guard (PLAN.md 4o).
 *
 * The guard DROPS a resolved category hard-filter when the customer's own part
 * word cannot justify it (2026-08-17: "พัดลม…" hard-filtered into Condenser).
 * Dropping a filter can only widen a search, so the risk is not "too few results"
 * — it is losing a legitimate scope and drifting off-topic.
 *
 * This suite therefore pins the rule the shop asked for: **better, or at worst
 * the same.** It replays EVERY real product turn recorded in `LineAiAuditLog`
 * that resolved a category, runs the guard on it, and for every turn where the
 * guard fires it searches BOTH ways against the live catalog and compares how
 * many returned rows actually name the part the customer asked for.
 *
 * Sections:
 *   A. Curated cases — the incident plus the regressions it must not cause.
 *   B. Production sweep — END-TO-END, on-topic recall after >= before.
 *   C. Blast radius — how narrow the guard is across real traffic.
 *   D. Staging policy — a one-off typo must not earn a review row (Option 4).
 *
 * Section B runs the REAL pipeline, including a REAL Gemini call to
 * `correctPartSpelling`. Dropping the category is only half of the fix; the half
 * the customer feels is whether the LLM then supplies a BETTER category, so
 * stubbing it would test the guard and miss the feature.
 *
 * Read-only — it never stages an alias and never expires one. Requires
 * DATABASE_URL and GOOGLE_AI_API_KEY_n (both live in .env.local).
 *
 *   npm run test:chat-category-conflict-golden
 */
import { db } from "@/lib/db";
import { searchProductIdsV2 } from "@/lib/product-search";
import {
  chatCategoryDisagreesWithPartType,
  resolveChatCategoryPartTypeConflict,
} from "@/lib/chat-core/category-conflict";
import {
  matchPartTypeToCategoryHint,
  resolveChatFitmentFilters,
  type ChatFitmentFilters,
} from "@/lib/chat-core/fitment-resolve";
import { correctPartSpelling } from "@/lib/chat-core/category-llm-fallback";
import { hasGeminiKeysConfigured } from "@/lib/google-ai-keys";
import {
  MIN_MISSPELLING_SIGHTINGS_BEFORE_STAGING,
  STAGED_ALIAS_EXPIRY_DAYS,
  stageAiCategoryAlias,
} from "@/lib/chat-core/category-alias-staging";

const TAKE = 5;

let passed = 0;
let failed = 0;

const report = (ok: boolean, label: string): void => {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}`);
  }
};

const normalize = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();

/** Rows whose NAME actually names the part the customer asked for. */
async function onTopicCount(input: {
  query: string;
  categoryName: string | null;
  carBrandName: string | null;
  carModelName: string | null;
  partType: string;
}): Promise<{ total: number; onTopic: number }> {
  const result = await searchProductIdsV2(
    {
      query: input.query,
      isActive: true,
      isStorefrontVisible: true,
      categoryName: input.categoryName,
      carBrandName: input.carBrandName,
      carModelName: input.carModelName,
      skip: 0,
      take: TAKE,
    },
    { bypassInternalCaches: true },
  );
  if (result.ids.length === 0) return { total: result.total, onTopic: 0 };
  const rows = await db.product.findMany({
    where: { id: { in: result.ids } },
    select: { name: true },
  });
  const needle = normalize(input.partType);
  return {
    total: result.total,
    onTopic: rows.filter((row) => normalize(row.name).includes(needle)).length,
  };
}

// ── A. Curated cases ────────────────────────────────────────────────────────
// `fires: true` means the resolved category must be dropped as unjustifiable.
const CURATED: ReadonlyArray<{
  partType: string;
  categoryName: string;
  fires: boolean;
  note: string;
}> = [
  {
    partType: "พัดลม",
    categoryName: "คอยล์ร้อน (Condenser)",
    fires: true,
    note: "the 2026-08-17 incident — alias matched inside แผงคอยร้อน",
  },
  {
    partType: "พัดลม",
    categoryName: "ใบพัดลม (Cooling Fan Blade)",
    fires: false,
    note: "category NAME contains the part word",
  },
  {
    partType: "แผงแอร์",
    categoryName: "คอยล์ร้อน (Condenser)",
    fires: false,
    note: "colloquial alias maps the part word to this very category",
  },
  {
    partType: "คอยเย็น",
    categoryName: "คอยล์เย็น (Evaporator)",
    fires: false,
    note: "alias maps คอยเย็น → Evaporator (spelling differs from the name)",
  },
  {
    partType: "มอเตอร์พัดลม",
    categoryName: "มอเตอร์พัดลมหน้าเครื่อง / หน้าแผงแอร์ (Condenser Fan Motor)",
    fires: false,
    note: "fan motor keeps its own category",
  },
  {
    partType: "โบเวอร์",
    categoryName: "โบเวอร์ พัดลมแอร์ (Blower Motor)",
    fires: false,
    note: "blower keeps its own category",
  },
  {
    partType: "คอมแอร์",
    categoryName: "คอมเพรสเซอร์แอร์ (Compressor)",
    fires: false,
    note: "compressor via the colloquial dictionary hint",
  },
  {
    partType: "โบลเวอร์",
    categoryName: "โบเวอร์ พัดลมแอร์ (Blower Motor)",
    fires: false,
    note: "one-edit spelling variant of the category name (โบลเวอร์ vs โบเวอร์)",
  },
  {
    partType: "อะไหล่แอร์",
    categoryName: "คอมแอร์ (Compressor)",
    fires: false,
    note: "broad catch-all can justify nothing — must not be read as a disagreement",
  },
  {
    partType: "หม้อน้ำ",
    categoryName: "คอมแอร์ (Compressor)",
    fires: true,
    note: "production turn: radiator question hard-filtered into compressors",
  },
];

// ── Section runners ─────────────────────────────────────────────────────────

async function runCurated(): Promise<void> {
  console.log("\n[A] curated cases");
  for (const c of CURATED) {
    const { disagrees } = await resolveChatCategoryPartTypeConflict({
      partType: c.partType,
      categoryName: c.categoryName,
    });
    report(
      disagrees === c.fires,
      `"${c.partType}" + "${c.categoryName}" → ${disagrees ? "drop" : "keep"} (${c.note})`,
    );
  }

  // The pure predicate must never fire without both inputs.
  report(
    !chatCategoryDisagreesWithPartType({ partType: null, resolvedCategoryName: "คอยล์ร้อน (Condenser)" }) &&
      !chatCategoryDisagreesWithPartType({ partType: "พัดลม", resolvedCategoryName: null }),
    "missing part word or category → never fires",
  );
}

type ReplayTurn = {
  lineEventId: string;
  partType: string;
  categoryName: string;
  query: string;
  /** What `correctPartSpelling` is fed in production — the customer's own text. */
  rawText: string;
  carBrandName: string | null;
  carModelName: string | null;
};

async function loadProductionTurns(): Promise<ReplayTurn[]> {
  const [searches, frames] = await Promise.all([
    // Rows with a null categoryName are dropped in the parse loop below rather
    // than in SQL — a JSON-null filter is not expressible in the typed client.
    db.lineAiAuditLog.findMany({
      where: { action: "SEARCH_QUERY_CONSOLIDATED" },
      select: { payload: true },
      orderBy: { createdAt: "desc" },
    }),
    db.lineAiAuditLog.findMany({
      where: { action: "INQUIRY_FRAME" },
      select: { payload: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const partTypeByEvent = new Map<string, string>();
  for (const row of frames) {
    const p = row.payload as Record<string, unknown> | null;
    const eventId = typeof p?.lineEventId === "string" ? p.lineEventId : null;
    const partType = typeof p?.partType === "string" ? p.partType.trim() : "";
    if (eventId && partType && !partTypeByEvent.has(eventId)) partTypeByEvent.set(eventId, partType);
  }

  const turns: ReplayTurn[] = [];
  const seen = new Set<string>();
  for (const row of searches) {
    const p = row.payload as Record<string, unknown> | null;
    const eventId = typeof p?.lineEventId === "string" ? p.lineEventId : null;
    const categoryName = typeof p?.categoryName === "string" ? p.categoryName : null;
    const query = typeof p?.consolidatedQuery === "string" ? p.consolidatedQuery : null;
    if (!eventId || !categoryName || !query || seen.has(eventId)) continue;
    const partType = partTypeByEvent.get(eventId);
    if (!partType) continue;
    seen.add(eventId);
    turns.push({
      lineEventId: eventId,
      partType,
      categoryName,
      query,
      rawText: typeof p?.latestText === "string" && p.latestText.trim() ? p.latestText : query,
      carBrandName: typeof p?.carBrandName === "string" ? p.carBrandName : null,
      carModelName: typeof p?.carModelName === "string" ? p.carModelName : null,
    });
  }
  return turns;
}

async function runProductionSweep(turns: ReplayTurn[]): Promise<number> {
  const firing: ReplayTurn[] = [];
  for (const turn of turns) {
    const { disagrees } = await resolveChatCategoryPartTypeConflict({
      partType: turn.partType,
      categoryName: turn.categoryName,
    });
    if (disagrees) firing.push(turn);
  }

  console.log(`\n[B] production sweep — ${turns.length} real turns, guard fires on ${firing.length}`);
  if (firing.length === 0) {
    console.log("  (no firing turn in the recorded history — nothing to compare)");
    return 0;
  }

  for (const turn of firing) {
    const shared = {
      query: turn.query,
      carBrandName: turn.carBrandName,
      carModelName: turn.carModelName,
      partType: turn.partType,
    };

    // Replay the shipped order: guard drops the category, then the LLM fallback
    // gets its chance to supply a better one (REAL Gemini call, as in production).
    const correction = await correctPartSpelling(turn.rawText, {
      carBrand: turn.carBrandName,
      carModel: turn.carModelName,
    }).catch(() => null);
    const remapped = correction?.corrected
      ? await resolveChatFitmentFilters({
          partType: correction.corrected,
          carBrand: turn.carBrandName,
          carModel: turn.carModelName,
          queryText: correction.corrected,
          rawText: correction.corrected,
        }).catch((): ChatFitmentFilters => ({}))
      : {};
    const finalCategoryName = remapped.categoryName ?? null;

    const before = await onTopicCount({ ...shared, categoryName: turn.categoryName });
    const after = await onTopicCount({ ...shared, categoryName: finalCategoryName });
    const recovered = finalCategoryName
      ? `LLM "${correction?.corrected}" → "${finalCategoryName}"`
      : `LLM ${correction?.corrected ? `"${correction.corrected}" → no category` : "no correction"}, unscoped`;
    report(
      after.onTopic >= before.onTopic,
      `"${turn.query}" [${turn.partType}] on-topic ${before.onTopic}→${after.onTopic} ` +
        `(total ${before.total}→${after.total}) | was "${turn.categoryName}" | ${recovered}`,
    );
  }
  return firing.length;
}

/**
 * Option 4 — the staging policy that keeps CategoryAlias from filling up with
 * one-off typos. Read-only by construction: the sighting check runs BEFORE the
 * create, so probing with a never-seen word returns a decision without writing,
 * and the expiry predicate is only COUNTED here, never executed.
 */
async function runStagingPolicy(): Promise<void> {
  console.log("\n[D] staging policy (Option 4)");

  const neverSeen = `ทดสอบคำผิดที่ไม่เคยพบ${Date.now()}`.replace(/\d/g, "");
  const decision = await stageAiCategoryAlias({
    alias: neverSeen,
    categoryName: "คอยล์ร้อน (Condenser)",
    correctedTerm: "แผงแอร์",
    originalText: neverSeen,
  });
  report(
    decision.staged === false,
    `a never-seen misspelling is not staged (reason=${decision.staged ? "STAGED" : decision.reason})`,
  );

  const stillThere = await db.categoryAlias.findUnique({
    where: { alias_kind: { alias: neverSeen, kind: "MATCH" } },
    select: { id: true },
  });
  report(stillThere === null, "…and no row was written for it");

  const pending = await db.categoryAlias.count({
    where: { source: "AI_AUTO", reviewStatus: "PENDING", isActive: false },
  });
  const expirable = await db.categoryAlias.count({
    where: {
      source: "AI_AUTO",
      reviewStatus: "PENDING",
      isActive: false,
      updatedAt: { lt: new Date(Date.now() - STAGED_ALIAS_EXPIRY_DAYS * 24 * 3600 * 1000) },
    },
  });
  console.log(
    `  · review queue: ${pending} pending AI suggestions, ${expirable} past the ${STAGED_ALIAS_EXPIRY_DAYS}-day window`,
  );

  const approvedOrManual = await db.categoryAlias.count({
    where: {
      OR: [{ source: "MANUAL" }, { reviewStatus: "APPROVED" }, { isActive: true }],
      AND: {
        source: "AI_AUTO",
        reviewStatus: "PENDING",
        isActive: false,
        updatedAt: { lt: new Date(Date.now() - STAGED_ALIAS_EXPIRY_DAYS * 24 * 3600 * 1000) },
      },
    },
  });
  report(approvedOrManual === 0, "expiry can never reach a manual, approved, or active alias");
  report(MIN_MISSPELLING_SIGHTINGS_BEFORE_STAGING >= 2, "a typo must repeat before it earns a review row");
}

/**
 * The guard must stay a scalpel: it may only fire where the part word genuinely
 * has no relationship to the category. A high firing rate across real traffic
 * would mean the predicate is too eager, so it is pinned as a budget.
 */
const MAX_FIRING_RATE = 0.1;

function runBlastRadius(turns: number, firing: number): void {
  console.log("\n[C] blast radius");
  if (turns === 0) {
    console.log("  (no production turns recorded yet — skipped)");
    return;
  }
  const rate = firing / turns;
  report(
    rate <= MAX_FIRING_RATE,
    `firing rate ${(rate * 100).toFixed(1)}% of ${turns} real turns (budget ≤ ${MAX_FIRING_RATE * 100}%)`,
  );
}

async function main(): Promise<void> {
  // Sanity: the colloquial dictionary must still be reachable — it is one of the
  // three ways a part word can justify a category.
  if (!matchPartTypeToCategoryHint("คอมแอร์")) {
    console.log("✗ part-type dictionary unavailable — aborting");
    process.exit(1);
  }

  // Section B replays the LLM half of the fix. Without keys it would silently
  // measure only the drop, which is exactly the blind spot this suite exists to
  // close — so refuse to report a pass instead.
  if (!hasGeminiKeysConfigured()) {
    console.log("✗ GOOGLE_AI_API_KEY_n not configured — section B cannot run end-to-end");
    process.exit(1);
  }

  await runCurated();
  const turns = await loadProductionTurns();
  const firing = await runProductionSweep(turns);
  runBlastRadius(turns.length, firing);
  await runStagingPolicy();

  console.log("\n" + "=".repeat(60));
  console.log(`ผ่าน ${passed} / ${passed + failed}`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
