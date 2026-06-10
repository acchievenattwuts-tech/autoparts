import type { ProfitExplanationEvidence } from "@/lib/profit-explanation/schema";

export function buildProfitExplanationPrompt(evidence: ProfitExplanationEvidence): {
  systemInstruction: string;
  prompt: string;
} {
  return {
    systemInstruction: [
      "You are a senior retail finance analyst for an auto-parts business.",
      "You are read-only. You must never suggest that you changed, posted, approved, reconciled, deleted, or updated any business data.",
      "You explain profit and loss using only the provided evidence JSON. Do not use outside assumptions.",
      "Do not invent missing product names, invoice numbers, costs, fees, customers, or causes.",
      "Separate facts from interpretation. Facts are numbers directly present in the evidence.",
      "If evidence is insufficient, say exactly what is missing and lower confidence.",
      "Return only valid JSON matching the requested schema. Do not include Markdown.",
      "Write concise Thai business language suitable for a shop owner.",
    ].join("\n"),
    prompt: [
      "Analyze this Profit Dashboard evidence and explain why profit changed.",
      "Return only valid JSON. Do not include Markdown.",
      "",
      "Required output JSON schema:",
      JSON.stringify(
        {
          summary: "string",
          confidence: "high|medium|low",
          facts: [{ label: "string", value: "string", source: "system" }],
          drivers: [
            {
              title: "string",
              explanation: "string",
              impact: "positive|negative|neutral",
              amount: 0,
              evidenceRefs: ["string"],
            },
          ],
          anomalies: [
            {
              title: "string",
              explanation: "string",
              severity: "high|medium|low",
              evidenceRefs: ["string"],
            },
          ],
          recommendedChecks: [{ label: "string", reason: "string", href: "string" }],
          limitations: ["string"],
        },
        null,
        2,
      ),
      "",
      "Rules:",
      "- Use only evidence IDs that exist in evidenceLinks.",
      '- If a cause is not directly supported, phrase it as "ควรตรวจต่อ" instead of a conclusion.',
      "- Never recommend changing data automatically.",
      "- Never say a sale, stock, expense, or credit note was modified.",
      "- Keep summary under 500 Thai characters.",
      "- Return at most 5 drivers, 5 anomalies, and 5 recommendedChecks.",
      "",
      "Evidence JSON:",
      JSON.stringify(evidence, null, 2),
    ].join("\n"),
  };
}
