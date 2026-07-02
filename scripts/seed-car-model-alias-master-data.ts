import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

type CarModelSeed = {
  brandName: string;
  modelName: string;
};

const carModelSeeds: CarModelSeed[] = [{ brandName: "Toyota", modelName: "Hilux Champ" }];

const main = async () => {
  const { db } = await import("../lib/db");
  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const seed of carModelSeeds) {
    const brand = await db.carBrand.findFirst({
      where: { name: { equals: seed.brandName, mode: "insensitive" }, isActive: true },
      select: { id: true },
    });

    if (!brand) {
      skipped += 1;
      console.warn(`Skip car model for missing brand: ${seed.brandName}/${seed.modelName}`);
      continue;
    }

    const before = await db.carModel.findUnique({
      where: { name_carBrandId: { name: seed.modelName, carBrandId: brand.id } },
      select: { id: true },
    });

    await db.carModel.upsert({
      where: { name_carBrandId: { name: seed.modelName, carBrandId: brand.id } },
      create: { name: seed.modelName, carBrandId: brand.id, isActive: true },
      update: { isActive: true },
    });

    if (before) updated += 1;
    else created += 1;
  }

  console.log(JSON.stringify({ created, updated, skipped }, null, 2));
  await db.$disconnect();
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
