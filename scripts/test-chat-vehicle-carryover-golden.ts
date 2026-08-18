/**
 * Golden suite: a carried-over vehicle must not silently zero a search.
 *
 * Production 2026-08-17 (conv cmq4ziq6l): 98 seconds after asking about a D-Max
 * evaporator, the customer typed "พัดลม10 24โว้นแผงคอยร้อน" — a UNIVERSAL fan,
 * no car named. The inquiry frame kept Isuzu/D-Max as a hard filter, the search
 * returned 0, and the reply opened with "สำหรับพัดลม Isuzu D-Max" before handing
 * off. The matching fans were in stock the whole time.
 *
 * Two independent defects, pinned separately:
 *
 *   A. The stale-vehicle guard reads `latestHasProductSpecificity`, which was
 *      derived from the HARD-ANCHOR token list. That list's regex omits Thai
 *      combining marks, so "พัดลม10" / "คอมแอร์508" / "ซิตี้12" counted as "this
 *      turn carries no detail" and the guard never fired. Section A pins the new
 *      signal extractor AND pins that the hard-anchor list is unchanged —
 *      widening the anchors instead is the tempting one-character fix and would
 *      require "พัดลม10" to appear in a product name, zeroing every such search.
 *
 *   B. The retry-on-empty that drops a meaningless vehicle scope only ran for
 *      accessory head nouns (parts with NO category). A universal part that DID
 *      resolve a category was left at 0. Section B pins the widened rescue.
 *
 * Section C replays every recorded turn: the signal must gain real turns without
 * ever firing on pure vehicle/greeting text, and must never lose a turn it
 * already covered.
 *
 * Read-only. Requires DATABASE_URL.
 *
 *   npm run test:chat-vehicle-carryover-golden
 */
import { db } from "@/lib/db";
import { searchProductIdsV2 } from "@/lib/product-search";
import {
  extractProductSearchRequiredTokens,
  extractProductSpecificityTokens,
} from "@/lib/product-search-required-tokens";
import {
  COOLING_FAN_BLADE_CATEGORY_HINT,
  isVehicleFreeChatCategory,
  resolveChatProductSpecs,
  VEHICLE_FREE_CATEGORY_HINTS,
} from "@/lib/chat-core/product-spec-resolve";

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

// ── A. the specificity signal ───────────────────────────────────────────────
const SPECIFIC: ReadonlyArray<readonly [string, string]> = [
  ["พัดลม10 24โว้นแผงคอยร้อน", "the incident — sara a glued to a number"],
  ["คอมแอร์508", "karan glued to a model number"],
  ["ซิตี้12", "sara i + sara ii + mai tho"],
  ["วีออส03", "sara ii"],
  ["แผงคอยร้อนฮอนด้าแจ็ค03", "several marks in one run-on token"],
];

const NOT_SPECIFIC: ReadonlyArray<readonly [string, string]> = [
  ["มีของไหมครับ", "plain availability question"],
  ["อัลติส ปี 2008", "a car YEAR is vehicle detail, not part detail"],
  ["วีออส 12-15", "a car year RANGE is vehicle detail"],
  ["ราคาเท่าไหร่", "price follow-up"],
  ["สวัสดีครับ", "greeting"],
  ["1อันคัฟ", "an order QUANTITY, not part detail"],
  ["2ตัวครับ", "order quantity with a polite particle"],
  ["เอา3ชิ้น", "order quantity glued to a verb"],
  ["เบอร์ 0812345678", "a phone number"],
];

function runSignal(): void {
  console.log("\n[A] the specificity signal");
  for (const [text, why] of SPECIFIC) {
    report(extractProductSpecificityTokens(text).length > 0, `"${text}" -> specific (${why})`);
  }
  for (const [text, why] of NOT_SPECIFIC) {
    report(extractProductSpecificityTokens(text).length === 0, `"${text}" -> not specific (${why})`);
  }

  console.log("\n[A2] the HARD-ANCHOR list must stay exactly as strict as before");
  for (const [text] of SPECIFIC) {
    report(
      extractProductSearchRequiredTokens(text).length === 0,
      `"${text}" still yields NO hard anchor`,
    );
  }
  report(
    extractProductSearchRequiredTokens("คอม 508 24v").join(",") === "508,24v",
    "genuine part codes still anchor (508 + 24v)",
  );
  report(
    extractProductSearchRequiredTokens("stb-2077s วีออส").includes("stb-2077s"),
    "an SKU-style code still anchors (stb-2077s)",
  );
}

// ── B. the rescue ───────────────────────────────────────────────────────────
const CAT_FAN = "ใบพัดลม (Cooling Fan Blade)";
const INCIDENT_QUERY = "พัดลม Isuzu D-Max";

async function searchTotal(query: string, brand: string | null, model: string | null): Promise<number> {
  const res = await searchProductIdsV2(
    {
      query,
      isActive: true,
      isStorefrontVisible: true,
      categoryName: CAT_FAN,
      carBrandName: brand,
      carModelName: model,
      skip: 0,
      take: 5,
    },
    { bypassInternalCaches: true },
  );
  return res.total;
}

async function runRescue(): Promise<void> {
  console.log("\n[B] a carried vehicle must not zero a universal part");
  const scoped = await searchTotal(INCIDENT_QUERY, "Isuzu", "D-Max");
  const carless = await searchTotal(INCIDENT_QUERY, null, null);
  console.log(`  vehicle-scoped: ${scoped}   carless: ${carless}`);
  report(scoped === 0, "the production search really did return 0 with the carried car");
  report(carless > 0, `dropping the meaningless vehicle finds the fans (${carless})`);

  const specs = resolveChatProductSpecs("พัดลม10 24โว้นแผงคอยร้อน");
  report(
    specs.categoryHint === COOLING_FAN_BLADE_CATEGORY_HINT,
    "the turn resolves to a UNIVERSAL fan category — what licenses the rescue",
  );

  // A universal SKU has no fitment rows at all, so the vehicle filter can only
  // ever subtract. This is the structural fact the rescue relies on — asserted
  // for EVERY vehicle-free category, so the day the shop tags one of them to a
  // car this test fails instead of the customer losing their vehicle scope.
  for (const hint of VEHICLE_FREE_CATEGORY_HINTS) {
    const rows = await db.productFitment.count({
      where: { product: { category: { name: { contains: hint } } } },
    });
    const skus = await db.product.count({
      where: { isActive: true, category: { name: { contains: hint } } },
    });
    report(rows === 0, `"${hint}" still has zero vehicle fitment rows (${skus} SKUs, ${rows} rows)`);
  }

  // The decision must come from the catalog-backed category, never from the
  // classifier's unmeasured `partKind`.
  report(isVehicleFreeChatCategory(CAT_FAN), `"${CAT_FAN}" is recognised as vehicle-free`);
  report(
    !isVehicleFreeChatCategory("คอยล์เย็น (Evaporator)"),
    "a fitment category is NOT recognised as vehicle-free",
  );
  report(!isVehicleFreeChatCategory(null), "a missing category is never vehicle-free");

  // A FITMENT part must keep its vehicle scope — the rescue must never widen it.
  const evapScoped = await searchProductIdsV2(
    {
      query: "คอยล์เย็น d-max",
      isActive: true,
      isStorefrontVisible: true,
      categoryName: "คอยล์เย็น (Evaporator)",
      carBrandName: "Isuzu",
      carModelName: "D-Max",
      skip: 0,
      take: 5,
    },
    { bypassInternalCaches: true },
  );
  report(
    evapScoped.total > 0,
    `a fitment part still finds vehicle-scoped rows, so its rescue never triggers (${evapScoped.total})`,
  );
}

// ── C. replay ───────────────────────────────────────────────────────────────
async function runReplay(): Promise<void> {
  const rows = await db.lineAiAuditLog.findMany({
    where: { action: "SEARCH_QUERY_CONSOLIDATED" },
    select: { payload: true },
    orderBy: { createdAt: "desc" },
  });
  const texts: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const payload = row.payload as Record<string, unknown> | null;
    const id = typeof payload?.lineEventId === "string" ? payload.lineEventId : null;
    const text = typeof payload?.latestText === "string" ? payload.latestText.trim() : "";
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    texts.push(text);
  }

  console.log(`\n[C] replay — ${texts.length} real turns`);
  const gained: string[] = [];
  const vehicleOnly: string[] = [];
  let lost = 0;

  for (const text of texts) {
    const anchors = extractProductSearchRequiredTokens(text);
    const signal = extractProductSpecificityTokens(text);
    const before = anchors.length > 0;
    const after = before || signal.length > 0;

    if (before && !after) lost += 1;
    if (!before && after) {
      gained.push(text);
      // A turn whose only numbers describe the CAR must not read as part detail —
      // that would drop a vehicle the customer is still talking about.
      if (signal.every((token) => /^(?:ปี|รุ่น|year)?\d{2,4}$/u.test(token))) {
        vehicleOnly.push(`${text} -> ${signal.join(",")}`);
      }
    }
  }

  console.log(`  turns that newly count as specific: ${gained.length}`);
  for (const line of gained.slice(0, 15)) {
    console.log(`    + ${line.replace(/\n/g, " | ").slice(0, 70)}`);
  }
  report(gained.length > 0, `the signal gains real turns (${gained.length})`);
  report(lost === 0, `no turn lost its existing specificity signal (${lost})`);
  report(
    vehicleOnly.length === 0,
    `no turn is called "specific" on a bare car year alone (${vehicleOnly.length})`,
  );
  for (const line of vehicleOnly.slice(0, 5)) console.log(`    ! ${line}`);
}

async function main(): Promise<void> {
  runSignal();
  await runRescue();
  await runReplay();
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
