import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

/**
 * Seeds Thai spelling aliases for each active CarBrand so the LINE search guard
 * grounds a brand the customer typed in Thai (e.g. "โตโยต้า" → "Toyota").
 *
 * The brand's canonical English name is matched automatically by the lookup
 * builder, so only the Thai (and common alt) spellings are seeded here. Brands
 * with no widely-used Thai spelling (e.g. Roewe, UD) are left English-only.
 */
type CarBrandAliasSeed = {
  /** Matched case-insensitively against CarBrand.name. */
  brandName: string;
  /** Thai / alternate spellings customers actually type. */
  aliases: string[];
};

const carBrandAliasSeeds: CarBrandAliasSeed[] = [
  { brandName: "Toyota", aliases: ["โตโยต้า", "โตโยตา"] },
  { brandName: "Honda", aliases: ["ฮอนด้า", "ฮอนดา"] },
  { brandName: "Nissan", aliases: ["นิสสัน", "นิสสน", "นิสัน"] },
  { brandName: "Mazda", aliases: ["มาสด้า"] },
  { brandName: "Mitsubishi", aliases: ["มิตซูบิชิ", "มิตซู", "มิซู", "มิซูบิชิ", "mitsubisi"] },
  { brandName: "Isuzu", aliases: ["อีซูซุ", "อีซุซุ", "อีซูสุ", "อิซูซุ", "อิซูสุ", "isusu"] },
  { brandName: "Suzuki", aliases: ["ซูซูกิ", "ซูซุกิ"] },
  { brandName: "Ford", aliases: ["ฟอร์ด"] },
  { brandName: "Chevrolet", aliases: ["เชฟโรเลต", "เชฟโรเล็ต", "เชฟ", "chevy"] },
  { brandName: "Hyundai", aliases: ["ฮุนได", "ฮุนไดย์"] },
  { brandName: "Lexus", aliases: ["เล็กซัส", "เลกซัส"] },
  { brandName: "HINO", aliases: ["ฮีโน่", "ฮีโน"] },
  { brandName: "MG", aliases: ["เอ็มจี"] },
  { brandName: "UD", aliases: ["ยูดี", "ยูดีทรัค", "ud truck", "ud trucks"] },
  { brandName: "Volkswagen", aliases: ["โฟล์ค", "โฟล์ก", "โฟล์คสวาเกน", "โฟล์กสวาเกน", "vw"] },
  { brandName: "Roewe", aliases: ["โรวี", "โรวี่", "โรเว่"] },
];

const main = async () => {
  const { db } = await import("../lib/db");
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const seed of carBrandAliasSeeds) {
    const brand = await db.carBrand.findFirst({
      where: { name: { equals: seed.brandName, mode: "insensitive" } },
      select: { id: true, name: true },
    });

    if (!brand) {
      skipped += seed.aliases.length;
      console.warn(`Skip aliases for missing brand: ${seed.brandName}`);
      continue;
    }

    // Dedupe within a brand (some lists intentionally repeat for readability).
    const seen = new Set<string>();
    for (const raw of seed.aliases) {
      const alias = raw.trim().toLowerCase();
      // Skip the canonical English name — the lookup builder adds it automatically.
      if (!alias || alias === brand.name.trim().toLowerCase() || seen.has(alias)) continue;
      seen.add(alias);

      const before = await db.carBrandAlias.findUnique({
        where: { alias },
        select: { id: true },
      });

      await db.carBrandAlias.upsert({
        where: { alias },
        create: {
          carBrandId: brand.id,
          alias,
          notes: "Seeded Thai↔English brand spelling for LINE search guard.",
        },
        update: { carBrandId: brand.id, isActive: true },
      });

      if (before) updated += 1;
      else created += 1;
    }
  }

  console.log(JSON.stringify({ created, updated, skipped }, null, 2));
  await db.$disconnect();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
