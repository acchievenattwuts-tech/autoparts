import { db } from "../../lib/db";
import { buildUniqueSlug } from "../../lib/slug-helpers";
import { isPlaceholderSlug } from "../../lib/product-slug";

async function backfillCategorySlugs() {
  const categories = await db.category.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, slug: true },
  });

  const taken = new Set(
    categories.flatMap((category) =>
      category.slug && !isPlaceholderSlug(category.slug) ? [category.slug] : [],
    ),
  );

  let updated = 0;
  const updatedCategories: string[] = [];

  for (const category of categories) {
    const normalizedStoredSlug = category.slug?.normalize("NFC") ?? null;
    const needsUnicodeNormalization =
      category.slug !== null && category.slug !== normalizedStoredSlug;

    if (category.slug && !isPlaceholderSlug(category.slug) && !needsUnicodeNormalization) {
      continue;
    }

    const slug = buildUniqueSlug({
      value: category.name,
      taken,
      fallback: "category",
    });

    await db.category.update({
      where: { id: category.id },
      data: { slug },
    });

    updated += 1;
    updatedCategories.push(`${category.name} -> ${slug}`);
  }

  return { updated, updatedCategories };
}

async function backfillProductSlugs() {
  const products = await db.product.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, name: true, code: true, slug: true },
  });

  const taken = new Set(
    products.flatMap((product) =>
      product.slug && !isPlaceholderSlug(product.slug) ? [product.slug] : [],
    ),
  );
  let updated = 0;
  const updatedProducts: string[] = [];

  for (const product of products) {
    const normalizedStoredSlug = product.slug?.normalize("NFC") ?? null;
    const needsUnicodeNormalization =
      product.slug !== null && product.slug !== normalizedStoredSlug;

    if (product.slug && !isPlaceholderSlug(product.slug) && !needsUnicodeNormalization) {
      continue;
    }

    const slug = buildUniqueSlug({
      value: product.name,
      taken,
      fallback: "product",
      extraCandidates: [product.code],
    });

    await db.product.update({
      where: { id: product.id },
      data: { slug },
    });

    updated += 1;
    updatedProducts.push(`${product.name} -> ${slug}`);
  }

  return { updated, updatedProducts };
}

async function main() {
  const { updated: categoryUpdates, updatedCategories } = await backfillCategorySlugs();
  const { updated: productUpdates, updatedProducts } = await backfillProductSlugs();

  console.log(
    `Slug backfill complete. Categories updated: ${categoryUpdates}. Products updated: ${productUpdates}.`,
  );

  if (updatedCategories.length > 0) {
    console.log("Updated categories:");
    updatedCategories.forEach((entry) => console.log(`- ${entry}`));
  }

  if (updatedProducts.length > 0) {
    console.log("Updated products:");
    updatedProducts.forEach((entry) => console.log(`- ${entry}`));
  }
}

main()
  .catch((error) => {
    console.error("Slug backfill failed.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
