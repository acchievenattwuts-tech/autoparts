import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("returns not-answered for empty input", async () => {
  const { answerFromChatFaq } = await import("@/lib/chat-core/faq");
  assert.deepEqual(await answerFromChatFaq({ text: "" }), { answered: false, reply: "" });
  assert.deepEqual(await answerFromChatFaq({ text: null }), { answered: false, reply: "" });
});

test("returns not-answered when Gemini keys are not configured", async () => {
  const { answerFromChatFaq } = await import("@/lib/chat-core/faq");
  // No GEMINI keys in the test env → degrades safely instead of throwing.
  const result = await answerFromChatFaq({ text: "ส่งต่างจังหวัดไหม" });
  assert.equal(result.answered, false);
});

test("admin-only topics never reach a Knowledge RAG answer", async () => {
  const { answerFromChatFaq } = await import("@/lib/chat-core/faq");
  for (const text of ["ประกันกี่วัน", "คืนสินค้าได้ไหม", "ค่าส่งเท่าไร", "ส่งต่างจังหวัดไหม"]) {
    assert.deepEqual(await answerFromChatFaq({ text }), { answered: false, reply: "" });
  }
});
