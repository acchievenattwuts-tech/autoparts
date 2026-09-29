import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@/lib/generated/prisma";
import { preloadSaleDependencies } from "@/lib/sale-core";

test("golden concurrent sale waits for DN SKU lock before capturing new cost 150", async () => {
  const events: string[] = [];
  let releaseLock!: () => void;
  let cost = 100;
  const lockBarrier = new Promise<void>((resolve) => { releaseLock = resolve; });
  const tx = {
    $queryRaw: async (query: { values: unknown[] }) => {
      assert.deepEqual(query.values, ["sku-a", "sku-b"]);
      events.push("wait-for-DN");
      await lockBarrier;
      events.push("sale-lock-acquired");
      return [];
    },
    productUnit: { findMany: async () => [{ productId: "sku-a", name: "piece", scale: 1 }, { productId: "sku-b", name: "piece", scale: 1 }] },
    product: { findMany: async () => {
      events.push("read-cost");
      return ["sku-a", "sku-b"].map((id) => ({ id, avgCost: new Prisma.Decimal(cost), costPrice: new Prisma.Decimal(100),
        salePrice: new Prisma.Decimal(200), retailPrice: new Prisma.Decimal(200), memberPrice: new Prisma.Decimal(200),
        inventoryTracking: "TRACKED", isLotControl: false }));
    } },
  } as unknown as Prisma.TransactionClient;
  const saleRead = preloadSaleDependencies(tx, [{ productId: "sku-b", unitName: "piece" }, { productId: "sku-a", unitName: "piece" }]);
  assert.deepEqual(events, ["wait-for-DN"]);
  cost = 150;
  events.push("DN-committed");
  releaseLock();
  const { productMap } = await saleRead;
  assert.equal(Number(productMap.get("sku-a")?.avgCost), 150);
  assert.deepEqual(events, ["wait-for-DN", "DN-committed", "sale-lock-acquired", "read-cost"]);
});
