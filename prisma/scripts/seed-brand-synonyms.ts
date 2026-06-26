/**
 * Seed parts-brand search synonyms (newly added PartsBrand rows in production).
 *
 * Covers the brand names that had no SearchSynonym entry yet, so customers who
 * type the Thai phonetic, English, misspelled, spaced or unspaced form — plus the
 * common generic product term for that brand — all reach the same products.
 * Brand identities verified via external research (Aeroflex/Aerotape = EPDM
 * rubber A/C pipe insulation + tape; Fujikoki = automotive expansion-valve maker;
 * COCO = aftermarket car air/cabin filter; ATC = radiator/cooling brand;
 * K.AIR = Thai A/C-parts brand; Mazda Genuine Parts = Mazda OEM).
 *
 * SAFETY (identical contract to seed-model-synonyms.ts / seed-concept-synonyms.ts):
 *   - Idempotent + additive only. Never deletes or removes a synonym.
 *   - Merges into an existing cluster when any member already appears (as a term
 *     or a synonym) in SearchSynonym — never creates conflicting rows.
 *   - Respects MAX_SYNONYMS_PER_TERM (10) via mergeSearchSynonymCandidate.
 *   - Writes an AuditLog entry for each create/update (system actor).
 *   - Does NOT touch search logic, indexes, or product_search_documents. The
 *     synonym cache (5 min TTL) picks the rows up automatically.
 *
 * Usage:
 *   npx tsx --env-file=.env.local prisma/scripts/seed-brand-synonyms.ts --dry-run
 *   npx tsx --env-file=.env.local prisma/scripts/seed-brand-synonyms.ts
 */

import { db } from "@/lib/db";
import { safeWriteAuditLog } from "@/lib/audit-log";
import { AuditAction } from "@/lib/generated/prisma";
import { mergeSearchSynonymCandidate } from "@/lib/product-search-candidate-apply";
import { normalizeSearchText } from "@/lib/search-normalization";

// Each cluster = a set of equivalent brand terms. members[0] is the canonical
// term; the rest are Thai/English/misspell/spacing variants of the BRAND NAME
// only — no generic product-category words (kept strictly in-scope).
const BRAND_SYNONYM_CLUSTERS: string[][] = [
  // AEROTAPE / Aeroflex — black EPDM rubber A/C pipe insulation + insulation tape.
  [
    "Aeroflex",
    "AEROTAPE",
    "แอโรเฟล็กซ์",
    "แอโรเฟลกซ์",
    "แอโรเฟล็ก",
    "แอโรเทป",
  ],
  // Fujikoki — automotive expansion-valve maker.
  ["Fujikoki", "ฟูจิโคกิ", "ฟูจิโคกี้", "ฟูจิโกกิ", "Fujicoki"],
  // COCO CAR FILTER — aftermarket car air / cabin filter brand.
  [
    "COCO",
    "Coco Filter",
    "COCO CAR FILTER",
    "โคโค่",
    "โคโค",
    "โคโค่ฟิลเตอร์",
  ],
  // ATC — radiator / cooling brand.
  ["ATC", "เอทีซี", "A T C"],
  // K.AIR — Thai A/C-parts brand.
  ["K.AIR", "K AIR", "K-AIR", "KAIR", "เคแอร์", "เค.แอร์"],
  // Mazda Genuine Parts — Mazda OEM parts.
  [
    "Mazda Genuine Parts",
    "Mazda Genuine",
    "Genuine Mazda",
    "มาสด้าแท้",
    "อะไหล่แท้มาสด้า",
    "มาสด้าเจนูอิน",
  ],
];

const dryRun = process.argv.includes("--dry-run");

type SynonymRow = { id: string; term: string; synonyms: string[]; language: string | null };

const auditActor = { userId: null, userName: "system (seed-brand-synonyms)", userRole: "system" };

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

  for (const cluster of BRAND_SYNONYM_CLUSTERS) {
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
          meta: { source: "seed-brand-synonyms", added },
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
          meta: { source: "seed-brand-synonyms" },
        });
        const newRow: SynonymRow = { id: row.id, term, synonyms, language: null };
        for (const member of members) valueToRow.set(normalizeSearchText(member), newRow);
      }
      created += 1;
    }
  }

  console.log(
    `\n${dryRun ? "[DRY-RUN] " : ""}Done. created=${created} updated=${updated} unchanged=${unchanged} (clusters=${BRAND_SYNONYM_CLUSTERS.length})`,
  );
  if (!dryRun) {
    console.log("Synonym cache (5 min TTL) will pick up changes automatically; no doc rebuild needed.");
  }
}

main()
  .catch((error) => {
    console.error("seed-brand-synonyms failed.", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
