import { generateGeminiContent } from "@/lib/google-ai-client";
import { buildProfitExplanationPrompt } from "@/lib/profit-explanation/prompt";
import {
  PROFIT_EXPLANATION_MAX_ITEMS,
  type ProfitExplanationEvidence,
  type ProfitExplanationResult,
} from "@/lib/profit-explanation/schema";

const TH_MUTATION_ACTION_RE = /(ปรับราคา|แก้ไข|อนุมัติ|ลบ|โพสต์|กระทบยอด|สร้างบิล|ปรับสต็อก)/;
const TH_COMPLETED_MARKER_RE = /(ให้แล้ว|แล้ว|เรียบร้อย|สำเร็จ)/;
const EN_MUTATION_CLAIM_RE = /\b(i|we|system|ai)\b.{0,40}\b(changed|updated|deleted|approved|posted|reconciled|created)\b/i;

function fallbackResult(reason: string): ProfitExplanationResult {
  return {
    summary: "ไม่สามารถสรุปคำอธิบายกำไรจาก AI ได้อย่างปลอดภัยในรอบนี้",
    confidence: "low",
    facts: [],
    drivers: [],
    anomalies: [],
    recommendedChecks: [],
    limitations: [reason],
  };
}

function stripJsonFence(text: string): string {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
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
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return input.slice(start, index + 1);
      }
    }
  }

  return null;
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, 800) : fallback;
}

function asConfidence(value: unknown): ProfitExplanationResult["confidence"] {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function asImpact(value: unknown): "positive" | "negative" | "neutral" {
  return value === "positive" || value === "negative" || value === "neutral" ? value : "neutral";
}

function asSeverity(value: unknown): "high" | "medium" | "low" {
  return value === "high" || value === "medium" || value === "low" ? value : "low";
}

function hasMutationClaim(value: unknown): boolean {
  const text = JSON.stringify(value);
  if (EN_MUTATION_CLAIM_RE.test(text)) {
    return true;
  }

  const actionMatch = TH_MUTATION_ACTION_RE.exec(text);
  if (!actionMatch) {
    return false;
  }

  const start = Math.max(0, actionMatch.index - 30);
  const end = Math.min(text.length, actionMatch.index + actionMatch[0].length + 30);
  const surrounding = text.slice(start, end);

  return /(ระบบ|AI|เอไอ|ฉัน|เรา)/i.test(surrounding) && TH_COMPLETED_MARKER_RE.test(surrounding);
}

export function parseProfitExplanationResult(
  text: string,
  evidence: ProfitExplanationEvidence,
): ProfitExplanationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractFirstJsonObject(text) ?? stripJsonFence(text));
  } catch {
    return fallbackResult("AI ส่ง JSON ไม่ถูกต้อง");
  }

  if (typeof parsed !== "object" || parsed === null) {
    return fallbackResult("AI ส่งผลลัพธ์ไม่ใช่ object");
  }

  const raw = parsed as Record<string, unknown>;
  if (hasMutationClaim(raw)) {
    return fallbackResult("AI response มีข้อความที่สื่อว่าแก้ไขข้อมูล จึงถูกปฏิเสธ");
  }

  const allowedRefs = new Set(evidence.evidenceLinks.map((link) => link.id));
  const cleanRefs = (refs: unknown): string[] =>
    Array.isArray(refs) ? refs.filter((ref): ref is string => typeof ref === "string" && allowedRefs.has(ref)) : [];

  return {
    summary: asText(raw.summary, fallbackResult("").summary).slice(0, 500),
    confidence: asConfidence(raw.confidence),
    facts: Array.isArray(raw.facts)
      ? raw.facts.slice(0, PROFIT_EXPLANATION_MAX_ITEMS).map((fact) => {
          const item = typeof fact === "object" && fact !== null ? (fact as Record<string, unknown>) : {};
          return {
            label: asText(item.label),
            value: asText(item.value),
            source: "system" as const,
          };
        })
      : [],
    drivers: Array.isArray(raw.drivers)
      ? raw.drivers.slice(0, PROFIT_EXPLANATION_MAX_ITEMS).map((driver) => {
          const item = typeof driver === "object" && driver !== null ? (driver as Record<string, unknown>) : {};
          return {
            title: asText(item.title),
            explanation: asText(item.explanation),
            impact: asImpact(item.impact),
            amount: typeof item.amount === "number" ? item.amount : undefined,
            evidenceRefs: cleanRefs(item.evidenceRefs),
          };
        })
      : [],
    anomalies: Array.isArray(raw.anomalies)
      ? raw.anomalies.slice(0, PROFIT_EXPLANATION_MAX_ITEMS).map((anomaly) => {
          const item = typeof anomaly === "object" && anomaly !== null ? (anomaly as Record<string, unknown>) : {};
          return {
            title: asText(item.title),
            explanation: asText(item.explanation),
            severity: asSeverity(item.severity),
            evidenceRefs: cleanRefs(item.evidenceRefs),
          };
        })
      : [],
    recommendedChecks: Array.isArray(raw.recommendedChecks)
      ? raw.recommendedChecks.slice(0, PROFIT_EXPLANATION_MAX_ITEMS).map((check) => {
          const item = typeof check === "object" && check !== null ? (check as Record<string, unknown>) : {};
          return {
            label: asText(item.label),
            reason: asText(item.reason),
            href: typeof item.href === "string" ? item.href : undefined,
          };
        })
      : [],
    limitations: Array.isArray(raw.limitations)
      ? raw.limitations.slice(0, PROFIT_EXPLANATION_MAX_ITEMS).map((item) => asText(item)).filter(Boolean)
      : [],
  };
}

export async function generateProfitExplanation(evidence: ProfitExplanationEvidence): Promise<{
  result: ProfitExplanationResult;
  keyRef: string | null;
}> {
  const { systemInstruction, prompt } = buildProfitExplanationPrompt(evidence);
  try {
    const response = await generateGeminiContent({
      systemInstruction,
      prompt,
      json: true,
      temperature: 0.2,
      maxOutputTokens: 1600,
      thinkingLevel: "LOW",
      timeoutMs: 15_000,
    });

    return {
      result: parseProfitExplanationResult(response.text, evidence),
      keyRef: response.keyRef,
    };
  } catch (error) {
    return {
      result: fallbackResult(error instanceof Error ? error.message : "AI unavailable"),
      keyRef: null,
    };
  }
}
