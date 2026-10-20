/**
 * One-off data fix approved by the owner on 2026-10-20 (LINE incident, conv cmr39eesa).
 *
 * The customer wrote "คอยเย็นซี๊ดตี้09" for a Honda City 2009 evaporator. "ซี๊ดตี้" is not a
 * known City spelling, Gemini read it as Ford Fiesta, and the bot listed Mazda 2 / Fiesta
 * coils. Adding the spelling family to the City SearchSynonym row lets the chat guard's
 * explicit-evidence check (resolveLatestExplicitCarModelEvidence) override the classifier,
 * and product search expand the word to City.
 *
 * Adds only the spellings that are missing, and only when none of them already belongs to
 * another active SearchSynonym row or names a car brand/model — a shared spelling would
 * make the evidence ambiguous. Same AuditLog shape as the admin page (UPDATE SearchSynonym,
 * before/after synonyms). Dry-run by default; writes only with --apply, in one transaction,
 * then rebuilds the search-keyword index like the admin page does (the daily cron would
 * otherwise pick it up). The synonym caches in the running app expire within 5 minutes.
 * Run: npx tsx --env-file=.env.local prisma/scripts/fix-20261020-city-synonym-spellings.ts [--apply]
 */
import { db, dbTx } from "../../lib/db";
import { writeAuditLogTx } from "../../lib/audit-log";
import { MAX_SYNONYMS_PER_TERM } from "../../lib/search-synonyms";
import { refreshSearchKeywordIndex } from "../../lib/search-keyword-index";

const APPLY = process.argv.includes("--apply");
const SCRIPT = "fix-20261020-city-synonym-spellings";
const ACTOR = { userName: "System (data fix 2026-10-20)" } as const;

const TERM = "City";
const NEW_SPELLINGS = ["ซี๊ดตี้", "ซีดตี้", "ซิดตี้", "ซิตตี้", "ซีตี้", "ซี้ตี้"];

const fold = (value: string) => value.normalize("NFC").trim().toLowerCase();

type CityRow = { id: string; term: string; synonyms: string[]; isActive: boolean };

async function findCityRow(client: Pick<typeof db, "searchSynonym">): Promise<CityRow> {
  const rows = await client.searchSynonym.findMany({
    where: { term: { equals: TERM, mode: "insensitive" }, isActive: true },
    select: { id: true, term: true, synonyms: true, isActive: true },
  });
  if (rows.length !== 1) throw new Error(`Expected one active "${TERM}" SearchSynonym row, found ${rows.length}`);
  return rows[0];
}

/** Spellings already used by ANOTHER active synonym row, or equal to a brand/model name. */
async function findCollisions(
  client: Pick<typeof db, "searchSynonym" | "carModel" | "carBrand">,
  cityId: string,
  spellings: string[],
): Promise<string[]> {
  const wanted = new Set(spellings.map(fold));
  const [others, models, brands] = await Promise.all([
    client.searchSynonym.findMany({
      where: { isActive: true, id: { not: cityId } },
      select: { term: true, synonyms: true },
    }),
    client.carModel.findMany({ where: { isActive: true }, select: { name: true } }),
    client.carBrand.findMany({ where: { isActive: true }, select: { name: true } }),
  ]);
  const taken = new Set<string>([
    ...others.flatMap((row) => [row.term, ...row.synonyms]).map(fold),
    ...models.map((row) => fold(row.name)),
    ...brands.map((row) => fold(row.name)),
  ]);
  return Array.from(wanted).filter((spelling) => taken.has(spelling));
}

function plan(row: CityRow): string[] {
  const existing = new Set([row.term, ...row.synonyms].map(fold));
  return NEW_SPELLINGS.filter((spelling) => !existing.has(fold(spelling)));
}

async function main(): Promise<void> {
  const row = await findCityRow(db);
  const toAdd = plan(row);
  console.log(`${APPLY ? "APPLY" : "DRY-RUN"} ${SCRIPT}`);
  console.log(`SearchSynonym ${row.id} "${row.term}": ${row.synonyms.length} synonyms now`);
  console.log(`Missing spellings: ${toAdd.length > 0 ? toAdd.join(", ") : "(none)"}`);
  if (toAdd.length === 0) {
    console.log("Nothing to add.");
    return;
  }
  const collisions = await findCollisions(db, row.id, toAdd);
  if (collisions.length > 0) throw new Error(`Spellings already used elsewhere: ${collisions.join(", ")}; aborting`);
  if (row.synonyms.length + toAdd.length > MAX_SYNONYMS_PER_TERM) {
    throw new Error(`Would exceed ${MAX_SYNONYMS_PER_TERM} synonyms per term; aborting`);
  }

  if (!APPLY) {
    console.log(`Checks passed. Would set synonyms to: ${[...row.synonyms, ...toAdd].join(", ")}`);
    console.log("Re-run with --apply to write.");
    return;
  }

  await dbTx(async (tx) => {
    // Re-read inside the transaction so a concurrent admin edit is not overwritten.
    const locked = await findCityRow(tx);
    const add = plan(locked);
    if (add.length === 0) return;
    const after = [...locked.synonyms, ...add];
    await tx.searchSynonym.update({ where: { id: locked.id }, data: { synonyms: after } });
    await writeAuditLogTx(tx, {
      ...ACTOR,
      action: "UPDATE",
      entityType: "SearchSynonym",
      entityId: locked.id,
      entityRef: locked.term,
      before: { synonyms: locked.synonyms },
      after: { synonyms: after },
      meta: {
        script: SCRIPT,
        reason: 'LINE 2026-10-20: "คอยเย็นซี๊ดตี้09" (Honda City) was read as Ford Fiesta; add the City spelling family',
      },
    });
  });
  console.log(`Added ${toAdd.length} spellings to "${row.term}" and wrote 1 AuditLog row.`);

  try {
    const rows = await refreshSearchKeywordIndex();
    console.log(`Search-keyword index rebuilt (${rows} rows).`);
  } catch (error) {
    console.warn(
      `Search-keyword rebuild failed (${error instanceof Error ? error.message : String(error)}); the daily cron will rebuild it.`,
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
