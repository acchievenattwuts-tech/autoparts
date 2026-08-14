/**
 * Audits and optionally adds the dedicated Mazda BT-50 Pro master fitment for
 * products that already have the confirmed legacy shape Mazda BT-50/submodel Pro.
 *
 * Dry-run (default): npm run audit:bt50-pro-fitments
 * Apply:             npm run remediate:bt50-pro-fitments
 */
import { db } from "@/lib/db";
import {
  selectBt50ProRemediationCandidates,
  type Bt50ProAuditProduct,
} from "@/lib/bt50-pro-fitment-remediation";

const apply = process.argv.includes("--apply");

async function main(): Promise<void> {
  const models = await db.carModel.findMany({
    where: {
      isActive: true,
      name: { in: ["BT-50", "BT-50 Pro"] },
      carBrand: { isActive: true, name: { equals: "Mazda", mode: "insensitive" } },
    },
    select: { id: true, name: true },
  });
  const legacyModel = models.find((model) => model.name === "BT-50");
  const targetModel = models.find((model) => model.name === "BT-50 Pro");
  if (!legacyModel || !targetModel || models.length !== 2) {
    throw new Error(`Expected one active Mazda BT-50 and BT-50 Pro master; found ${JSON.stringify(models)}`);
  }

  const rows = await db.product.findMany({
    where: {
      isActive: true,
      carModels: { some: { carModelId: legacyModel.id } },
    },
    select: {
      id: true,
      code: true,
      name: true,
      aliases: { select: { alias: true } },
      carModels: {
        where: { carModelId: { in: [legacyModel.id, targetModel.id] } },
        select: {
          id: true,
          carModelId: true,
          submodel: true,
          yearStart: true,
          yearEnd: true,
          engineCode: true,
          engineSize: true,
          fitmentType: true,
          note: true,
          carModel: { select: { name: true, carBrand: { select: { name: true } } } },
        },
      },
    },
    orderBy: { code: "asc" },
  });

  const products: Bt50ProAuditProduct[] = rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    aliases: row.aliases.map((alias) => alias.alias),
    fitments: row.carModels.map((fitment) => ({
      id: fitment.id,
      carModelId: fitment.carModelId,
      carBrandName: fitment.carModel.carBrand.name,
      carModelName: fitment.carModel.name,
      submodel: fitment.submodel,
      yearStart: fitment.yearStart,
      yearEnd: fitment.yearEnd,
      engineCode: fitment.engineCode,
      engineSize: fitment.engineSize,
      fitmentType: fitment.fitmentType,
      note: fitment.note,
    })),
  }));
  const candidates = selectBt50ProRemediationCandidates(products);

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", candidates: candidates.map((row) => ({
    productCode: row.productCode,
    productName: row.productName,
    sourceFitmentId: row.source.id,
    yearStart: row.source.yearStart,
    yearEnd: row.source.yearEnd,
    fitmentType: row.source.fitmentType,
  })) }, null, 2));

  if (!apply || candidates.length === 0) return;

  let created = 0;
  await db.$transaction(async (tx) => {
    for (const candidate of candidates) {
      const source = candidate.source;
      const exists = await tx.productFitment.findFirst({
        where: {
          productId: candidate.productId,
          carModelId: targetModel.id,
          submodel: source.submodel,
          yearStart: source.yearStart,
          yearEnd: source.yearEnd,
          engineCode: source.engineCode,
          fitmentType: source.fitmentType as "DIRECT" | "COMPATIBLE",
        },
        select: { id: true },
      });
      if (exists) continue;
      await tx.productFitment.create({
        data: {
          productId: candidate.productId,
          carModelId: targetModel.id,
          submodel: source.submodel,
          yearStart: source.yearStart,
          yearEnd: source.yearEnd,
          engineCode: source.engineCode,
          engineSize: source.engineSize,
          fitmentType: source.fitmentType as "DIRECT" | "COMPATIBLE",
          note: source.note,
        },
      });
      created += 1;
    }
  });

  console.log(JSON.stringify({ created, targetModel: targetModel.name }, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
