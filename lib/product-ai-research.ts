import { z } from "zod";

export const PRODUCT_AI_ALIAS_KINDS = [
  "ALIAS",
  "OEM",
  "PART_NO",
  "CROSS_REF",
  "KEYWORD",
  "MISSPELL",
  "EN",
  "TH",
] as const;

export type ProductAiAliasKind = (typeof PRODUCT_AI_ALIAS_KINDS)[number];
export type ProductAiConfidence = "VERIFIED" | "POSSIBLE_MATCH" | "NEED_REVIEW";

export interface ProductAiResearchInput {
  productName: string;
  partsBrandName?: string;
  fitmentText?: string;
  categoryName?: string;
}

export interface ProductAiResearchDraft {
  productName: { value: string; confidence: ProductAiConfidence; reason?: string };
  category: { value: string; confidence: ProductAiConfidence };
  partsBrand: { value: string; confidence: ProductAiConfidence; note?: string };
  descriptionCopyBox: string;
  aliases: Record<ProductAiAliasKind, { label: string; required: boolean; csv: string; note?: string }>;
  verifiedFitments: ProductAiFitmentDraft[];
  possibleInterchange: ProductAiFitmentDraft[];
  needReview: Array<{ topic: string; statusText: string; reason: string; requiredInfo: string[] }>;
  sources: ProductAiResearchSource[];
  blockedOrRejectedSources: Array<{ url: string; reason: string }>;
  questionsForAdmin: string[];
  warnings: string[];
}

export interface ProductAiFitmentDraft {
  make: string;
  model: string;
  yearStart: number | null;
  yearEnd: number | null;
  engineSize: string;
  engineCode: string;
  submodel: string;
  note: string;
  statusText?: string;
  evidence?: string;
}

export interface ProductAiResearchSource {
  title: string;
  url: string;
  sourceType: "LAZADA_TH" | "SHOPEE_TH" | "THAI_TRUSTED_PARTS_SELLER";
  usedFor: string[];
}

const aliasLabels: Record<ProductAiAliasKind, string> = {
  ALIAS: "คำเรียกอื่น",
  OEM: "OEM",
  PART_NO: "Part No.",
  CROSS_REF: "เบอร์เทียบ",
  KEYWORD: "Keyword",
  MISSPELL: "สะกดผิด",
  EN: "EN",
  TH: "TH",
};

const requiredAliases = new Set<ProductAiAliasKind>(["ALIAS", "KEYWORD", "MISSPELL", "EN", "TH"]);

const sourceSchema = z.object({
  title: z.string().catch(""),
  url: z.string().catch(""),
  sourceType: z.enum(["LAZADA_TH", "SHOPEE_TH", "THAI_TRUSTED_PARTS_SELLER"]).catch("THAI_TRUSTED_PARTS_SELLER"),
  usedFor: z.array(z.string()).catch([]),
});

const fitmentSchema = z.object({
  make: z.string().catch(""),
  model: z.string().catch(""),
  yearStart: z.number().int().nullable().catch(null),
  yearEnd: z.number().int().nullable().catch(null),
  engineSize: z.string().catch(""),
  engineCode: z.string().catch(""),
  submodel: z.string().catch(""),
  note: z.string().catch(""),
  statusText: z.string().optional().catch(undefined),
  evidence: z.string().optional().catch(undefined),
});

const aliasValueSchema = z.object({
  label: z.string().optional(),
  required: z.boolean().optional(),
  csv: z.string().catch(""),
  note: z.string().optional().catch(undefined),
});

const draftSchema = z.object({
  productName: z.object({
    value: z.string().catch(""),
    confidence: z.enum(["VERIFIED", "POSSIBLE_MATCH", "NEED_REVIEW"]).catch("NEED_REVIEW"),
    reason: z.string().optional().catch(undefined),
  }).catch({ value: "", confidence: "NEED_REVIEW" as const }),
  category: z.object({
    value: z.string().catch(""),
    confidence: z.enum(["VERIFIED", "POSSIBLE_MATCH", "NEED_REVIEW"]).catch("NEED_REVIEW"),
  }).catch({ value: "", confidence: "NEED_REVIEW" as const }),
  partsBrand: z.object({
    value: z.string().catch(""),
    confidence: z.enum(["VERIFIED", "POSSIBLE_MATCH", "NEED_REVIEW"]).catch("NEED_REVIEW"),
    note: z.string().optional().catch(undefined),
  }).catch({ value: "", confidence: "NEED_REVIEW" as const }),
  descriptionCopyBox: z.string().catch(""),
  aliases: z.record(z.string(), aliasValueSchema).catch({}),
  verifiedFitments: z.array(fitmentSchema).catch([]),
  possibleInterchange: z.array(fitmentSchema).catch([]),
  needReview: z.array(z.object({
    topic: z.string().catch(""),
    statusText: z.string().catch("ยังยืนยันไม่ได้ ต้องตรวจสอบเพิ่มเติม"),
    reason: z.string().catch(""),
    requiredInfo: z.array(z.string()).catch([]),
  })).catch([]),
  sources: z.array(sourceSchema).catch([]),
  blockedOrRejectedSources: z.array(z.object({
    url: z.string().catch(""),
    reason: z.string().catch(""),
  })).catch([]),
  questionsForAdmin: z.array(z.string()).catch([]),
  warnings: z.array(z.string()).catch([]),
});

function stripJsonFence(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function extractFirstJsonObject(text: string): string | null {
  const input = stripJsonFence(text);
  const start = input.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return input.slice(start, index + 1);
    }
  }
  return null;
}

function splitCsv(csv: string): string[] {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of csv.split(/[,\n\t]+/)) {
    const value = raw.trim().replace(/\s+/g, " ");
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

function normalizeCsv(csv: string): string {
  return splitCsv(csv).join(",");
}

function isForbiddenSource(url: string): string | null {
  const lower = url.toLowerCase();
  if (!lower) return "empty-url";
  if (lower.includes("sriwanparts.com")) return "sriwanparts forbidden";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.endsWith("shopee.co.th") || host.endsWith("lazada.co.th")) return null;
    if (host.endsWith(".th")) return null;
    return "foreign site";
  } catch {
    return "invalid-url";
  }
}

// Car model years are 4-digit C.E. (≈1980–2035). A value in the Buddhist-era band
// (2500–2600) is unambiguously B.E. — convert it so fitment years stay Gregorian
// per the project date policy. Returns the value and whether a conversion happened.
function normalizeFitmentYear(year: number | null): { value: number | null; converted: boolean } {
  if (year === null) return { value: null, converted: false };
  if (year >= 2500 && year <= 2600) return { value: year - 543, converted: true };
  return { value: year, converted: false };
}

function fallbackAlias(kind: ProductAiAliasKind): string {
  switch (kind) {
    case "ALIAS": return "ต้องระบุคำเรียกอื่น";
    case "KEYWORD": return "ต้องระบุ keyword";
    case "MISSPELL": return "ต้องระบุคำสะกดผิด";
    case "EN": return "needs-review";
    case "TH": return "ต้องตรวจสอบเพิ่มเติม";
    default: return "";
  }
}

export function normalizeProductAiResearchDraft(raw: unknown): ProductAiResearchDraft {
  const parsed = draftSchema.parse(raw);
  const warnings = [...parsed.warnings];
  const aliases = PRODUCT_AI_ALIAS_KINDS.reduce((acc, kind) => {
    const fromAi = parsed.aliases[kind];
    let csv = normalizeCsv(fromAi?.csv ?? "");
    if (requiredAliases.has(kind) && !csv) {
      csv = fallbackAlias(kind);
      warnings.push(`หัวข้อบังคับ ${aliasLabels[kind]} ไม่มีข้อมูลจาก AI จึงใส่ค่า placeholder เพื่อให้ admin ตรวจ`);
    }
    acc[kind] = {
      label: aliasLabels[kind],
      required: requiredAliases.has(kind),
      csv,
      note: fromAi?.note,
    };
    return acc;
  }, {} as ProductAiResearchDraft["aliases"]);

  const blockedOrRejectedSources = [...parsed.blockedOrRejectedSources];
  const allowedSources: ProductAiResearchSource[] = [];
  for (const source of parsed.sources) {
    const normalizedSource: ProductAiResearchSource = {
      title: source.title ?? "",
      url: source.url ?? "",
      sourceType: source.sourceType ?? "THAI_TRUSTED_PARTS_SELLER",
      usedFor: source.usedFor ?? [],
    };
    const reason = isForbiddenSource(normalizedSource.url);
    if (reason) {
      blockedOrRejectedSources.push({ url: normalizedSource.url, reason });
      warnings.push(`ตัด source ต้องห้าม/ไม่อนุญาต: ${normalizedSource.url} (${reason})`);
      continue;
    }
    allowedSources.push(normalizedSource);
  }

  let convertedBuddhistYear = false;
  const normalizeFitment = (fitment: z.infer<typeof fitmentSchema>): ProductAiFitmentDraft => {
    const start = normalizeFitmentYear(fitment.yearStart ?? null);
    const end = normalizeFitmentYear(fitment.yearEnd ?? null);
    if (start.converted || end.converted) convertedBuddhistYear = true;
    return {
      make: fitment.make ?? "",
      model: fitment.model ?? "",
      yearStart: start.value,
      yearEnd: end.value,
      engineSize: fitment.engineSize ?? "",
      engineCode: fitment.engineCode ?? "",
      submodel: fitment.submodel ?? "",
      note: fitment.note ?? "",
      statusText: fitment.statusText,
      evidence: fitment.evidence,
    };
  };

  const verifiedFitments = parsed.verifiedFitments.map(normalizeFitment);
  const possibleInterchange = parsed.possibleInterchange.map(normalizeFitment);
  if (convertedBuddhistYear) {
    warnings.push("พบปีรถเป็น พ.ศ. จาก AI ระบบแปลงเป็น ค.ศ. ให้แล้ว กรุณาตรวจสอบความถูกต้องก่อนใช้");
  }

  return {
    productName: {
      value: parsed.productName.value.trim(),
      confidence: parsed.productName.confidence,
      reason: parsed.productName.reason,
    },
    category: {
      value: parsed.category.value.trim(),
      confidence: parsed.category.confidence,
    },
    partsBrand: {
      value: parsed.partsBrand.value.trim(),
      confidence: parsed.partsBrand.confidence,
      note: parsed.partsBrand.note,
    },
    descriptionCopyBox: parsed.descriptionCopyBox.trim(),
    aliases,
    verifiedFitments,
    possibleInterchange,
    needReview: parsed.needReview.map((item) => ({
      topic: item.topic ?? "",
      statusText: item.statusText ?? "ยังยืนยันไม่ได้ ต้องตรวจสอบเพิ่มเติม",
      reason: item.reason ?? "",
      requiredInfo: item.requiredInfo ?? [],
    })),
    sources: allowedSources,
    blockedOrRejectedSources: blockedOrRejectedSources.map((item) => ({
      url: item.url ?? "",
      reason: item.reason ?? "",
    })),
    questionsForAdmin: parsed.questionsForAdmin,
    warnings,
  };
}

export function parseProductAiResearchDraft(text: string): ProductAiResearchDraft {
  const json = extractFirstJsonObject(text) ?? stripJsonFence(text);
  return normalizeProductAiResearchDraft(JSON.parse(json));
}

export function buildProductResearchPrompt(input: ProductAiResearchInput): string {
  const productName = input.productName.trim() || "ไม่ระบุ";
  const partsBrandName = input.partsBrandName?.trim() || "ไม่ระบุ";
  const fitmentText = input.fitmentText?.trim() || "ไม่ระบุ";
  const categoryName = input.categoryName?.trim() || "ไม่ระบุ";

  return `คุณคือ Product Research Agent และทำหน้าที่เหมือน admin ที่กำลังเตรียมข้อมูลสินค้าเพื่อบันทึกลงระบบร้านอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์

ข้อมูลตั้งต้นจากหน้าเว็บ:
ชื่อสินค้า: ${productName}
ยี่ห้อสินค้า: ${partsBrandName}
หมวดหมู่ที่เลือกไว้: ${categoryName}
รุ่นรถที่ใช้ได้: ${fitmentText}

งานของคุณ:
- ค้นหาและตรวจสอบข้อมูลจากแหล่งที่อนุญาตเท่านั้น
- สร้าง draft สำหรับกรอกฟอร์มสินค้า โดยไม่แก้ข้อมูลจริง
- ถ้าความมั่นใจไม่ถึง 90% ให้ใส่ NEED_REVIEW หรือถามข้อมูลเพิ่ม

แหล่งข้อมูลที่อนุญาต:
- Lazada ประเทศไทยเท่านั้น
- Shopee ประเทศไทยเท่านั้น
- เว็บไซต์ขายอะไหล่แอร์รถยนต์/หม้อน้ำรถยนต์ที่เชื่อถือได้ในประเทศไทยเท่านั้น

แหล่งข้อมูลที่ห้ามใช้เด็ดขาด:
- ห้ามใช้เว็บไซต์ต่างประเทศทุกกรณี
- ห้ามใช้ https://www.sriwanparts.com และทุก path ภายใต้โดเมนนี้เป็นแหล่งข้อมูลอ้างอิงเด็ดขาด
- ห้ามคัดลอกข้อมูลจาก sriwanparts แม้ข้อมูลจะปรากฏใน search result หรือ cache

ห้ามแตะข้อมูลเหล่านี้:
- รูปสินค้า
- ราคาทุน/ราคาขาย
- สต็อก/Stock ขั้นต่ำ
- ระยะเวลาประกัน
- สถานะหน้าบ้าน
- หน่วยสินค้า/หน่วยขาย/หน่วยซื้อ/หน่วยรายงาน
- Lot Control

กฎรหัสค้นหา / OEM / Part No. / คำพ้อง:
ต้องคืนครบ 8 หัวข้อเสมอ: ALIAS(บังคับ), OEM, PART_NO, CROSS_REF, KEYWORD(บังคับ), MISSPELL(บังคับ), EN(บังคับ), TH(บังคับ)
แต่ละหัวข้อให้เป็น csv คั่นด้วยลูกน้ำเท่านั้น ห้ามปนหมวด ห้ามซ้ำกันโดยไม่จำเป็น

กฎ Compatibility SAFE MODE:
- VERIFIED = ใช้ร่วมกันได้ ใส่ verifiedFitments ได้เฉพาะมีหลักฐานชัดเจน
- POSSIBLE_MATCH = อาจใช้ร่วมกันได้บางรุ่น ต้องเทียบอะไหล่เดิมก่อน ใส่ possibleInterchange เท่านั้น
- NEED_REVIEW = ยังยืนยันไม่ได้ ต้องตรวจสอบเพิ่มเติม ห้ามใส่เป็นรถที่ใช้ได้
- ยอมขาดรุ่นรถ ดีกว่าเพิ่มผิดแล้วลูกค้าเคลม
- yearStart และ yearEnd ต้องเป็นปี ค.ศ. (4 หลัก เช่น 2015, 2022) เท่านั้น ห้ามใช้ปี พ.ศ. เด็ดขาด ถ้าแหล่งข้อมูลเป็น พ.ศ. ให้แปลงเป็น ค.ศ. ก่อน (พ.ศ. ลบ 543)

กฎเฉพาะคอมแอร์: ต้องตรวจจำนวนร่องพูลเลย์, รุ่นคอม, ปลั๊กไฟ, จุดยึด, แรงดัน, ขนาดหน้าคลัตช์, OEM ถ้ามี หากไม่ครบห้ามสรุปว่าใช้ได้

ตอบเป็น JSON ล้วนเท่านั้น ห้าม markdown ตาม schema นี้:
{
  "productName": { "value": "", "confidence": "VERIFIED|POSSIBLE_MATCH|NEED_REVIEW", "reason": "" },
  "category": { "value": "", "confidence": "VERIFIED|POSSIBLE_MATCH|NEED_REVIEW" },
  "partsBrand": { "value": "", "confidence": "VERIFIED|POSSIBLE_MATCH|NEED_REVIEW", "note": "" },
  "descriptionCopyBox": "ข้อความคำอธิบายภาษาไทยสำหรับ copy ลงเว็บ มีหัวข้อ 🚗 ✅ 📌 ⚠️ 🔍 อ่านง่าย ไม่โฆษณาเกินจริง",
  "aliases": {
    "ALIAS": { "csv": "" },
    "OEM": { "csv": "", "note": "" },
    "PART_NO": { "csv": "", "note": "" },
    "CROSS_REF": { "csv": "", "note": "" },
    "KEYWORD": { "csv": "" },
    "MISSPELL": { "csv": "" },
    "EN": { "csv": "" },
    "TH": { "csv": "" }
  },
  "verifiedFitments": [
    { "make": "", "model": "", "yearStart": null, "yearEnd": null, "engineSize": "", "engineCode": "", "submodel": "", "note": "", "statusText": "ใช้ร่วมกันได้", "evidence": "" }
  ],
  "possibleInterchange": [
    { "make": "", "model": "", "yearStart": null, "yearEnd": null, "engineSize": "", "engineCode": "", "submodel": "", "note": "อาจใช้ร่วมกันได้บางรุ่น ต้องเทียบอะไหล่เดิมก่อน", "statusText": "อาจใช้ร่วมกันได้บางรุ่น ต้องเทียบอะไหล่เดิมก่อน", "evidence": "" }
  ],
  "needReview": [
    { "topic": "", "statusText": "ยังยืนยันไม่ได้ ต้องตรวจสอบเพิ่มเติม", "reason": "", "requiredInfo": [] }
  ],
  "sources": [
    { "title": "", "url": "", "sourceType": "LAZADA_TH|SHOPEE_TH|THAI_TRUSTED_PARTS_SELLER", "usedFor": [] }
  ],
  "blockedOrRejectedSources": [],
  "questionsForAdmin": [],
  "warnings": []
}`;
}

export type ProductAiResearchRun =
  | { success: true; draft: ProductAiResearchDraft; rawText: string }
  | { success: false; error: string };

export async function runProductAiResearch(input: ProductAiResearchInput): Promise<ProductAiResearchRun> {
  const [{ generateGeminiContent }, { hasGeminiKeysConfigured }] = await Promise.all([
    import("@/lib/google-ai-client"),
    import("@/lib/google-ai-keys"),
  ]);

  if (!hasGeminiKeysConfigured()) {
    return { success: false, error: "ยังไม่ได้ตั้งค่า Gemini API key" };
  }
  try {
    const { text } = await generateGeminiContent({
      prompt: buildProductResearchPrompt(input),
      // Keep Google Search grounding enabled for research. The prompt still
      // requires JSON, and the parser accepts a fenced/embedded JSON object.
      json: false,
      googleSearch: true,
      maxOutputTokens: 9000,
      temperature: 0.1,
      thinkingLevel: "NONE",
      timeoutMs: 45_000,
      // Research is a deliberate one-off action (not latency-critical chat), so let
      // it rotate through up to 10 keys when one is rate-limited/erroring before
      // giving up. generateGeminiContent already cools down the failing key and
      // moves to the next. The dominant rotation trigger is a rate limit (HTTP 429,
      // which returns instantly), so all 10 keys fit comfortably within the page
      // maxDuration (300s, the Vercel Pro ceiling); genuine timeouts stacking across
      // all 10 keys is effectively impossible and would be cut at 300s anyway.
      maxKeyAttempts: 10,
    });
    return { success: true, draft: parseProductAiResearchDraft(text), rawText: text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Map the multi-key exhaustion errors to a friendly Thai message so admins know
    // it is a transient quota state, not a broken feature.
    if (message.includes("NO_GEMINI_KEYS_CONFIGURED")) {
      return { success: false, error: "ยังไม่ได้ตั้งค่า Gemini API key" };
    }
    if (message.includes("COOLING_DOWN") || message.includes("ALL_GEMINI_KEYS_FAILED")) {
      return { success: false, error: "API key ทั้งหมดติด limit หรือใช้งานไม่ได้ชั่วคราว กรุณาลองใหม่อีกครั้งภายหลัง" };
    }
    return { success: false, error: `AI Research ล้มเหลว: ${message.slice(0, 200)}` };
  }
}
