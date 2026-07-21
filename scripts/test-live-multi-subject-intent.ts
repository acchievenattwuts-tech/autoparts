import assert from "node:assert/strict";

import { LineIntent } from "@/lib/generated/prisma";
import { db } from "@/lib/db";
import { extractChatSearchIntent } from "@/lib/chat-core/ai-service";
import { detectChatMultiSubjects } from "@/lib/chat-core/multi-subject-detector";

const cases = [
  { text: "วาล์ว/ไดรเออร์มิตซูไททันปี13", expected: "multi" },
  { text: "วาล์ว triton กับ ไดรเออร์ triton", expected: "multi" },
  { text: "น้ำมันคอมแอร์ Triton ปี 2013", expected: "single" },
  { text: "หน้าคลัชคอมแอร์ Triton ปี 2013", expected: "single" },
  { text: "วาล์วคอยล์เย็น Triton ปี 2013", expected: "single" },
  { text: "พัดลมตู้แอร์ Triton ปี 2013", expected: "single" },
  { text: "ไดเออร์ หรือ ไดรเออร์ Triton ปี 2013", expected: "single" },
  { text: "วาล์ว Triton กับ ไดรเออร์ D-Max", expected: "structured_or_handoff" },
] as const;

async function main(): Promise<void> {
  const results = [];
  for (const scenario of cases) {
    const intent = await extractChatSearchIntent({
      intent: LineIntent.PRODUCT_INQUIRY_TEXT,
      latestText: scenario.text,
      history: [],
    });
    const detection = await detectChatMultiSubjects({ text: scenario.text, intent });
    const subjectCount = detection.subjects?.length ?? 0;

    if (scenario.expected === "multi") {
      assert.ok(subjectCount >= 2, `${scenario.text}: expected multi, got ${subjectCount}`);
      assert.equal(detection.handoffReason, null);
    } else if (scenario.expected === "single") {
      assert.ok(subjectCount < 2, `${scenario.text}: single category became multi`);
      assert.equal(detection.handoffReason, null);
    } else {
      assert.ok(
        subjectCount >= 2 || detection.handoffReason === "AMBIGUOUS_VEHICLE_BINDING",
        `${scenario.text}: different vehicle binding was neither structured nor handed off`,
      );
    }

    results.push({
      text: scenario.text,
      llmGroup: intent?.group ?? null,
      llmSubjects: intent?.subjects?.length ?? 0,
      detectorSource: detection.source,
      detectedSubjects: subjectCount,
      handoffReason: detection.handoffReason,
      categories: detection.categories,
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
