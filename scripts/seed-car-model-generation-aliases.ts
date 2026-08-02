/**
 * Seeds "model + chassis/generation code" spellings into the existing
 * SearchSynonym model clusters (e.g. "jazz ge" → the Jazz cluster).
 *
 * Why, on top of the regex qualifier support in `lib/chat-core/fitment-resolve.ts`:
 * the resolver's DIRECT lookup runs before the qualifier grammar, so an explicit
 * row is the exact, fastest path and — unlike the regex — the shop can read and
 * edit it in Admin → ข้อมูลหลัก → คำพ้องการค้นหา. It also covers the one case the
 * regex must refuse: "D-Max TFR", where the code is itself a real Isuzu model.
 *
 * Every spelling below is grounded in this shop's own data (mined from product
 * names + inbound chat) or in the Thai market for a model the shop stocks.
 * Toyota is deliberately absent — Thai customers date a Toyota by year.
 *
 * Idempotent and additive: an existing cluster only ever gains missing spellings,
 * never loses one, and a cluster that does not exist is reported and skipped
 * rather than created (model clusters are master data the shop owns).
 *
 *   npm run seed:car-model-generation-aliases          # dry run, prints the plan
 *   npm run seed:car-model-generation-aliases -- --apply
 */
import { db } from "@/lib/db";
import { MAX_SYNONYMS_PER_TERM } from "@/lib/search-synonyms";

/** canonical cluster term → generation spellings to add to that cluster. */
const GENERATION_ALIASES: Record<string, string[]> = {
  // ── Honda — the generation IS the everyday name here ──────────────────────
  Jazz: ["jazz gd", "jazz ge", "jazz gk", "jazz gr"],
  City: ["city zx", "city gd", "city gm", "city gm2", "city gm6", "city gn"],
  Civic: ["civic es", "civic fd", "civic fb", "civic fc", "civic fe"],
  CRV: ["crv rd", "crv re", "crv rm"],
  Freed: ["freed gb3"],
  HRV: ["hrv ru"],
  BRV: ["brv dg"],
  Mobilio: ["mobilio dd"],
  // ── Nissan ────────────────────────────────────────────────────────────────
  Navara: ["navara d40", "navara d23"],
  NP300: ["np300 d23"],
  Frontier: ["frontier d22"],
  Teana: ["teana j31", "teana j32", "teana l33"],
  "X-Trail": ["x-trail t30", "x-trail t31", "x-trail t32"],
  Almera: ["almera n17"],
  March: ["march k13"],
  Note: ["note e12"],
  Urvan: ["urvan e25", "urvan e26"],
  Sylphy: ["sylphy b17"],
  // ── Mitsubishi ────────────────────────────────────────────────────────────
  Triton: ["triton ka4", "triton kb4", "triton kl"],
  "Pajero Sport": ["pajero sport kh4", "pajero sport ks"],
  Lancer: ["lancer ex", "lancer ck", "lancer cs"],
  // ── Ford ──────────────────────────────────────────────────────────────────
  Ranger: ["ranger t6", "ranger t8"],
  Everest: ["everest ua"],
  // ── Isuzu — "d-max tfr" is the case the regex must refuse (TFR is a model) ─
  "D-Max": ["d-max tfr", "d-max rt50", "d-max rg"],
  TFR: ["tfr m16"],
  // ── Mazda ─────────────────────────────────────────────────────────────────
  Mazda2: ["mazda2 de", "mazda2 dj"],
  Mazda3: ["mazda3 bk", "mazda3 bl", "mazda3 bm", "mazda3 bp"],
  "BT-50": ["bt-50 un", "bt-50 up"],
  "CX-5": ["cx-5 ke", "cx-5 kf"],
  // ── Chevrolet / Suzuki / Hyundai ──────────────────────────────────────────
  Colorado: ["colorado rc", "colorado rg"],
  Swift: ["swift zc"],
  "H-1": ["h-1 a1"],
};

type PlanRow = {
  term: string;
  added: string[];
  alreadyPresent: string[];
  /** Synonym count the row would end up with. */
  finalCount: number;
};

/**
 * `MAX_SYNONYMS_PER_TERM` is not just advice: the admin Server Action validates
 * it with Zod, so a row pushed past the cap can no longer be SAVED from Admin →
 * ข้อมูลหลัก → คำพ้องการค้นหา, and `expandQueryTokens` truncates a cluster at the
 * same limit, so the extra spellings would be dropped from product search
 * (the chat model resolver has no cap and would still see them). Writing past
 * the cap therefore trades an editable row for a half-working one — refuse it
 * unless the operator opts in explicitly.
 */
const OVER_CAP_FLAG = "--allow-over-cap";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const rows = await db.searchSynonym.findMany({
    where: { isActive: true },
    select: { id: true, term: true, synonyms: true },
  });
  const byTerm = new Map(rows.map((row) => [row.term.trim().toLowerCase(), row]));

  const plan: PlanRow[] = [];
  const missingClusters: string[] = [];

  for (const [term, aliases] of Object.entries(GENERATION_ALIASES)) {
    const row = byTerm.get(term.trim().toLowerCase());
    if (!row) {
      missingClusters.push(term);
      continue;
    }
    const existing = new Set(
      [row.term, ...(row.synonyms ?? [])].map((value) => value.trim().toLowerCase()),
    );
    const added = aliases.filter((alias) => !existing.has(alias.trim().toLowerCase()));
    const alreadyPresent = aliases.filter((alias) => existing.has(alias.trim().toLowerCase()));
    plan.push({
      term: row.term,
      added,
      alreadyPresent,
      finalCount: (row.synonyms ?? []).length + added.length,
    });
  }

  const allowOverCap = process.argv.includes(OVER_CAP_FLAG);
  const overCap = plan.filter((entry) => entry.added.length > 0 && entry.finalCount > MAX_SYNONYMS_PER_TERM);

  let totalAdded = 0;
  console.log(apply ? "=== APPLYING ===" : "=== DRY RUN (pass --apply to write) ===");
  for (const entry of plan.sort((a, b) => a.term.localeCompare(b.term))) {
    if (entry.added.length === 0) {
      console.log(`  ${entry.term.padEnd(16)} — up to date (${entry.alreadyPresent.length} already present)`);
      continue;
    }
    totalAdded += entry.added.length;
    const flag = entry.finalCount > MAX_SYNONYMS_PER_TERM ? `  ⚠ ${entry.finalCount} > cap ${MAX_SYNONYMS_PER_TERM}` : "";
    console.log(`  ${entry.term.padEnd(16)} + ${entry.added.join(", ")}${flag}`);
  }
  if (missingClusters.length > 0) {
    console.log(`\n  SKIPPED — no SearchSynonym cluster named: ${missingClusters.join(", ")}`);
  }
  console.log(`\n  spellings to add: ${totalAdded}`);

  if (overCap.length > 0) {
    console.log(
      `\n  ⚠ ${overCap.length} cluster(s) would exceed MAX_SYNONYMS_PER_TERM=${MAX_SYNONYMS_PER_TERM}:`,
    );
    for (const entry of overCap) {
      console.log(`      ${entry.term.padEnd(16)} → ${entry.finalCount} synonyms`);
    }
    console.log(
      "      Those rows would become unsavable in the admin UI (Zod max) and the\n" +
        "      extra spellings would be truncated out of product-search expansion.",
    );
  }

  if (!apply) {
    console.log("\nNothing written. Re-run with --apply to persist.");
    await db.$disconnect();
    return;
  }

  let written = 0;
  let clusters = 0;
  const skipped: PlanRow[] = [];
  for (const entry of plan) {
    if (entry.added.length === 0) continue;
    if (entry.finalCount > MAX_SYNONYMS_PER_TERM && !allowOverCap) {
      skipped.push(entry);
      continue;
    }
    const row = byTerm.get(entry.term.trim().toLowerCase());
    if (!row) continue;
    await db.searchSynonym.update({
      where: { id: row.id },
      data: { synonyms: [...(row.synonyms ?? []), ...entry.added] },
    });
    written += entry.added.length;
    clusters += 1;
  }
  if (skipped.length > 0) {
    console.log(
      `\nSkipped ${skipped.length} over-cap cluster(s): ${skipped.map((s) => s.term).join(", ")}` +
        `\n  (re-run with ${OVER_CAP_FLAG} to write them anyway)`,
    );
  }
  console.log(`\nWritten: ${written} spellings across ${clusters} clusters.`);
  console.log("The model-alias cache expires within 60s, so chat picks this up automatically.");

  await db.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
