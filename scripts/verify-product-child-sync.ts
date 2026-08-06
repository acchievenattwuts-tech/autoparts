import assert from "node:assert/strict";
import { db } from "@/lib/db";
import { planCollectionSync } from "@/lib/collection-sync";

const key = (values: readonly unknown[]): string => JSON.stringify(values);

async function main(): Promise<void> {
  const products = await db.product.findMany({
    select: {
      id: true,
      units: { select: { id: true, name: true, scale: true, isBase: true } },
      images: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, url: true, alt: true, sortOrder: true, isPrimary: true },
      },
      aliases: { select: { id: true, alias: true, kind: true } },
      carModels: {
        select: {
          id: true,
          fitmentType: true,
          carModelId: true,
          submodel: true,
          yearStart: true,
          yearEnd: true,
          engineCode: true,
          engineSize: true,
          note: true,
        },
      },
    },
  });

  for (const product of products) {
    const plans = [
      planCollectionSync({
        existing: product.units,
        desired: product.units,
        existingKey: (row) => row.name,
        desiredKey: (row) => row.name,
      }),
      planCollectionSync({
        existing: product.images,
        desired: product.images,
        existingKey: (row) => row.url,
        desiredKey: (row) => row.url,
      }),
      planCollectionSync({
        existing: product.aliases,
        desired: product.aliases,
        existingKey: (row) => key([row.alias, row.kind]),
        desiredKey: (row) => key([row.alias, row.kind]),
      }),
      planCollectionSync({
        existing: product.carModels,
        desired: product.carModels,
        existingKey: (row) => key([
          product.id,
          row.fitmentType,
          row.carModelId,
          row.submodel,
          row.yearStart,
          row.yearEnd,
          row.engineCode,
          row.engineSize,
          row.note,
        ]),
        desiredKey: (row) => key([
          product.id,
          row.fitmentType,
          row.carModelId,
          row.submodel,
          row.yearStart,
          row.yearEnd,
          row.engineCode,
          row.engineSize,
          row.note,
        ]),
      }),
    ];
    for (const plan of plans) {
      assert.equal(plan.create.length, 0, `${product.id}: unchanged rows planned for create`);
      assert.equal(plan.deleteIds.length, 0, `${product.id}: unchanged rows planned for delete`);
    }
  }

  console.log(`PASS product child no-op parity for ${products.length} products`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
