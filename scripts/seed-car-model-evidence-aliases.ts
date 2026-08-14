/**
 * Completes active Thailand car-model synonym coverage and adds two confirmed
 * customer-style Latin transpositions used by the deterministic vehicle evidence
 * guard. Additive, collision-checked, idempotent, and dry-run by default.
 *
 *   npm run seed:car-model-evidence-aliases
 *   npm run seed:car-model-evidence-aliases -- --apply
 */
import { db } from "@/lib/db";
import { MAX_SYNONYMS_PER_TERM } from "@/lib/search-synonyms";
import { normalizeSearchText } from "@/lib/search-normalization";

const ADDITIONS: Record<string, string[]> = {
  W210: ["เบนซ์ W210", "ดับเบิลยู210"],
  Escape: ["ฟอร์ด เอสเคป", "เอสเคป"],
  "Brio Amaze": ["ฮอนด้า บริโอ อเมซ", "บริโอ อเมซ"],
  ELF: ["อีซูซุ เอลฟ์", "เอลฟ์"],
  "Range Rover Evoque": ["แลนด์โรเวอร์ เรนจ์โรเวอร์ อีโวค", "เรนจ์โรเวอร์ อีโวค", "อีโวค"],
  Tribute: ["มาสด้า ทริบิวต์", "ทริบิวต์"],
  A33: ["นิสสัน เอสามสาม", "เอสามสาม"],
  NV: ["นิสสัน เอ็นวี", "เอ็นวี"],
  Exora: ["โปรตอน เอ็กโซร่า", "เอ็กโซร่า"],
  // Bare "ไฮแลนเดอร์" belongs to Isuzu Hi-Lander in the current dictionary.
  // The Toyota-qualified form is unique and therefore safe hard-filter evidence.
  Highlander: ["โตโยต้า ไฮแลนเดอร์"],
  GS: ["เล็กซัส จีเอส"],
  HS: ["เล็กซัส เอชเอส"],
  IS: ["เล็กซัส ไอเอส"],
  // Confirmed adversarial classifier failures: Spni→Sonic and DEAC→D-Max.
  "AVEO CNG": ["AVOE CNG"],
  Spin: ["spni"],
  DECA: ["deac"],
};

const isApply = process.argv.includes("--apply");

async function main(): Promise<void> {
  const existing = await db.searchSynonym.findMany({
    select: { id: true, term: true, synonyms: true, language: true, isActive: true },
  });
  const byTerm = new Map(existing.map((row) => [normalizeSearchText(row.term), row]));
  const owners = new Map<string, Set<string>>();
  for (const row of existing) {
    const owner = normalizeSearchText(row.term);
    for (const value of [row.term, ...row.synonyms]) {
      const key = normalizeSearchText(value);
      if (!key) continue;
      const values = owners.get(key) ?? new Set<string>();
      values.add(owner);
      owners.set(key, values);
    }
  }

  const plan: Array<
    | { kind: "create"; term: string; synonyms: string[] }
    | { kind: "update"; id: string; term: string; synonyms: string[]; added: string[] }
  > = [];

  for (const [term, additions] of Object.entries(ADDITIONS)) {
    const termKey = normalizeSearchText(term);
    const row = byTerm.get(termKey);
    const conflictingTermOwners = owners.get(termKey);
    if (!row && conflictingTermOwners && !conflictingTermOwners.has(termKey)) {
      throw new Error(`canonical term "${term}" is already owned by: ${Array.from(conflictingTermOwners).join(", ")}`);
    }

    const current = row?.synonyms ?? [];
    const currentKeys = new Set([term, ...current].map(normalizeSearchText));
    const added = additions.filter((value) => !currentKeys.has(normalizeSearchText(value)));
    for (const value of added) {
      const valueOwners = owners.get(normalizeSearchText(value));
      if (valueOwners && !valueOwners.has(termKey)) {
        throw new Error(`alias "${value}" for "${term}" conflicts with: ${Array.from(valueOwners).join(", ")}`);
      }
    }

    const next = [...current, ...added];
    if (next.length > MAX_SYNONYMS_PER_TERM) {
      throw new Error(`"${term}" would have ${next.length}/${MAX_SYNONYMS_PER_TERM} synonyms`);
    }
    console.log(`${row ? "UPDATE" : "CREATE"} ${term}: + ${added.length ? added.join(", ") : "(complete)"}`);
    if (added.length === 0 && row) continue;
    if (row) plan.push({ kind: "update", id: row.id, term, synonyms: next, added });
    else plan.push({ kind: "create", term, synonyms: additions });
  }

  if (plan.length === 0) {
    console.log("\nNothing to change (idempotent). No rows written.");
    return;
  }
  if (!isApply) {
    console.log(`\n[DRY-RUN] ${plan.length} rows would change. Add -- --apply to write.`);
    return;
  }

  await db.$transaction(
    plan.map((entry) =>
      entry.kind === "update"
        ? db.searchSynonym.update({
            where: { id: entry.id },
            data: { synonyms: entry.synonyms, isActive: true },
          })
        : db.searchSynonym.create({
            data: { term: entry.term, synonyms: entry.synonyms, language: "mixed", isActive: true },
          }),
    ),
  );
  console.log(`\nApplied ${plan.length} additive, collision-checked rows.`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
