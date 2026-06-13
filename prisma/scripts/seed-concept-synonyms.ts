/**
 * Seed concept / category search synonyms (Phase F of the search-quality plan).
 *
 * Fills gaps the model-synonym seed does not cover: chemical/fluid products and
 * categories that had no SearchSynonym entry, so customers who type the Thai,
 * English, misspelled, spaced or unspaced form of a concept all reach the same
 * products. Every cluster member below is GROUNDED in a real ProductAlias row in
 * production (verified via explore-search-data.ts) — nothing is invented.
 *
 * SAFETY (identical contract to seed-model-synonyms.ts):
 *   - Idempotent + additive only. Never deletes or removes a synonym.
 *   - Merges into an existing cluster when any member already appears (as a term
 *     or a synonym) in SearchSynonym — never creates conflicting rows.
 *   - Respects MAX_SYNONYMS_PER_TERM (10) via mergeSearchSynonymCandidate.
 *   - Writes an AuditLog entry for each create/update (system actor).
 *   - Does NOT touch search logic, indexes, or product_search_documents. The
 *     synonym cache (5 min TTL) picks the rows up automatically.
 *
 * Usage:
 *   npx tsx --env-file=.env.local prisma/scripts/seed-concept-synonyms.ts --dry-run
 *   npx tsx --env-file=.env.local prisma/scripts/seed-concept-synonyms.ts
 */

import { db } from "@/lib/db";
import { safeWriteAuditLog } from "@/lib/audit-log";
import { AuditAction } from "@/lib/generated/prisma";
import { mergeSearchSynonymCandidate } from "@/lib/product-search-candidate-apply";
import { normalizeSearchText } from "@/lib/search-normalization";

// Each cluster = a set of equivalent concept terms. members[0] is the canonical
// term; the rest are Thai/English/misspell/spacing variants. All grounded in
// real ProductAlias rows for the referenced product/category.
const CONCEPT_SYNONYM_CLUSTERS: string[][] = [
  // P0482 — coil cleaner (น้ำยาล้างคอยล์ Hi-SPEC). Kept SEPARATE from the AC
  // system flush below (per product owner: different products, different intent).
  [
    "น้ำยาล้างคอยล์",
    "น้ำยาล้างคอยล์เย็น",
    "น้ำยาล้างคอยเย็น",
    "น้ำยาล้างคอย",
    "น้ำยาล้างคอล์ย",
    "น้ำยาล้างแผงคอยล์",
    "น้ำยาล้างแผงคอย",
    "น้ำยาล้างรังผึ้งแอร์",
    "น้ำยาทำความสะอาดคอยล์",
    "coil cleaner",
    "ac coil cleaner",
  ],
  // P0458 — AC system flush (น้ำยาล้างระบบแอร์ F-11 Hi-CLEAR).
  [
    "น้ำยาล้างระบบแอร์",
    "น้ำยาไล่ระบบแอร์",
    "น้ำยาฟลัชระบบแอร์",
    "น้ำยาฟลัชแอร์",
    "น้ำยาล้างวงจรแอร์",
    "น้ำยาล้างท่อแอร์",
    "น้ำยาล้างระบบเครื่องปรับอากาศ",
    "ac flush",
    "ac system cleaner",
    "air conditioner flush",
    "refrigeration system cleaner",
  ],
  // Cooling Fan Blade — minimal blade-specific terms only, to avoid blurring with
  // the existing พัดลมหม้อน้ำ / พัดลมแอร์ (fan motor) clusters.
  [
    "ใบพัดลม",
    "ใบพัด",
    "ใบพัดลมแอร์",
    "fan blade",
    "cooling fan blade",
  ],
  // Compressor Control Valve — distinct from วาล์วแอร์ (expansion valve) cluster.
  [
    "คอนโทรลวาล์วคอมแอร์",
    "คอนโทรลวาล์ว",
    "วาล์วคอมแอร์",
    "วาล์วคอนโทรล",
    "วาล์วควบคุมคอมแอร์",
    "วาล์วท้ายคอม",
    "วาล์วคุมกำลังอัด",
    "control valve",
    "compressor control valve",
  ],
];

const dryRun = process.argv.includes("--dry-run");

type SynonymRow = { id: string; term: string; synonyms: string[]; language: string | null };

const auditActor = { userId: null, userName: "system (seed-concept-synonyms)", userRole: "system" };

async function main() {
  const existing: SynonymRow[] = await db.searchSynonym.findMany({
    select: { id: true, term: true, synonyms: true, language: true },
  });

  // Map every known normalized value (term + synonyms) to its owning row.
  const valueToRow = new Map<string, SynonymRow>();
  for (const row of existing) {
    valueToRow.set(normalizeSearchText(row.term), row);
    for (const syn of row.synonyms) valueToRow.set(normalizeSearchText(syn), row);
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const cluster of CONCEPT_SYNONYM_CLUSTERS) {
    const members = cluster.map((m) => m.trim()).filter(Boolean);
    if (members.length < 2) continue;
    const normalizedMembers = members.map((m) => normalizeSearchText(m));

    // Find an existing row that already owns any member of this cluster.
    const target = normalizedMembers.map((n) => valueToRow.get(n)).find(Boolean) ?? null;

    if (target) {
      const term = target.term;
      let synonyms = target.synonyms;
      let changed = false;
      const added: string[] = [];
      for (const member of members) {
        const merged = mergeSearchSynonymCandidate(synonyms, term, member);
        if (!merged.success) break; // MAX reached — stop adding, keep what we have
        if (merged.changed) {
          synonyms = merged.synonyms;
          changed = true;
          if (normalizeSearchText(member) !== normalizeSearchText(term)) added.push(member);
        }
      }
      if (!changed) {
        unchanged += 1;
        continue;
      }
      if (dryRun) {
        console.log(`UPDATE  "${term}"  + [${added.join(", ")}]`);
      } else {
        await db.searchSynonym.update({ where: { id: target.id }, data: { synonyms } });
        await safeWriteAuditLog({
          ...auditActor,
          action: AuditAction.UPDATE,
          entityType: "SearchSynonym",
          entityId: target.id,
          entityRef: term,
          before: { synonyms: target.synonyms },
          after: { synonyms },
          meta: { source: "seed-concept-synonyms", added },
        });
        for (const member of members) valueToRow.set(normalizeSearchText(member), { ...target, synonyms });
      }
      updated += 1;
    } else {
      const term = members[0];
      const synonyms = members.slice(1);
      if (dryRun) {
        console.log(`CREATE  "${term}"  = [${synonyms.join(", ")}]`);
      } else {
        const row = await db.searchSynonym.create({
          data: { term, synonyms, language: null },
        });
        await safeWriteAuditLog({
          ...auditActor,
          action: AuditAction.CREATE,
          entityType: "SearchSynonym",
          entityId: row.id,
          entityRef: term,
          after: { term, synonyms },
          meta: { source: "seed-concept-synonyms" },
        });
        const newRow: SynonymRow = { id: row.id, term, synonyms, language: null };
        for (const member of members) valueToRow.set(normalizeSearchText(member), newRow);
      }
      created += 1;
    }
  }

  console.log(
    `\n${dryRun ? "[DRY-RUN] " : ""}Done. created=${created} updated=${updated} unchanged=${unchanged} (clusters=${CONCEPT_SYNONYM_CLUSTERS.length})`,
  );
  if (!dryRun) {
    console.log("Synonym cache (5 min TTL) will pick up changes automatically; no doc rebuild needed.");
  }
}

main()
  .catch((error) => {
    console.error("seed-concept-synonyms failed.", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
