import { db } from "../../lib/db";
import { syncKnowledgeRag } from "../../lib/knowledge-sync";

async function main(): Promise<void> {
  let totalSynced = 0;
  let totalArchived = 0;
  for (let pass = 1; pass <= 100; pass += 1) {
    const result = await syncKnowledgeRag({ maxDocuments: 8 });
    if (!result.acquired) throw new Error("KNOWLEDGE_SYNC_ALREADY_RUNNING");
    totalSynced += result.synced;
    totalArchived += result.archived;
    console.log(
      `pass=${pass} desired=${result.desired} changed=${result.changed} synced=${result.synced} pending=${result.pending} archived=${result.archived}`,
    );
    if (result.pending === 0) {
      console.log(`Knowledge RAG sync complete: synced=${totalSynced} archived=${totalArchived}.`);
      return;
    }
  }
  throw new Error("KNOWLEDGE_SYNC_MAX_PASSES_EXCEEDED");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
