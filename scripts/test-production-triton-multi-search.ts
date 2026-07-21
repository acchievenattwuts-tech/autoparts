import assert from "node:assert/strict";

import { db } from "@/lib/db";
import { resolveChatFitmentFilters } from "@/lib/chat-core/fitment-resolve";

async function main(): Promise<void> {
  const subjects = ["วาล์ว", "ไดรเออร์"];
  const expectedCodes = ["P0096", "P0304", "P0351"];
  const products = await db.product.findMany({
    where: { code: { in: expectedCodes }, isActive: true },
    select: {
      code: true,
      name: true,
      category: { select: { name: true } },
      carModels: {
        select: {
          yearStart: true,
          yearEnd: true,
          carModel: { select: { name: true } },
        },
      },
    },
  });
  assert.deepEqual(new Set(products.map((product) => product.code)), new Set(expectedCodes));
  const results = [];

  for (const partType of subjects) {
    const query = `${partType} Triton 2013`;
    const filters = await resolveChatFitmentFilters({
      partType,
      carBrand: "Mitsubishi",
      carModel: "Triton",
      queryText: query,
      rawText: query,
    });
    assert.ok(filters.categoryName, `${partType}: category did not resolve`);
    assert.equal(filters.carModelName, "Triton", `${partType}: Triton did not resolve`);
    const eligibleCodes = products
      .filter((product) => product.category.name === filters.categoryName)
      .filter((product) =>
        product.carModels.some(
          (fitment) =>
            fitment.carModel.name === filters.carModelName &&
            (fitment.yearStart === null || fitment.yearStart <= 2013) &&
            (fitment.yearEnd === null || fitment.yearEnd >= 2013),
        ),
      )
      .map((product) => product.code);
    assert.ok(eligibleCodes.length > 0, `${partType}: no expected code is eligible for Triton 2013`);
    results.push({
      partType,
      filters,
      eligibleCodes,
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
