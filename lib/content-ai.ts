import { getSiteConfig } from "@/lib/site-config";

export type ContentDraftIdea = {
  title: string;
  caption: string;
};

export type GenerateContentDraftsInput = {
  topic: string;
  audience?: string;
  callToAction?: string;
  notes?: string;
};

function buildPrompt(input: GenerateContentDraftsInput, shopName: string) {
  const audience = input.audience?.trim() || "เจ้าของรถและอู่ซ่อมรถ";
  const cta = input.callToAction?.trim() || "ทักแชทสอบถามรุ่นรถและอะไหล่ได้เลย";
  const notes = input.notes?.trim() || "ไม่มี";

  return [
    "คุณเป็นผู้ช่วยทำคอนเทนต์ Facebook สำหรับร้านอะไหล่รถยนต์ในไทย",
    `ชื่อร้าน: ${shopName}`,
    `หัวข้อหลัก: ${input.topic}`,
    `กลุ่มเป้าหมาย: ${audience}`,
    `คำกระตุ้นการตัดสินใจ: ${cta}`,
    `หมายเหตุเพิ่มเติม: ${notes}`,
    "ช่วยสร้างตัวเลือกโพสต์ Facebook 3 แบบที่น้ำเสียงต่างกันชัดเจน",
    "ข้อกำหนด:",
    "- เขียนภาษาไทย",
    "- แต่ละแบบต้องเหมาะกับการโพสต์บน Facebook Page ของร้าน",
    "- ไม่โอเวอร์เคลมสินค้า",
    "- แต่ละแบบต้องมี title สั้น 1 บรรทัด และ caption 1 ชุด",
    "- caption ควรอ่านง่าย มีบรรทัดเว้น และมี CTA ท้ายโพสต์",
    "ตอบเป็น JSON ล้วน ห้ามมี markdown ห้ามมีคำอธิบายเพิ่ม",
    'รูปแบบ JSON: {"drafts":[{"title":"...","caption":"..."},{"title":"...","caption":"..."},{"title":"...","caption":"..."}]}',
  ].join("\n");
}

function sanitizeDrafts(rawDrafts: ContentDraftIdea[]) {
  return rawDrafts
    .map((draft, index) => ({
      title: draft.title?.trim() || `ตัวเลือกโพสต์ ${index + 1}`,
      caption: draft.caption?.trim() || "",
    }))
    .filter((draft) => draft.caption.length > 0)
    .slice(0, 3);
}

function buildFallbackDrafts(input: GenerateContentDraftsInput, shopName: string): ContentDraftIdea[] {
  const cta = input.callToAction?.trim() || "ทักแชทพร้อมแจ้งรุ่นรถเพื่อเช็กอะไหล่ได้เลย";
  const topic = input.topic.trim();
  const noteLine = input.notes?.trim() ? `\n\nเพิ่มเติม: ${input.notes.trim()}` : "";

  return [
    {
      title: `${topic} พร้อมใช้งาน`,
      caption: `${shopName}\n\nกำลังมองหา${topic}อยู่หรือเปล่า?\nร้านเราช่วยเช็กอะไหล่ให้ตรงรุ่นก่อนสั่ง ลดโอกาสสั่งผิดและเสียเวลาเปลี่ยนคืน\n\nเหมาะทั้งลูกค้าทั่วไปและอู่ที่ต้องการของพร้อมใช้งาน${noteLine}\n\n${cta}`,
    },
    {
      title: `เลือก ${topic} ให้ตรงรุ่น`,
      caption: `ก่อนสั่ง${topic} แนะนำให้เตรียมข้อมูลรุ่นรถ ปีรถ และรูปอะไหล่เดิมไว้ให้ครบ\n\n${shopName} ช่วยเช็กให้ได้ว่ารุ่นไหนใช้ร่วมกันได้ รุ่นไหนไม่ควรเสี่ยงใส่แทน\n\nเช็กก่อน สั่งได้ตรงกว่า ใช้งานสบายใจกว่า${noteLine}\n\n${cta}`,
    },
    {
      title: `${topic} สำหรับงานซ่อมวันนี้`,
      caption: `งานซ่อมบางครั้งเสียเวลาเพราะหา${topic}ไม่ตรงรุ่นหรือข้อมูลไม่ครบ\n\nส่งรุ่นรถ อาการ และรูปชิ้นส่วนเดิมมาให้ ${shopName} ช่วยดูได้ เราจะช่วยไล่ข้อมูลให้ก่อนตัดสินใจ\n\nเหมาะกับงานหน้าร้าน งานด่วน และลูกค้าที่อยากได้ข้อมูลชัดก่อนซื้อ${noteLine}\n\n${cta}`,
    },
  ];
}

function tryExtractJson(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  return start >= 0 && end > start ? trimmed.slice(start, end + 1) : null;
}

async function generateWithOpenAI(input: GenerateContentDraftsInput, shopName: string) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-5.4-mini",
      input: buildPrompt(input, shopName),
      max_output_tokens: 1200,
    }),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`OPENAI_REQUEST_FAILED:${response.status}:${body}`);
  }

  const payload = (await response.json()) as {
    output_text?: string;
  };

  const rawText = payload.output_text?.trim();
  if (!rawText) return null;

  const jsonText = tryExtractJson(rawText);
  if (!jsonText) return null;

  const parsed = JSON.parse(jsonText) as { drafts?: ContentDraftIdea[] };
  if (!Array.isArray(parsed.drafts)) return null;

  return sanitizeDrafts(parsed.drafts);
}

export async function generateContentDraftIdeas(
  input: GenerateContentDraftsInput
): Promise<ContentDraftIdea[]> {
  const siteConfig = await getSiteConfig();
  const normalizedInput = {
    topic: input.topic.trim(),
    audience: input.audience?.trim(),
    callToAction: input.callToAction?.trim(),
    notes: input.notes?.trim(),
  };

  if (!normalizedInput.topic) {
    throw new Error("MISSING_TOPIC");
  }

  try {
    const aiDrafts = await generateWithOpenAI(normalizedInput, siteConfig.shopName);
    if (aiDrafts && aiDrafts.length === 3) {
      return aiDrafts;
    }
  } catch (error) {
    console.warn("[content-ai] falling back to template drafts", error);
  }

  return buildFallbackDrafts(normalizedInput, siteConfig.shopName);
}
