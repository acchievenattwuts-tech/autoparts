import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVED_KNOWLEDGE_ARTICLE_SLUGS,
  buildKnowledgeSourceHash,
  getApprovedKnowledgeDocuments,
} from "@/lib/knowledge-corpus";
import { parseGroundedKnowledgeAnswer } from "@/lib/chat-core/knowledge-rag";
import {
  formatKnowledgeDocumentForEmbedding,
  formatKnowledgeQueryForEmbedding,
  getKnowledgeEmbeddingModelId,
} from "@/lib/knowledge-embeddings";
import { routeChatIntent } from "@/lib/chat-core/intent-router";
import { LineIntent, LineMessageType } from "@/lib/generated/prisma";
import { isKnowledgeDocumentStale, type CurrentKnowledgeRow } from "@/lib/knowledge-sync";

test("knowledge corpus includes only the reviewed low-risk article allowlist", () => {
  const documents = getApprovedKnowledgeDocuments();
  const articleSlugs = new Set(
    documents
      .filter((document) => document.sourceType === "TECHNICAL_GUIDE")
      .map((document) => document.sourceRef),
  );
  assert.deepEqual([...articleSlugs].sort(), [...APPROVED_KNOWLEDGE_ARTICLE_SLUGS].sort());
  assert.ok(!articleSlugs.has("denso-compressor-warranty-guide"));
  assert.ok(!articleSlugs.has("how-to-check-genuine-auto-ac-parts"));
});

test("knowledge embeddings use an isolated model and query/document prefixes", () => {
  const previous = process.env.GOOGLE_AI_KNOWLEDGE_EMBEDDING_MODEL;
  process.env.GOOGLE_AI_KNOWLEDGE_EMBEDDING_MODEL = "knowledge-model-test";
  try {
    assert.equal(getKnowledgeEmbeddingModelId(), "knowledge-model-test:768");
    assert.match(formatKnowledgeQueryForEmbedding("ส่งไหม"), /task: question answering \| query:/);
    assert.match(formatKnowledgeDocumentForEmbedding("จัดส่งทั่วประเทศ"), /document:/);
  } finally {
    if (previous === undefined) delete process.env.GOOGLE_AI_KNOWLEDGE_EMBEDDING_MODEL;
    else process.env.GOOGLE_AI_KNOWLEDGE_EMBEDDING_MODEL = previous;
  }
});

test("grounded answer rejects missing or invented citations", () => {
  const rows = [
    {
      id: "faq:shipping-general",
      title: "การจัดส่ง",
      section_heading: "ทั่วไป",
      content: "จัดส่งทั่วประเทศ",
      answer_scope: "ข้อมูลทั่วไป",
      source_urls: ["https://example.com/faq"],
      semantic_score: 0.8,
      lexical_score: 0.1,
      hybrid_score: 0.66,
    },
  ];
  assert.deepEqual(
    parseGroundedKnowledgeAnswer(
      '{"answerSupported":true,"reply":"ส่งได้ค่ะ","citations":["invented"]}',
      rows,
    ),
    { answered: false, reply: "", citations: [] },
  );
  assert.equal(
    parseGroundedKnowledgeAnswer(
      '{"answerSupported":true,"reply":"ส่งได้ค่ะ","citations":["faq:shipping-general"]}',
      rows,
    ).answered,
    true,
  );
});

test("policy information stays eligible for RAG while an active claim requires admin", () => {
  const policy = routeChatIntent({
    messageType: LineMessageType.TEXT,
    text: "นโยบายคืนสินค้าภายในกี่วัน",
  });
  assert.equal(policy.intent, LineIntent.UNKNOWN);
  assert.equal(policy.requiresAdmin, false);

  const activeClaim = routeChatIntent({
    messageType: LineMessageType.TEXT,
    text: "ขอเคลมสินค้าชิ้นนี้",
  });
  assert.equal(activeClaim.intent, LineIntent.CLAIM_OR_RETURN);
  assert.equal(activeClaim.requiresAdmin, true);
});

test("auto-sync detects source edits and ignores an identical indexed row", () => {
  const document = getApprovedKnowledgeDocuments()[0];
  assert.ok(document);
  const current: CurrentKnowledgeRow = {
    id: document.id,
    source_type: document.sourceType,
    source_ref: document.sourceRef,
    title: document.title,
    section_heading: document.sectionHeading,
    content: document.content,
    answer_scope: document.answerScope,
    risk_level: document.riskLevel,
    status: "APPROVED",
    source_urls: document.sourceUrls,
    metadata: document.metadata,
    search_text: [
      `title: ${document.title}`,
      `section: ${document.sectionHeading}`,
      `text: ${document.content}`,
      `answer scope: ${document.answerScope}`,
    ].join(" | "),
    embedding_model: "test-model:768",
    embedding_source_hash: "test-hash",
    has_embedding: true,
  };
  // Model/hash are intentionally supplied to isolate field-level change detection.
  const sourceHash = buildKnowledgeSourceHash(document);
  current.embedding_source_hash = sourceHash;
  assert.equal(isKnowledgeDocumentStale(document, current, "test-model:768"), false);
  assert.equal(
    isKnowledgeDocumentStale(document, { ...current, content: `${current.content} changed` }, "test-model:768"),
    true,
  );
});
