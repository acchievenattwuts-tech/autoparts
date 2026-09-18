import assert from "node:assert/strict";
import test, { mock } from "node:test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

test(
  "public knowledge articles persist across requests and share the publication cache tag",
  { skip: moduleMocksUnavailable },
  async (): Promise<void> => {
    let repositoryCalls = 0;
    const cacheRegistrations: Array<{ keyParts?: string[]; options?: unknown }> = [];
    const entry = {
      sourceId: "source-1",
      sourceKey: "article:cached",
      type: "ARTICLE" as const,
      slug: "cached-article",
      revisionId: "revision-1",
      revisionNo: 1,
      title: "Cached article",
      description: "Cached description",
      category: "การเลือกซื้อ",
      content: {
        readingMinutes: 3,
        publishedAt: "2026-09-18",
        intro: "Cached intro",
        highlights: ["Cached highlight"],
        sections: [{ heading: "Cached section", body: ["Cached body"] }],
        relatedSearches: ["cached search"],
        internalLinks: [],
      },
      answerScope: "Public article",
      riskLevel: "LOW" as const,
      ragEnabled: true,
      sourceUrls: [],
      activatedAt: new Date("2026-09-18T00:00:00+07:00"),
      updatedAt: new Date("2026-09-18T00:00:00+07:00"),
    };

    await mock.module("@/lib/db", {
      namedExports: {
        db: {
          knowledgeSource: {
            findMany: async (): Promise<never[]> => [],
          },
        },
      },
    });
    await mock.module("@/lib/knowledge-cms-repository", {
      namedExports: {
        getActiveKnowledgeByKey: async (): Promise<null> => null,
        getActiveKnowledgeBySlug: async (): Promise<null> => null,
        listActiveKnowledgeEntries: async (type?: string): Promise<typeof entry[]> => {
          assert.equal(type, "ARTICLE");
          repositoryCalls += 1;
          return [entry];
        },
      },
    });
    await mock.module("next/cache", {
      namedExports: {
        unstable_cache: <Result>(
          callback: () => Promise<Result>,
          keyParts?: string[],
          options?: unknown,
        ): (() => Promise<Result>) => {
          cacheRegistrations.push({ keyParts, options });
          let cached: Promise<Result> | undefined;
          return (): Promise<Result> => {
            cached ??= callback();
            return cached;
          };
        },
        revalidateTag: (): void => undefined,
      },
    });

    const { getPublicKnowledgeArticles } = await import("@/lib/knowledge-public");
    const { PUBLIC_KNOWLEDGE_CACHE_TAG } = await import("@/lib/knowledge-cache");

    const first = await getPublicKnowledgeArticles();
    const second = await getPublicKnowledgeArticles();

    assert.equal(repositoryCalls, 1);
    assert.deepEqual(second, first);
    assert.equal(first[0]?.slug, entry.slug);
    assert.equal(first[0]?.intro, entry.content.intro);
    assert.deepEqual(
      cacheRegistrations.find(({ keyParts }) => keyParts?.[0] === "public-knowledge-articles-v1"),
      {
        keyParts: ["public-knowledge-articles-v1"],
        options: {
          revalidate: 3_600,
          tags: [PUBLIC_KNOWLEDGE_CACHE_TAG],
        },
      },
    );
  },
);
