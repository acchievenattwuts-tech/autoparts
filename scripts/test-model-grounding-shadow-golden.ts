/**
 * Option B golden/adversarial suite — every-turn car-model grounding SHADOW.
 *
 * This is deliberately separate from the general chat robustness suite. It
 * compares today's live policy (baseline) with the shadow candidate against the
 * real SearchSynonym corpus and customer-like personas: garage owner, mechanic,
 * and vehicle owner. Production behavior is not changed by this suite or Option B.
 *
 * Read-only. Requires DATABASE_URL.
 */
import { db } from "@/lib/db";
import { buildCarModelGroundingLookup } from "@/lib/car-model-alias-cache";
import {
  evaluateChatModelGroundingCandidate,
  guardChatSearchIntent,
} from "@/lib/chat-core/search-guards";
import type { ChatReplyHistoryItem, ChatSearchIntent } from "@/lib/chat-core/ai-service";

type Persona = "อู่" | "ช่าง" | "เจ้าของรถ";
type GoldenCase = {
  persona: Persona;
  label: string;
  latestText: string;
  model: string;
  mention?: string | null;
  history?: ChatReplyHistoryItem[];
  expected: "KEEP" | "DROP";
};

const cases: GoldenCase[] = [
  { persona: "อู่", label: "ไทยติดคำ", latestText: "คอยเย็นวีออส", model: "Vios", mention: "วีออส", expected: "KEEP" },
  { persona: "อู่", label: "LLM เติมรุ่นเอง", latestText: "ขอคอยเย็น", model: "Vios", mention: null, expected: "DROP" },
  { persona: "อู่", label: "พิมพ์อังกฤษตกหนึ่งตัว", latestText: "คอยเย็น tida", model: "Tiida", mention: "tida", expected: "KEEP" },
  { persona: "อู่", label: "ชื่อร่วมสองรุ่น", latestText: "คอยเย็นไฮเอซ", model: "Hiace Commuter", mention: "ไฮเอซ", expected: "DROP" },
  {
    persona: "อู่",
    label: "ถามต่อจากรุ่นที่พูดจริง",
    latestText: "มีของไหม",
    model: "D-Max",
    mention: null,
    history: [{ role: "customer", text: "คอยเย็นดีแม็ก" }],
    expected: "KEEP",
  },
  { persona: "ช่าง", label: "ทับศัพท์จริง", latestText: "สายแอร์สตาด้า", model: "Strada", mention: "สตาด้า", expected: "KEEP" },
  { persona: "ช่าง", label: "สเปกไม่ใช่รุ่น", latestText: "คอมแอร์ 24v", model: "Mega 500", mention: null, expected: "DROP" },
  { persona: "ช่าง", label: "generation กว้าง", latestText: "คอยเย็น all new", model: "D-Max", mention: "all new", expected: "DROP" },
  { persona: "ช่าง", label: "มาร์คแทนมาร์ช", latestText: "คอยเย็นนิสสันมาร์ค", model: "March", mention: "มาร์ค", expected: "KEEP" },
  { persona: "ช่าง", label: "classifier เติมยี่ห้อหน้ารุ่น", latestText: "คอยเย็นนิสสันมาร์ค", model: "Nissan March", mention: "นิสสันมาร์ค", expected: "KEEP" },
  { persona: "ช่าง", label: "คัมรี่แทนแคมรี่", latestText: "คอมแอร์คัมรี่", model: "Camry", mention: "คัมรี่", expected: "KEEP" },
  { persona: "เจ้าของรถ", label: "ถามกว้างไม่มีรถ", latestText: "มีอะไหล่รถไหมคะ", model: "Altis", mention: null, expected: "DROP" },
  { persona: "เจ้าของรถ", label: "เรียกรุ่นไทย", latestText: "ของวีออสมีไหมคะ", model: "Vios", mention: "วีออส", expected: "KEEP" },
  {
    persona: "เจ้าของรถ",
    label: "ถามราคาต่อใน session",
    latestText: "ราคาเท่าไหร่คะ",
    model: "Vios",
    mention: null,
    history: [{ role: "customer", text: "รถวีออสค่ะ" }],
    expected: "KEEP",
  },
  { persona: "เจ้าของรถ", label: "คำอังกฤษกว้างไม่ใช่รุ่น", latestText: "รุ่น spark ใช่ไหม", model: "D-Max", mention: "spark", expected: "DROP" },
];

const intentFor = (row: GoldenCase): ChatSearchIntent => ({
  group: "product",
  query: row.latestText,
  isProductQuery: true,
  partType: "คอยล์เย็น",
  carBrand: null,
  carModel: row.model,
  carMentionInLatest: row.mention ?? null,
  year: null,
  partKind: "fitment",
  tooBroad: false,
});

async function run(): Promise<void> {
  console.log("Model grounding shadow golden — baseline vs candidate\n" + "=".repeat(68));
  const rows = await db.searchSynonym.findMany({
    where: { isActive: true },
    select: { term: true, synonyms: true },
  });
  const groundingLookup = buildCarModelGroundingLookup(rows);

  let baselineCorrect = 0;
  let candidateCorrect = 0;
  const failures: string[] = [];
  const byPersona = new Map<Persona, { total: number; baseline: number; candidate: number }>();

  for (const row of cases) {
    const history = row.history ?? [];
    const baseline = guardChatSearchIntent({
      intent: intentFor(row),
      latestText: row.latestText,
      history,
    });
    const candidate = evaluateChatModelGroundingCandidate({
      model: row.model,
      carMentionInLatest: row.mention,
      latestText: row.latestText,
      history,
      groundingLookup,
    });
    const baselineDecision = baseline.intent?.carModel ? "KEEP" : "DROP";
    const candidateDecision = candidate?.candidateModel ? "KEEP" : "DROP";
    const baselineOk = baselineDecision === row.expected;
    const candidateOk = candidateDecision === row.expected;
    if (baselineOk) baselineCorrect += 1;
    if (candidateOk) candidateCorrect += 1;
    if (!candidateOk) failures.push(`${row.persona}/${row.label}: ${candidateDecision} ≠ ${row.expected}`);
    const score = byPersona.get(row.persona) ?? { total: 0, baseline: 0, candidate: 0 };
    score.total += 1;
    if (baselineOk) score.baseline += 1;
    if (candidateOk) score.candidate += 1;
    byPersona.set(row.persona, score);
    console.log(
      `  ${candidateOk ? "✔" : "✖"} [${row.persona}] ${row.label}: baseline=${baselineDecision} candidate=${candidateDecision} expected=${row.expected} (${candidate?.evidenceSource ?? "-"})`,
    );
  }

  console.log("\nคะแนนตาม persona");
  for (const [persona, score] of byPersona) {
    console.log(`  ${persona}: baseline ${score.baseline}/${score.total} → candidate ${score.candidate}/${score.total}`);
    if (score.candidate < score.baseline) failures.push(`${persona}: candidate แย่กว่า baseline`);
  }

  // Catalog-wide invariant: a direct canonical model name must always survive.
  const models = await db.carModel.findMany({
    where: { isActive: true, carBrand: { isActive: true } },
    select: { name: true },
  });
  const directFailures = models.filter((model) => {
    const result = evaluateChatModelGroundingCandidate({
      model: model.name,
      carMentionInLatest: model.name,
      latestText: `คอยเย็น ${model.name}`,
      history: [],
      groundingLookup,
    });
    return result?.candidateModel !== model.name;
  });
  console.log(`\ncanonical model direct-mention: ${models.length - directFailures.length}/${models.length}`);
  if (directFailures.length > 0) {
    failures.push(`canonical model ตก ${directFailures.map((row) => row.name).slice(0, 8).join(", ")}`);
  }

  console.log(`\nรวม persona: baseline ${baselineCorrect}/${cases.length} → candidate ${candidateCorrect}/${cases.length}`);
  console.log("production delivery delta: 0 (shadow-only)");
  if (candidateCorrect < baselineCorrect) failures.push("candidate รวมแย่กว่า baseline");
  if (candidateCorrect === baselineCorrect) console.log("ผลเท่าเดิม — ผ่าน worst-case gate");
  else console.log(`ผลดีขึ้น +${candidateCorrect - baselineCorrect} เคส — ผ่าน improvement gate`);

  if (failures.length > 0) {
    console.log("\nล้มเหลว:");
    for (const failure of failures) console.log(`  - ${failure}`);
    process.exitCode = 1;
  }
}

run()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
