import { db } from "@/lib/db";
import { searchProductIdsV2 } from "@/lib/product-search";

type GoldenCase = {
  query: string;
  topName?: RegExp;
  topCode?: RegExp;
  maxResults?: number;
};

const GOLDEN_CASES: GoldenCase[] = [
  { query: "P0104", topCode: /^P0104$/i },
  { query: "หม้อน้ำ mazda 2", topName: /หม้อน้ำ/i },
  { query: "ตัวทำความเย็นแอร์วีออส", topName: /(คอยล์เย็น|ตู้แอร์|evaporator)/i },
  { query: "ฟองน้ำแอร์", topName: /ฟองน้ำ/i },
  { query: "ร้านอยู่ที่ไหน", maxResults: 0 },
];

async function main(): Promise<void> {
  let failed = 0;
  for (const golden of GOLDEN_CASES) {
    const startedAt = performance.now();
    const result = await searchProductIdsV2(
      {
        query: golden.query,
        isActive: true,
        skip: 0,
        take: 5,
        cacheProfile: "admin",
      },
      { bypassInternalCaches: true },
    );
    const elapsedMs = Math.round(performance.now() - startedAt);
    const products = await db.product.findMany({
      where: { id: { in: result.ids } },
      select: { id: true, code: true, name: true },
    });
    const byId = new Map(products.map((product) => [product.id, product]));
    const ranked = result.ids.map((id) => byId.get(id)).filter(Boolean);
    const top = ranked[0];
    const passed =
      (golden.maxResults === undefined || result.total <= golden.maxResults) &&
      (!golden.topCode || Boolean(top && golden.topCode.test(top.code))) &&
      (!golden.topName || Boolean(top && golden.topName.test(top.name)));
    if (!passed) failed += 1;
    console.log(JSON.stringify({
      query: golden.query,
      passed,
      elapsedMs,
      total: result.total,
      retrievalMode: result.retrievalMode,
      vectorOnly: result.vectorOnlyProductIds?.length ?? 0,
      top: ranked.map((product) => product && ({ code: product.code, name: product.name })),
    }));
  }
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("[evaluate-search-v2] failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void db.$disconnect();
  });
