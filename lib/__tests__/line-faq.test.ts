import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

test("returns not-answered for empty input", async () => {
  const { answerFromLineFaq } = await import("@/lib/line-faq");
  assert.deepEqual(await answerFromLineFaq({ text: "" }), { answered: false, reply: "" });
  assert.deepEqual(await answerFromLineFaq({ text: null }), { answered: false, reply: "" });
});

test("returns not-answered when Gemini keys are not configured", async () => {
  const { answerFromLineFaq } = await import("@/lib/line-faq");
  // No GEMINI keys in the test env → degrades safely instead of throwing.
  const result = await answerFromLineFaq({ text: "ส่งต่างจังหวัดไหม" });
  assert.equal(result.answered, false);
});
