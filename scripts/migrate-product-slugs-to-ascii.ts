/**
 * One-time migration: convert non-ASCII Product.slug values to ASCII.
 *
 * Usage:
 *   npx tsx scripts/migrate-product-slugs-to-ascii.ts           # dry-run (no DB writes)
 *   npx tsx scripts/migrate-product-slugs-to-ascii.ts --apply   # apply changes
 *
 * Behavior:
 *   - Reads every Product row.
 *   - For products whose stored slug is null or contains non-ASCII characters,
 *     regenerates an ASCII slug from the product name using the same logic as
 *     getProductSlug (cap 60 chars at word boundary, code fallback, "item" last).
 *   - Ensures the new slug is unique against the in-memory set of all kept slugs.
 *   - In dry-run mode (default), prints the plan but does not write.
 *   - With --apply, updates each affected row inside a single transaction batch.
 */

import { db } from "../lib/db";
import { buildUniqueSlug } from "../lib/slug-helpers";
import { slugifyAsciiSegment } from "../lib/product-slug";

const PRODUCT_SLUG_MAX_LENGTH = 60;
const BATCH_SIZE = 50;

const isAsciiPureSlug = (slug: string): boolean => /^[a-z0-9-]+$/.test(slug);

const capSlugAtWordBoundary = (slug: string, maxLength: number): string => {
  if (slug.length <= maxLength) return slug;
  const truncated = slug.slice(0, maxLength);
  const lastDash = truncated.lastIndexOf("-");
  const candidate = lastDash > 0 ? truncated.slice(0, lastDash) : truncated;
  return candidate.replace(/-+$/g, "");
};

const cappedAsciiSlugify = (value: string): string => {
  const slug = slugifyAsciiSegment(value);
  return capSlugAtWordBoundary(slug, PRODUCT_SLUG_MAX_LENGTH);
};

type ProductRow = {
  id: string;
  code: string;
  name: string;
  slug: string | null;
};

type PlanRow = {
  id: string;
  code: string;
  name: string;
  oldSlug: string | null;
  newSlug: string;
};

const buildPlan = (products: ProductRow[]): PlanRow[] => {
  const takenSlugs = new Set<string>();
  const plan: PlanRow[] = [];

  // First pass: keep slugs that are already ASCII-pure as-is.
  for (const product of products) {
    if (product.slug && isAsciiPureSlug(product.slug)) {
      takenSlugs.add(product.slug);
    }
  }

  // Second pass: regenerate for the rest.
  for (const product of products) {
    if (product.slug && isAsciiPureSlug(product.slug)) {
      continue;
    }

    const fallback = product.code.toLowerCase() || "product";
    const newSlug = buildUniqueSlug({
      value: product.name,
      taken: takenSlugs,
      fallback,
      extraCandidates: [product.code],
      slugify: cappedAsciiSlugify,
    });

    plan.push({
      id: product.id,
      code: product.code,
      name: product.name,
      oldSlug: product.slug,
      newSlug,
    });
  }

  return plan;
};

const run = async () => {
  const applyFlag = process.argv.includes("--apply");
  const mode = applyFlag ? "APPLY" : "DRY-RUN";

  console.log(`\nProduct slug migration — mode: ${mode}\n`);

  const products = await db.product.findMany({
    select: { id: true, code: true, name: true, slug: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Loaded ${products.length} product(s) from database.`);

  const plan = buildPlan(products);

  if (plan.length === 0) {
    console.log("No products require slug migration. Done.");
    return;
  }

  console.log(`\n${plan.length} product(s) will be updated:\n`);
  for (const row of plan) {
    console.log(
      `  [${row.code}] ${row.name}\n    old: ${row.oldSlug ?? "(null)"}\n    new: ${row.newSlug}`,
    );
  }

  if (!applyFlag) {
    console.log("\nDry-run complete. Re-run with --apply to write changes.\n");
    return;
  }

  console.log(`\nApplying changes in batches of ${BATCH_SIZE}...`);

  let applied = 0;
  for (let offset = 0; offset < plan.length; offset += BATCH_SIZE) {
    const batch = plan.slice(offset, offset + BATCH_SIZE);
    await db.$transaction(
      batch.map((row) =>
        db.product.update({
          where: { id: row.id },
          data: { slug: row.newSlug },
        }),
      ),
    );
    applied += batch.length;
    console.log(`  Updated ${applied}/${plan.length}`);
  }

  console.log(`\nDone. Migrated ${applied} product slug(s).\n`);
};

run()
  .catch((error) => {
    console.error("Migration failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
