import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVED_KNOWLEDGE_ARTICLE_SLUGS,
  buildKnowledgeSourceHash,
  getApprovedKnowledgeDocuments,
} from "@/lib/knowledge-corpus";
import {
  isKnowledgeRagHumanOnlyQuestion,
  parseGroundedKnowledgeAnswer,
} from "@/lib/chat-core/knowledge-rag";
import {
  formatKnowledgeDocumentForEmbedding,
  formatKnowledgeQueryForEmbedding,
  getKnowledgeEmbeddingModelId,
} from "@/lib/knowledge-embeddings";
import { routeChatIntent } from "@/lib/chat-core/intent-router";
import { LineIntent, LineMessageType } from "@/lib/generated/prisma";
import { isKnowledgeDocumentStale, type CurrentKnowledgeRow } from "@/lib/knowledge-sync";
import {
  buildJuneAdminOnlyHandoffMessage,
  detectAdminOnlyKnowledgeTopic,
  findKnowledgeRagPolicyViolations,
  knowledgeRagPolicyError,
} from "@/lib/chat-core/admin-only-knowledge";

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
      title_score: 0.1,
      section_score: 0.1,
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

test("warranty, returns and shipping are admin-only with June-style replies", () => {
  const cases = [
    ["นโยบายคืนสินค้าภายในกี่วัน", "warranty_return"],
    ["ประกันสินค้ากี่เดือน", "warranty_return"],
    ["ค่าจัดส่งเท่าไร", "shipping"],
    ["ส่งต่างจังหวัดไหม", "shipping"],
    ["ค่าสงเท่าไหร", "shipping"],
    ["สงตจวมั้ย", "shipping"],
    ["จัดสงได้ไหม", "shipping"],
    ["รหัสไปรสนี 60000", "shipping"],
    ["ของเครมได้ไหม", "warranty_return"],
  ] as const;
  for (const [question, topic] of cases) {
    assert.equal(detectAdminOnlyKnowledgeTopic(question), topic);
    assert.match(buildJuneAdminOnlyHandoffMessage(topic), /จูน.*แอดมิน.*แชตนี้/);
    const route = routeChatIntent({ messageType: LineMessageType.TEXT, text: question });
    assert.equal(route.requiresAdmin, true);
    assert.ok(
      route.intent === LineIntent.CLAIM_OR_RETURN || route.intent === LineIntent.SHIPPING_ADDRESS,
    );
  }
});

test("product and transaction hard negatives never enter Knowledge RAG", () => {
  for (const question of [
    "คอมแอร์รุ่นนี้ราคาเท่าไร",
    "มีของพร้อมส่งไหม",
    "อะไหล่ตัวนี้ใส่รถผมได้ไหม",
    "ขอใบเสนอราคาสินค้าชุดนี้",
  ]) {
    assert.equal(isKnowledgeRagHumanOnlyQuestion(question), true);
  }
});

test("knowledge CMS policy blocks admin-only overview and enabled sections", () => {
  const base = {
    title: "วิธีเตรียมข้อมูลก่อนสั่งซื้อ",
    description: "ข้อมูลทั่วไป",
    content: {
      intro: "เตรียมรุ่นรถ ปีรถ และรูปอะไหล่เดิม",
      highlights: [] as string[],
      sections: [
        {
          heading: "ค่าจัดส่ง",
          body: ["สอบถามค่าจัดส่งก่อนสั่งซื้อ"],
          format: "PARAGRAPHS" as const,
          aiEnabled: true,
        },
      ],
      relatedSearches: [] as string[],
      internalLinks: [],
      readingMinutes: 3,
    },
    ragEnabled: true,
  };
  assert.deepEqual(findKnowledgeRagPolicyViolations(base), [
    { topic: "shipping", scope: "SECTION", sectionIndex: 0 },
  ]);
  assert.match(knowledgeRagPolicyError(base) ?? "", /หัวข้อที่ 1.*แอดมิน/);

  const sourceBlocked = {
    ...base,
    title: "นโยบายการคืนสินค้า",
    content: {
      ...base.content,
      sections: [{ ...base.content.sections[0]!, aiEnabled: false }],
    },
  };
  assert.deepEqual(findKnowledgeRagPolicyViolations(sourceBlocked), [
    { topic: "warranty_return", scope: "SOURCE" },
  ]);
  assert.equal(
    findKnowledgeRagPolicyViolations({ ...sourceBlocked, ragEnabled: false }).length,
    0,
  );
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
