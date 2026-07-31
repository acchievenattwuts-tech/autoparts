import assert from "node:assert/strict";
import test from "node:test";
import {
  KNOWLEDGE_FEEDBACK_REASONS,
} from "@/lib/knowledge-rag-feedback";
import { isKnowledgeRagOperationsPersistenceEnabled } from "@/lib/knowledge-rag-operations";

test("Round D operational persistence is disabled inside node:test", () => {
  assert.equal(
    isKnowledgeRagOperationsPersistenceEnabled({
      NODE_TEST_CONTEXT: "child-v8",
    }),
    false,
  );
  assert.equal(
    isKnowledgeRagOperationsPersistenceEnabled({
      KNOWLEDGE_RAG_METRICS_ENABLED: "off",
    }),
    false,
  );
  assert.equal(isKnowledgeRagOperationsPersistenceEnabled({}), true);
});

test("feedback uses a closed reason-code vocabulary without customer text", () => {
  assert.deepEqual(Object.keys(KNOWLEDGE_FEEDBACK_REASONS), [
    "HELPFUL",
    "INCOMPLETE",
    "WRONG_SOURCE",
    "STALE_SOURCE",
    "TOO_VERBOSE",
    "SHOULD_HANDOFF",
    "MISSING_KNOWLEDGE",
  ]);
  for (const label of Object.values(KNOWLEDGE_FEEDBACK_REASONS)) {
    assert.ok(label.length > 3);
  }
});
