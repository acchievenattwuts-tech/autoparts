/**
 * Option 2 — phase 1 evaluation: should the intent classifier also return a
 * SPELL-NORMALIZED copy of the customer's text? (PLAN.md 4o "ยังไม่ทำ")
 *
 * Motivation: customers type units and part words loosely ("พัดลม10 24โว้น",
 * "คอมแอร์50824v"). The deterministic spec resolver needs "นิ้ว"/"โวลต์" to read a
 * size or voltage, so those turns lose their hard constraints. Adding an alias row
 * per misspelling does not scale, and the shop asked for the LLM to carry this.
 *
 * The cheap design is NOT a new LLM pass — it is one more field on the classifier
 * call that already runs on every product turn (zero extra calls, zero extra
 * latency, already cached, shared with Messenger). This harness answers the two
 * questions that decide whether that is safe:
 *
 *   Q1 (blocking) — does adding the field DEGRADE the fields already in use?
 *                   Baseline and variant prompts are run on the same inputs and
 *                   every existing field is diffed.
 *   Q2 (value)    — does the normalized text actually recover specs the
 *                   deterministic resolver misses today?
 *
 * Q1 needs a CONTROL. The classifier is not bit-deterministic even at
 * temperature 0 (the reason `search-intent-cache` exists), so a raw
 * baseline-vs-variant diff would blame the new field for ordinary model noise.
 * The baseline is therefore run TWICE and compared with itself; only drift
 * ABOVE that control floor is attributable to the field.
 *
 * Every normalization is put through a deterministic ACCEPTANCE GUARD before it
 * counts, because the real danger is the model inventing a number that becomes a
 * hard filter. The guard is the proposed shipping rule, evaluated here first.
 *
 * Read-only against the DB. Costs 2 Gemini calls per replayed turn.
 *
 *   npm run evaluate:chat-text-normalization
 *   npm run evaluate:chat-text-normalization -- --limit 40
 */
import { writeFileSync } from "node:fs";

import { db } from "@/lib/db";
import { SEARCH_INTENT_SYSTEM_INSTRUCTION } from "@/lib/chat-core/ai-service";
import { generateGeminiContent } from "@/lib/google-ai-client";
import { hasGeminiKeysConfigured } from "@/lib/google-ai-keys";
import { osaDistance } from "@/lib/chat-core/typo-distance";
import { resolveChatProductSpecs, type ChatProductSpecs } from "@/lib/chat-core/product-spec-resolve";

// ── Prompt variant ──────────────────────────────────────────────────────────

/**
 * The ONLY change under test. Phrased to forbid the two failure modes that would
 * make the field dangerous: inventing numbers, and answering the question instead
 * of rewriting it.
 */
const NORMALIZED_TEXT_FIELD = [
  '  "normalizedText": "เขียน \'ข้อความล่าสุด\' ใหม่ด้วยคำมาตรฐานของร้าน — แก้คำสะกดผิด แยกคำที่พิมพ์ติดกัน และเติมหน่วยที่ลูกค้าละไว้ (นิ้ว/โวลต์/มม./วัตต์) เช่น \'พัดลม10 24โว้น\' → \'พัดลม 10 นิ้ว 24 โวลต์\', \'คอมแอร์50824v\' → \'คอมแอร์ 508 24 โวลต์\'. ห้ามเพิ่มหรือแก้ตัวเลขเด็ดขาด ห้ามเพิ่มชนิดอะไหล่/ยี่ห้อ/รุ่นรถที่ลูกค้าไม่ได้พิมพ์ ห้ามตอบคำถาม. ถ้าไม่มีอะไรต้องแก้ ให้คัดลอกข้อความเดิมมาตรง ๆ",',
].join("\n");

function buildVariantInstruction(): string {
  const marker = '  "year": ';
  const at = SEARCH_INTENT_SYSTEM_INSTRUCTION.indexOf(marker);
  if (at < 0) throw new Error("classifier instruction shape changed — update the injection point");
  return (
    SEARCH_INTENT_SYSTEM_INSTRUCTION.slice(0, at) +
    NORMALIZED_TEXT_FIELD +
    "\n" +
    SEARCH_INTENT_SYSTEM_INSTRUCTION.slice(at)
  );
}

// ── Acceptance guard (the proposed shipping rule) ───────────────────────────

/** Units the model MAY introduce. They carry no product identity on their own —
 *  the identity risk lives entirely in the numbers, which the digit rule pins. */
const INSERTABLE_UNIT_TOKENS = new Set([
  "นิ้ว", "โวลต์", "วัตต์", "มม", "ซม", "มิล",
  "inch", "inches", "v", "volt", "volts", "w", "watt", "mm", "cm",
]);

const MAX_TOKEN_EDITS = 2;
const MAX_LENGTH_RATIO = 2;

const tokenize = (value: string): string[] =>
  value.toLowerCase().split(/[\s,./()[\]{}:;'"|\\!?+&=-]+/).filter(Boolean);

const digitGroups = (value: string): string[] => value.match(/\d+/g) ?? [];

export type GuardVerdict = { accepted: true } | { accepted: false; reason: string };

function acceptNormalization(raw: string, normalized: string): GuardVerdict {
  if (!normalized.trim()) return { accepted: false, reason: "EMPTY" };
  if (normalized.length > raw.length * MAX_LENGTH_RATIO) {
    return { accepted: false, reason: "TOO_LONG" };
  }

  // Numbers may be re-spaced but never invented or altered — a number is what
  // becomes a size/voltage/year hard filter.
  const rawDigits = digitGroups(raw).join("");
  const newDigits = digitGroups(normalized).join("");
  if (rawDigits !== newDigits) return { accepted: false, reason: "DIGITS_CHANGED" };

  const rawTokens = tokenize(raw);
  for (const token of tokenize(normalized)) {
    if (/^\d+$/.test(token)) continue;
    if (INSERTABLE_UNIT_TOKENS.has(token)) continue;
    const known = rawTokens.some(
      (rawToken) =>
        rawToken.includes(token) ||
        token.includes(rawToken) ||
        osaDistance(token, rawToken) <= MAX_TOKEN_EDITS,
    );
    if (!known) return { accepted: false, reason: `NEW_TOKEN:${token}` };
  }
  return { accepted: true };
}

// ── Replay ──────────────────────────────────────────────────────────────────

type Turn = { lineEventId: string; latestText: string };

const COMPARED_FIELDS = [
  "group",
  "query",
  "partType",
  "carBrand",
  "carModel",
  "carMentionInLatest",
  "year",
  "partKind",
  "tooBroad",
] as const;

type RawIntent = Record<string, unknown>;

async function classify(instruction: string, latestText: string): Promise<RawIntent | null> {
  const prompt = [
    "บทสนทนา (เก่าสุด → ใหม่สุด):",
    `ลูกค้า (ข้อความล่าสุด): ${latestText}`,
    "",
    "ตอบเป็น JSON object บรรทัดเดียวตามรูปแบบที่กำหนด:",
  ].join("\n");
  try {
    const { text } = await generateGeminiContent({
      prompt,
      systemInstruction: instruction,
      maxOutputTokens: 700,
      temperature: 0,
      json: true,
      thinkingLevel: "NONE",
      timeoutMs: 20_000,
      maxKeyAttempts: 3,
    });
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    return JSON.parse(text.slice(start, end + 1)) as RawIntent;
  } catch {
    return null;
  }
}

async function loadTurns(limit: number): Promise<Turn[]> {
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
    const text = typeof p?.latestText === "string" ? p.latestText.trim() : "";
    if (!id || !text || seen.has(id)) continue;
    seen.add(id);
    turns.push({ lineEventId: id, latestText: text });
    if (turns.length >= limit) break;
  }
  return turns;
}

const CONCURRENCY = 6;

async function mapWithConcurrency<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        if (index >= items.length) return;
        results[index] = await worker(items[index], index);
        if ((index + 1) % 20 === 0) console.log(`  …${index + 1}/${items.length}`);
      }
    }),
  );
  return results;
}

type Row = {
  lineEventId: string;
  raw: string;
  normalized: string | null;
  verdict: GuardVerdict;
  /** baseline run #1 vs the variant — the measurement. */
  changedFields: string[];
  /** baseline run #1 vs baseline run #2 — the model-noise floor. */
  controlChangedFields: string[];
  specsBefore: ChatProductSpecs;
  specsAfter: ChatProductSpecs | null;
};

const diffFields = (a: RawIntent | null, b: RawIntent | null): string[] => {
  if (!a || !b) return [];
  return COMPARED_FIELDS.filter(
    (field) => JSON.stringify(a[field] ?? null) !== JSON.stringify(b[field] ?? null),
  );
};

const specsChanged = (a: ChatProductSpecs, b: ChatProductSpecs): boolean =>
  a.categoryHint !== b.categoryHint ||
  a.diameterInches !== b.diameterInches ||
  a.fanDirection !== b.fanDirection ||
  a.voltage !== b.voltage;

const describeSpecs = (s: ChatProductSpecs): string =>
  `{hint:${s.categoryHint ?? "-"} in:${s.diameterInches ?? "-"} dir:${s.fanDirection ?? "-"} v:${s.voltage ?? "-"}}`;

async function main(): Promise<void> {
  if (!hasGeminiKeysConfigured()) {
    console.log("✗ GOOGLE_AI_API_KEY_n not configured (.env.local)");
    process.exit(1);
  }

  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) || 1000 : 1000;
  const variantInstruction = buildVariantInstruction();

  const turns = await loadTurns(limit);
  console.log(`replaying ${turns.length} real turns × 2 prompts (baseline + variant)\n`);

  const rows = await mapWithConcurrency(turns, async (turn) => {
    const [baseline, baselineControl, variant] = await Promise.all([
      classify(SEARCH_INTENT_SYSTEM_INSTRUCTION, turn.latestText),
      classify(SEARCH_INTENT_SYSTEM_INSTRUCTION, turn.latestText),
      classify(variantInstruction, turn.latestText),
    ]);

    const changedFields = diffFields(baseline, variant);
    const controlChangedFields = diffFields(baseline, baselineControl);

    const normalized =
      typeof variant?.normalizedText === "string" ? variant.normalizedText.trim() : null;
    const verdict: GuardVerdict = normalized
      ? acceptNormalization(turn.latestText, normalized)
      : { accepted: false, reason: "MISSING" };

    const specsBefore = resolveChatProductSpecs(turn.latestText);
    const specsAfter = verdict.accepted && normalized ? resolveChatProductSpecs(normalized) : null;

    return {
      lineEventId: turn.lineEventId,
      raw: turn.latestText,
      normalized,
      verdict,
      changedFields,
      controlChangedFields,
      specsBefore,
      specsAfter,
    } satisfies Row;
  });

  // ── Q1: field drift (blocking) ────────────────────────────────────────────
  const comparable = rows.filter((r) => r.normalized !== null);
  const drifted = rows.filter((r) => r.changedFields.length > 0);
  const control = rows.filter((r) => r.controlChangedFields.length > 0);

  const countByField = (pick: (row: Row) => string[]): Map<string, number> => {
    const map = new Map<string, number>();
    for (const row of rows) {
      for (const field of pick(row)) map.set(field, (map.get(field) ?? 0) + 1);
    }
    return map;
  };
  const variantByField = countByField((r) => r.changedFields);
  const controlByField = countByField((r) => r.controlChangedFields);

  console.log("\n" + "=".repeat(64));
  console.log("Q1 — does the new field disturb the fields already in use?");
  console.log(`  turns compared: ${rows.length}`);
  console.log(`    control (baseline vs baseline): ${control.length} turns drifted`);
  console.log(`    variant (baseline vs variant):  ${drifted.length} turns drifted`);
  console.log("\n  per field — control / variant:");
  for (const field of COMPARED_FIELDS) {
    const c = controlByField.get(field) ?? 0;
    const v = variantByField.get(field) ?? 0;
    if (c === 0 && v === 0) continue;
    const flag = v > c ? "  ← above noise" : "";
    console.log(`    ${field.padEnd(20)} ${String(c).padStart(4)} / ${String(v).padStart(4)}${flag}`);
  }

  // Only drift the control does NOT also show is attributable to the field.
  const attributable = rows.filter((r) =>
    r.changedFields.some((field) => !r.controlChangedFields.includes(field)),
  );
  console.log(`\n  turns with drift NOT explained by model noise: ${attributable.length}`);
  for (const row of attributable.slice(0, 12)) {
    const only = row.changedFields.filter((f) => !row.controlChangedFields.includes(f));
    console.log(`    ! [${only.join(",")}] ${row.raw.replace(/\n/g, " | ").slice(0, 66)}`);
  }

  // ── Q2: normalization behaviour + value ───────────────────────────────────
  const changedText = comparable.filter((r) => r.normalized !== r.raw);
  const accepted = changedText.filter((r) => r.verdict.accepted);
  const rejected = changedText.filter((r) => !r.verdict.accepted);
  const rejectReasons = new Map<string, number>();
  for (const row of rejected) {
    if (row.verdict.accepted) continue;
    const key = row.verdict.reason.split(":")[0];
    rejectReasons.set(key, (rejectReasons.get(key) ?? 0) + 1);
  }
  const specGains = accepted.filter((r) => r.specsAfter && specsChanged(r.specsBefore, r.specsAfter));

  console.log("\n" + "=".repeat(64));
  console.log("Q2 — what does normalization actually do?");
  console.log(`  produced a value:      ${comparable.length}/${rows.length}`);
  console.log(`  rewrote the text:      ${changedText.length}`);
  console.log(`  passed the guard:      ${accepted.length}`);
  console.log(`  blocked by the guard:  ${rejected.length}`);
  for (const [reason, count] of [...rejectReasons].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(count).padStart(4)}  ${reason}`);
  }
  console.log(`  CHANGED THE SPECS:     ${specGains.length}   ← the whole point`);

  if (specGains.length > 0) {
    console.log("\n  spec changes (review every one):");
    for (const row of specGains) {
      console.log(`    raw : ${row.raw.replace(/\n/g, " | ").slice(0, 72)}`);
      console.log(`    norm: ${row.normalized}`);
      console.log(`          ${describeSpecs(row.specsBefore)} → ${describeSpecs(row.specsAfter!)}`);
    }
  }

  if (rejected.length > 0) {
    console.log("\n  blocked rewrites (confirm the guard is right to block these):");
    for (const row of rejected.slice(0, 12)) {
      const reason = row.verdict.accepted ? "" : row.verdict.reason;
      console.log(`    [${reason}] ${row.raw.replace(/\n/g, " | ").slice(0, 56)}`);
      console.log(`             → ${row.normalized}`);
    }
  }

  const reportPath = process.env.NORMALIZATION_EVAL_REPORT?.trim() || "chat-text-normalization-eval.json";
  writeFileSync(reportPath, JSON.stringify(rows, null, 2), "utf8");
  console.log(`\nfull report → ${reportPath}`);

  console.log("\n" + "=".repeat(64));
  const noisy = drifted.length <= control.length;
  console.log(
    `VERDICT: drift ${drifted.length} vs control ${control.length} → ` +
      (noisy
        ? "the field is INDISTINGUISHABLE from model noise (design viable)"
        : "the field adds drift ABOVE noise (do not ship it on the shared prompt as-is)"),
  );
  console.log(
    `         value: ${specGains.length} turn(s) gained specs the deterministic layer misses today`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => process.exit(process.exitCode ?? 0));
