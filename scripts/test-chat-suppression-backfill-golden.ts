/**
 * Golden suite: a suppressed product must never cost the customer a display slot.
 *
 * The vehicle-compatibility filter runs AFTER the search page is cut. Before this
 * fix the page was cut to the display limit first, so every product the filter
 * removed left a permanently empty slot in the reply.
 *
 * Production 2026-08-17 (conv cmr3dp2uf, "มีคอยล์เย็น d-max 1.9 ของครูเกียร์ไหมครับ"):
 * 7 matches → page cut to 5 → 2 removed as `wrong_engine` → the customer saw 3,
 * while two valid Cool Gear evaporators sat unused at rank 6 and 7.
 *
 * Two properties are pinned, and the second matters as much as the first:
 *   A. Backfill — when the filter suppresses, the freed slots are refilled from
 *      the next ranked products, up to the display limit.
 *   B. No-op safety — a turn where nothing is suppressed produces EXACTLY the same
 *      products, in the same order, as fetching only the display limit would.
 *      Over-fetching must be invisible unless suppression actually happens.
 *
 * Section B replays every real product turn recorded in LineAiAuditLog, so the
 * guarantee is measured against production traffic rather than asserted.
 *
 * Read-only. Requires DATABASE_URL.
 *
 *   npm run test:chat-suppression-backfill-golden
 */
import { db } from "@/lib/db";
import { searchProductIdsV2 } from "@/lib/product-search";
import {
  CHAT_PRODUCT_DISPLAY_LIMIT,
  CHAT_PRODUCT_FETCH_LIMIT,
  getChatProductSummaries,
} from "@/lib/chat-core/product-search-bridge";
import { filterChatProductsByVehicleCompatibility } from "@/lib/chat-core/product-compatibility";

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

type Turn = {
  query: string;
  customerText: string;
  categoryName: string | null;
  carBrandName: string | null;
  carModelName: string | null;
};

/** Runs the real search + compatibility filter at a given page size. */
async function shownProducts(turn: Turn, take: number): Promise<{ codes: string[]; suppressed: number; total: number }> {
  const result = await searchProductIdsV2(
    {
      query: turn.query,
      isActive: true,
      isStorefrontVisible: true,
      categoryName: turn.categoryName,
      carBrandName: turn.carBrandName,
      carModelName: turn.carModelName,
      skip: 0,
      take,
    },
    { bypassInternalCaches: true },
  );
  const summaries = await getChatProductSummaries(result.ids).catch(() => []);
  const compatibility = filterChatProductsByVehicleCompatibility({
    products: summaries,
    customerText: turn.customerText,
    carBrandName: turn.carBrandName ?? undefined,
    carModelName: turn.carModelName ?? undefined,
  });
  const shown = compatibility.products.slice(0, CHAT_PRODUCT_DISPLAY_LIMIT);
  const rows = await db.product.findMany({
    where: { id: { in: shown.map((p) => p.id) } },
    select: { id: true, code: true },
  });
  const codeById = new Map(rows.map((r) => [r.id, r.code ?? r.id]));
  return {
    codes: shown.map((p) => codeById.get(p.id) ?? p.id),
    suppressed: compatibility.suppressed.length,
    total: result.total,
  };
}

const INCIDENT: Turn = {
  query: "คอยล์เย็น d-max 1.9",
  customerText: "สอบถามหน่อยครับมีคอยล์เย็น d-max 1.9 ของครูเกียร์ไหมครับ",
  categoryName: "คอยล์เย็น (Evaporator)",
  carBrandName: "Isuzu",
  carModelName: "D-Max",
};

async function runIncident(): Promise<void> {
  console.log("\n[A] the 2026-08-17 incident — suppressed slots must be refilled");
  const before = await shownProducts(INCIDENT, CHAT_PRODUCT_DISPLAY_LIMIT);
  const after = await shownProducts(INCIDENT, CHAT_PRODUCT_FETCH_LIMIT);

  console.log(`  total matches: ${after.total}, suppressed: ${after.suppressed}`);
  console.log(`  old (fetch ${CHAT_PRODUCT_DISPLAY_LIMIT}): ${before.codes.join(", ")}`);
  console.log(`  new (fetch ${CHAT_PRODUCT_FETCH_LIMIT}): ${after.codes.join(", ")}`);

  report(after.suppressed > 0, `the compatibility filter really suppresses here (${after.suppressed})`);
  report(
    after.codes.length > before.codes.length,
    `customer sees more products than before (${before.codes.length} → ${after.codes.length})`,
  );
  report(
    after.codes.length === Math.min(CHAT_PRODUCT_DISPLAY_LIMIT, after.total - after.suppressed),
    `every available display slot is used (${after.codes.length}/${CHAT_PRODUCT_DISPLAY_LIMIT})`,
  );
  report(
    before.codes.every((code) => after.codes.includes(code)),
    "nothing that used to be shown disappeared",
  );
  report(
    after.codes.includes("P0317"),
    "P0317 (rank 6, Cool Gear) is now shown — the product the shop asked about",
  );
}

async function loadProductionTurns(): Promise<Turn[]> {
  const rows = await db.lineAiAuditLog.findMany({
    where: { action: "SEARCH_QUERY_CONSOLIDATED" },
    select: { payload: true },
    orderBy: { createdAt: "desc" },
  });
  const turns: Turn[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const p = row.payload as Record<string, unknown> | null;
    const id = typeof p?.lineEventId === "string" ? p.lineEventId : null;
    const query = typeof p?.consolidatedQuery === "string" ? p.consolidatedQuery : null;
    if (!id || !query || seen.has(id)) continue;
    seen.add(id);
    turns.push({
      query,
      customerText: typeof p?.latestText === "string" ? p.latestText : query,
      categoryName: typeof p?.categoryName === "string" ? p.categoryName : null,
      carBrandName: typeof p?.carBrandName === "string" ? p.carBrandName : null,
      carModelName: typeof p?.carModelName === "string" ? p.carModelName : null,
    });
  }
  return turns;
}

async function runNoOpSafety(turns: Turn[]): Promise<void> {
  console.log(`\n[B] no-op safety — replaying ${turns.length} real turns`);
  let unchanged = 0;
  let improved = 0;
  const regressions: string[] = [];

  for (const turn of turns) {
    const before = await shownProducts(turn, CHAT_PRODUCT_DISPLAY_LIMIT);
    const after = await shownProducts(turn, CHAT_PRODUCT_FETCH_LIMIT);

    if (after.suppressed === 0) {
      // Nothing was filtered: the two runs MUST be identical, order included.
      if (before.codes.join("|") === after.codes.join("|")) unchanged += 1;
      else regressions.push(`[no-suppression drift] "${turn.query}" ${before.codes.join(",")} → ${after.codes.join(",")}`);
      continue;
    }
    // Something was filtered: nothing may vanish, and slots should be refilled.
    const lost = before.codes.filter((code) => !after.codes.includes(code));
    if (lost.length > 0) {
      regressions.push(`[lost rows] "${turn.query}" missing ${lost.join(",")}`);
    } else if (after.codes.length > before.codes.length) {
      improved += 1;
      console.log(
        `  + "${turn.query.slice(0, 46)}" ${before.codes.length}→${after.codes.length} (${after.codes.join(", ")})`,
      );
    } else {
      unchanged += 1;
    }
  }

  report(regressions.length === 0, `no turn lost a product or drifted (${regressions.length} problem(s))`);
  for (const line of regressions.slice(0, 10)) console.log(`    ! ${line}`);
  console.log(`  unchanged: ${unchanged}   improved: ${improved}`);
  report(improved > 0, `at least one real turn now shows more products (${improved})`);
}

async function main(): Promise<void> {
  report(
    CHAT_PRODUCT_FETCH_LIMIT > CHAT_PRODUCT_DISPLAY_LIMIT,
    `fetch limit (${CHAT_PRODUCT_FETCH_LIMIT}) leaves headroom over display limit (${CHAT_PRODUCT_DISPLAY_LIMIT})`,
  );
  await runIncident();
  await runNoOpSafety(await loadProductionTurns());

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
