import assert from "node:assert/strict";
import test, { mock } from "node:test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

test(
  "product support articles select only summary fields and use the shared cache tag",
  { skip: moduleMocksUnavailable },
  async (): Promise<void> => {
    let receivedQuery: unknown;
    let receivedCacheOptions: unknown;
    const rows = [{
      slug: "how-to-check-oem-part-number-before-ordering",
      activeRevision: {
        title: "ตรวจ OEM ก่อนสั่งซื้อ",
        description: "คำอธิบายย่อ",
        category: "การเลือกซื้ออะไหล่",
      },
    }];

    await mock.module("@/lib/db", {
      namedExports: {
        db: {
          knowledgeSource: {
            findMany: async (query: unknown): Promise<typeof rows> => {
              receivedQuery = query;
              return rows;
            },
          },
        },
      },
    });
    await mock.module("next/cache", {
      namedExports: {
        unstable_cache: <Result>(
          callback: () => Promise<Result>,
          _keyParts?: string[],
          options?: unknown,
        ): (() => Promise<Result>) => {
          receivedCacheOptions = options;
          return callback;
        },
        revalidateTag: (): void => undefined,
      },
    });

    const {
      getProductSupportArticles,
      PRODUCT_SUPPORT_ARTICLE_SLUGS,
    } = await import("@/lib/knowledge-public");
    const { PUBLIC_KNOWLEDGE_CACHE_TAG } = await import("@/lib/knowledge-cache");

    assert.deepEqual(await getProductSupportArticles(), [{
      slug: rows[0]?.slug,
      title: rows[0]?.activeRevision.title,
      description: rows[0]?.activeRevision.description,
      category: rows[0]?.activeRevision.category,
    }]);
    assert.deepEqual(receivedQuery, {
      where: {
        type: "ARTICLE",
        isArchived: false,
        slug: { in: [...PRODUCT_SUPPORT_ARTICLE_SLUGS] },
        activeRevisionId: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      select: {
        slug: true,
        activeRevision: {
          select: {
            title: true,
            description: true,
            category: true,
          },
        },
      },
    });
    assert.deepEqual(receivedCacheOptions, {
      revalidate: 3_600,
      tags: [PUBLIC_KNOWLEDGE_CACHE_TAG],
    });
  },
);
