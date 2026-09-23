import assert from "node:assert/strict";
import test, { mock } from "node:test";

const moduleMocksUnavailable =
  typeof (mock as { module?: unknown }).module !== "function" &&
  "requires --experimental-test-module-mocks";

// Production 20 Sep 2026: the background revalidation of
// `public-knowledge-articles-v1` failed on a single "Connection terminated due
// to connection timeout" because the public knowledge reads skipped
// withDbRetry. Every public read must run inside it.
test(
  "public knowledge repository reads go through withDbRetry",
  { skip: moduleMocksUnavailable },
  async (): Promise<void> => {
    let insideRetry = false;
    const reads: Array<{ method: string; insideRetry: boolean }> = [];

    await mock.module("@/lib/db", {
      namedExports: {
        db: {
          knowledgeSource: {
            findMany: async (): Promise<never[]> => {
              reads.push({ method: "findMany", insideRetry });
              return [];
            },
            findFirst: async (): Promise<null> => {
              reads.push({ method: "findFirst", insideRetry });
              return null;
            },
          },
        },
        withDbRetry: async <T>(fn: () => Promise<T>): Promise<T> => {
          insideRetry = true;
          try {
            return await fn();
          } finally {
            insideRetry = false;
          }
        },
      },
    });

    const {
      listActiveKnowledgeEntries,
      getActiveKnowledgeBySlug,
      getActiveKnowledgeByKey,
    } = await import("@/lib/knowledge-cms-repository");

    assert.deepEqual(await listActiveKnowledgeEntries("ARTICLE"), []);
    assert.equal(await getActiveKnowledgeBySlug("some-article"), null);
    assert.equal(await getActiveKnowledgeByKey("policy:return-warranty"), null);

    assert.deepEqual(reads, [
      { method: "findMany", insideRetry: true },
      { method: "findFirst", insideRetry: true },
      { method: "findFirst", insideRetry: true },
    ]);
  },
);
