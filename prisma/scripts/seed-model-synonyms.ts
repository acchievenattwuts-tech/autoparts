/**
 * Seed EN↔TH car-model search synonyms (Item 4 of the search-quality plan).
 *
 * Pro-active synonym seeding so customers who type a model name in either
 * English or Thai phonetics find the same products (e.g. "Vigo" ↔ "วีโก้").
 *
 * SAFETY:
 *   - Idempotent + additive only. Never deletes or removes a synonym.
 *   - Merges into an existing cluster when any member already appears (as a
 *     term or a synonym) in SearchSynonym — never creates conflicting rows.
 *   - Respects MAX_SYNONYMS_PER_TERM (10) via mergeSearchSynonymCandidate.
 *   - Writes an AuditLog entry for each create/update (system actor).
 *
 * Usage:
 *   npx tsx --env-file=.env.local prisma/scripts/seed-model-synonyms.ts --dry-run
 *   npx tsx --env-file=.env.local prisma/scripts/seed-model-synonyms.ts
 */

import { db } from "@/lib/db";
import { safeWriteAuditLog } from "@/lib/audit-log";
import { AuditAction } from "@/lib/generated/prisma";
import { mergeSearchSynonymCandidate } from "@/lib/product-search-candidate-apply";
import { normalizeSearchText } from "@/lib/search-normalization";

// Each cluster = a set of equivalent model names. members[0] is the canonical
// term (English); the rest are Thai phonetics / common variants.
const MODEL_SYNONYM_CLUSTERS: string[][] = [
  // Toyota
  ["Vigo", "วีโก้", "วีโก", "ไฮลักซ์วีโก้"],
  ["Revo", "รีโว่", "รีโว", "ไฮลักซ์รีโว่"],
  ["Hilux", "ไฮลักซ์", "ไฮลัก"],
  ["Vios", "วีออส"],
  ["Yaris", "ยาริส"],
  ["Altis", "อัลติส", "โคโรลล่าอัลติส"],
  ["Camry", "แคมรี่", "แคมรี"],
  ["Fortuner", "ฟอร์จูนเนอร์", "ฟอจูนเนอร์"],
  ["Innova", "อินโนวา"],
  ["Commuter", "คอมมิวเตอร์", "รถตู้คอมมิวเตอร์"],
  ["Mighty-X", "ไมตี้เอ็กซ์", "ไมตี้เอ๊กซ์"],
  ["Soluna", "โซลูน่า"],
  // Isuzu
  ["D-Max", "ดีแมคซ์", "ดีแม็ก", "ดีแมก"],
  ["Mu-X", "มิวเอ็กซ์", "มิวเอ๊กซ์"],
  ["Dragon Eye", "ดราก้อนอาย", "ดราก้อน"],
  ["TFR", "ทีเอฟอาร์"],
  ["Rodeo", "โรดิโอ"],
  ["Hi-Lander", "ไฮแลนเดอร์"],
  ["Spark", "สปาร์ค"],
  // Honda
  ["City", "ซิตี้"],
  ["Civic", "ซีวิค"],
  ["Jazz", "แจ๊ส", "แจ้ส"],
  ["Accord", "แอคคอร์ด", "แอคคอด"],
  ["CR-V", "ซีอาร์วี", "crv"],
  ["Brio", "บริโอ้", "บริโอ"],
  ["Mobilio", "โมบิลิโอ"],
  // Mitsubishi
  ["Triton", "ไทรทัน", "ไททัน"],
  ["Pajero", "ปาเจโร่", "ปาเจโร", "ปาเจโร่สปอร์ต"],
  ["Strada", "สตราด้า"],
  ["Lancer", "แลนเซอร์"],
  ["Mirage", "มิราจ"],
  ["Attrage", "แอททราจ", "แอตทราจ"],
  ["Xpander", "เอ็กซ์แพนเดอร์", "เอกซ์แพนเดอร์"],
  // Nissan
  ["Navara", "นาวารา"],
  ["Frontier", "ฟรอนเทียร์", "ฟรอเทียร์"],
  ["Almera", "อัลเมร่า"],
  ["March", "มาร์ช"],
  ["Teana", "เทียน่า"],
  ["NP300", "เอ็นพี300"],
  ["Big-M", "บิ๊กเอ็ม"],
  // Ford
  ["Ranger", "เรนเจอร์"],
  ["Everest", "เอเวอเรสต์", "เอเวอเรส"],
  ["Fiesta", "เฟียสต้า"],
  ["Focus", "โฟกัส"],
  // Chevrolet
  ["Colorado", "โคโลราโด"],
  ["Captiva", "แคปติว่า"],
  ["Trailblazer", "เทรลเบลเซอร์"],
  // Mazda
  ["BT-50", "บีที50", "บีที-50"],
  ["Mazda2", "มาสด้า2"],
  ["Mazda3", "มาสด้า3"],
  ["CX-5", "ซีเอ็กซ์5"],
  // 2026-07 gap-fill: log-evidenced ("deka" typed by customers) + curated Thai/English
  // misspellings for popular models, each verified not to collide with another model.
  // member[0] is an existing canonical so these merge into the current cluster.
  ["DECA", "deka", "เดคก้า"],
  ["Vios", "วิออส", "ไวออส"],
  ["Yaris", "ยาลิส", "ยาริด"],
  ["Camry", "แคมมี่"],
  ["Fortuner", "ฟอร์ทูนเนอร์"],
  ["Almera", "อัลมิร่า", "อัลเมียร่า"],
  ["Triton", "ไทตัน"],
  ["Ciaz", "เชียส"],
  ["Colorado", "โคราโด"],
  ["Vigo", "วีโก๊"],
  ["Strada", "สตาด้า"],
  ["Navara", "นาวาด้า"],
];

const dryRun = process.argv.includes("--dry-run");

type SynonymRow = { id: string; term: string; synonyms: string[]; language: string | null };

const auditActor = { userId: null, userName: "system (seed-model-synonyms)", userRole: "system" };

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

  for (const cluster of MODEL_SYNONYM_CLUSTERS) {
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
          meta: { source: "seed-model-synonyms", added },
        });
        // Keep the in-memory map current so later clusters merge correctly.
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
          meta: { source: "seed-model-synonyms" },
        });
        const newRow: SynonymRow = { id: row.id, term, synonyms, language: null };
        for (const member of members) valueToRow.set(normalizeSearchText(member), newRow);
      }
      created += 1;
    }
  }

  console.log(
    `\n${dryRun ? "[DRY-RUN] " : ""}Done. created=${created} updated=${updated} unchanged=${unchanged} (clusters=${MODEL_SYNONYM_CLUSTERS.length})`,
  );
  if (!dryRun) {
    console.log("Synonym cache (5 min TTL) will pick up changes automatically; no doc rebuild needed.");
  }
}

main()
  .catch((error) => {
    console.error("seed-model-synonyms failed.", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
