import { getSiteConfig } from "@/lib/site-config";

export type ContentDraftIdea = {
  title: string;
  caption: string;
};

export type ContentTopicIdea = {
  topic: string;
  angle: string;
};

export type GenerateContentTopicsInput = {
  businessType?: string;
  audience?: string;
  goal?: string;
  seasonOrFestival?: string;
  notes?: string;
  recentPosts?: string[];
};

export type GenerateContentDraftsInput = GenerateContentTopicsInput & {
  topic: string;
  callToAction?: string;
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

function normalizeLines(lines: Array<string | null | undefined | false>) {
  return lines.filter(Boolean).join("\n");
}

function buildRecentPostsSection(recentPosts: string[] | undefined) {
  if (!recentPosts?.length) {
    return "โพสล่าสุดที่เคยใช้ไปแล้ว: ไม่มีข้อมูล";
  }

  return normalizeLines([
    "โพสล่าสุดที่เคยใช้ไปแล้ว ห้ามเสนอหัวข้อซ้ำหรือใกล้เคียงเกินไป:",
    ...recentPosts.slice(0, 12).map((post, index) => `${index + 1}. ${post}`),
  ]);
}

function buildSharedContext(input: GenerateContentTopicsInput, shopName: string) {
  const businessType = input.businessType?.trim() || "ร้านอะไหล่แอร์รถยนต์";
  const audience = input.audience?.trim() || "เจ้าของรถและอู่ซ่อมรถ";
  const goal = input.goal?.trim() || "ขาย";
  const seasonOrFestival = input.seasonOrFestival?.trim() || "ไม่มี";
  const notes = input.notes?.trim() || "ไม่มี";

  return [
    `ชื่อร้าน: ${shopName}`,
    `ประเภทธุรกิจ/สินค้า: ${businessType}`,
    `กลุ่มลูกค้า: ${audience}`,
    `เป้าหมายโพส: ${goal}`,
    `ช่วงเวลา/เทศกาล: ${seasonOrFestival}`,
    `หมายเหตุเพิ่มเติม: ${notes}`,
    buildRecentPostsSection(input.recentPosts),
  ].join("\n");
}

function buildTopicsPrompt(input: GenerateContentTopicsInput, shopName: string) {
  return [
    "คุณเป็นผู้ช่วยคิดคอนเทนต์ Facebook สำหรับร้านอะไหล่แอร์รถยนต์ในไทย",
    buildSharedContext(input, shopName),
    "ช่วยเสนอหัวข้อโพส 5 หัวข้อที่ไม่ซ้ำกันและนำไปขายของหรือให้ความรู้ได้จริง",
    "ข้อกำหนด:",
    "- เขียนภาษาไทย",
    "- ต้องเหมาะกับโพส Facebook ของร้านขายอะไหล่แอร์รถยนต์",
    "- แต่ละหัวข้อควรต่างมุมกันชัดเจน",
    "- แต่ละหัวข้อให้มี topic และ angle สั้น ๆ",
    "- หลีกเลี่ยงหัวข้อที่ซ้ำกับโพสล่าสุดที่ให้ไว้",
    "ตอบเป็น JSON ล้วน ห้ามมี markdown ห้ามมีคำอธิบายเพิ่ม",
    'รูปแบบ JSON: {"topics":[{"topic":"...","angle":"..."},{"topic":"...","angle":"..."},{"topic":"...","angle":"..."},{"topic":"...","angle":"..."},{"topic":"...","angle":"..."}]}',
  ].join("\n");
}

function buildDraftsPrompt(input: GenerateContentDraftsInput, shopName: string) {
  const cta = input.callToAction?.trim() || "ทักแชทสอบถามรุ่นรถและอะไหล่ได้เลย";

  return [
    "คุณเป็นผู้ช่วยทำคอนเทนต์ Facebook สำหรับร้านอะไหล่แอร์รถยนต์ในไทย",
    buildSharedContext(input, shopName),
    `หัวข้อหลัก: ${input.topic}`,
    `คำกระตุ้นการตัดสินใจ: ${cta}`,
    "ช่วยสร้างตัวเลือกโพส Facebook 3 แบบที่น้ำเสียงต่างกันชัดเจน",
    "ข้อกำหนด:",
    "- เขียนภาษาไทย",
    "- แต่ละแบบต้องเหมาะกับการโพสบนน Facebook Page ของร้าน",
    "- ไม่โอเวอร์เคลมสินค้า",
    "- แต่ละแบบต้องมี title สั้น 1 บรรทัด และ caption 1 ชุด",
    "- caption ควรอ่านง่าย มีบรรทัดเว้น และมี CTA ท้ายโพส",
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

function sanitizeTopics(rawTopics: ContentTopicIdea[]) {
  return rawTopics
    .map((topic, index) => ({
      topic: topic.topic?.trim() || `หัวข้อโพส ${index + 1}`,
      angle: topic.angle?.trim() || "มุมขายและให้ความรู้",
    }))
    .filter((topic) => topic.topic.length > 0)
    .slice(0, 10);
}

function buildFallbackTopics(input: GenerateContentTopicsInput): ContentTopicIdea[] {
  const businessType = input.businessType?.trim() || "อะไหล่แอร์รถยนต์";
  const goal = input.goal?.trim() || "ขาย";
  const seasonOrFestival = input.seasonOrFestival?.trim();

  return [
    {
      topic: `เช็กอาการก่อนซื้อ${businessType}`,
      angle: `คอนเทนต์แนว${goal}ที่เริ่มจาก pain point ของลูกค้า`,
    },
    {
      topic: `${businessType}รุ่นไหนเหมาะกับรถของคุณ`,
      angle: "ช่วยลูกค้าคัดอะไหล่ให้ตรงรุ่นก่อนสั่ง",
    },
    {
      topic: `สัญญาณเตือนว่า${businessType}กำลังมีปัญหา`,
      angle: "โพสให้ความรู้ที่พาไปสู่การทักแชทถามอะไหล่",
    },
    {
      topic: "ของพร้อมส่งสำหรับงานซ่อมแอร์รถช่วงนี้",
      angle: seasonOrFestival ? `ผูกกับช่วง ${seasonOrFestival}` : "เน้นความพร้อมส่งและงานด่วน",
    },
    {
      topic: `ถามให้ครบก่อนสั่ง${businessType}`,
      angle: "ช่วยลดการสั่งผิดและสร้างความน่าเชื่อถือ",
    },
  ];
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

function buildEnhancedFallbackDrafts(input: GenerateContentDraftsInput, shopName: string): ContentDraftIdea[] {
  const cta = input.callToAction?.trim() || "ทักแชทพร้อมแจ้งรุ่นรถเพื่อเช็กอะไหล่ได้เลย";
  const topic = input.topic.trim();
  const audience = input.audience?.trim() || "ลูกค้าทั่วไปและอู่ซ่อมรถ";
  const goal = input.goal?.trim() || "ขาย";
  const businessType = input.businessType?.trim() || "อะไหล่แอร์รถยนต์";
  const noteLine = input.notes?.trim() ? `\n\nเพิ่มเติม: ${input.notes.trim()}` : "";

  return [
    {
      title: `${topic} พร้อมใช้งาน`,
      caption: `${shopName}\n\nกำลังมองหา${topic}อยู่หรือเปล่า?\nเราช่วยเช็ก ${businessType} ให้ตรงรุ่นก่อนสั่ง ลดโอกาสสั่งผิดและเสียเวลาหน้างาน\n\nเหมาะกับ${audience}ที่ต้องการข้อมูลชัดก่อนตัดสินใจ${noteLine}\n\nเป้าหมายโพสนี้คือ ${goal}\n\n${cta}`,
    },
    {
      title: `เลือก ${topic} ให้ตรงรุ่น`,
      caption: `ก่อนสั่ง${topic} แนะนำให้เตรียมรุ่นรถ ปีรถ และรูปอะไหล่เดิมไว้ให้ครบ\n\n${shopName} ช่วยเช็กให้ได้ว่ารุ่นไหนใช้ร่วมกันได้ รุ่นไหนไม่ควรเสี่ยงใส่แทน เพื่อให้งานซ่อมเดินต่อได้ไว${noteLine}\n\n${cta}`,
    },
    {
      title: `${topic} สำหรับงานซ่อมวันนี้`,
      caption: `งานซ่อมบางครั้งเสียเวลาเพราะหา${topic}ไม่ตรงรุ่นหรือข้อมูลไม่ครบ\n\nส่งรุ่นรถ อาการ และรูปชิ้นส่วนเดิมมาให้ ${shopName} ช่วยดูได้ เราจะช่วยไล่ข้อมูลให้ก่อนตัดสินใจ\n\nเหมาะกับงานด่วน งานหน้าร้าน และลูกค้าที่อยากได้คำตอบเร็ว${noteLine}\n\n${cta}`,
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

async function callOpenAI(prompt: string, maxOutputTokens: number) {
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
      input: prompt,
      max_output_tokens: maxOutputTokens,
    }),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`OPENAI_REQUEST_FAILED:${response.status}:${body}`);
  }

  const payload = (await response.json()) as {
    output_text?: string;
  };

  return payload.output_text?.trim() || null;
}

async function generateTopicsWithOpenAI(input: GenerateContentTopicsInput, shopName: string) {
  const rawText = await callOpenAI(buildTopicsPrompt(input, shopName), 1000);
  if (!rawText) return null;

  const jsonText = tryExtractJson(rawText);
  if (!jsonText) return null;

  const parsed = JSON.parse(jsonText) as { topics?: ContentTopicIdea[] };
  if (!Array.isArray(parsed.topics)) return null;

  return sanitizeTopics(parsed.topics);
}

async function generateDraftsWithOpenAI(input: GenerateContentDraftsInput, shopName: string) {
  const rawText = await callOpenAI(buildDraftsPrompt(input, shopName), 1200);
  if (!rawText) return null;

  const jsonText = tryExtractJson(rawText);
  if (!jsonText) return null;

  const parsed = JSON.parse(jsonText) as { drafts?: ContentDraftIdea[] };
  if (!Array.isArray(parsed.drafts)) return null;

  return sanitizeDrafts(parsed.drafts);
}

export async function suggestContentTopics(input: GenerateContentTopicsInput): Promise<ContentTopicIdea[]> {
  const siteConfig = await getSiteConfig();
  const normalizedInput = {
    businessType: input.businessType?.trim(),
    audience: input.audience?.trim(),
    goal: input.goal?.trim(),
    seasonOrFestival: input.seasonOrFestival?.trim(),
    notes: input.notes?.trim(),
    recentPosts: input.recentPosts?.map((value) => value.trim()).filter(Boolean),
  };

  try {
    const topics = await generateTopicsWithOpenAI(normalizedInput, siteConfig.shopName);
    if (topics && topics.length >= 3) {
      return topics;
    }
  } catch (error) {
    console.warn("[content-ai] falling back to template topics", error);
  }

  return buildFallbackTopics(normalizedInput);
}

export async function generateContentDraftIdeas(
  input: GenerateContentDraftsInput
): Promise<ContentDraftIdea[]> {
  const siteConfig = await getSiteConfig();
  const normalizedInput = {
    topic: input.topic.trim(),
    businessType: input.businessType?.trim(),
    audience: input.audience?.trim(),
    goal: input.goal?.trim(),
    seasonOrFestival: input.seasonOrFestival?.trim(),
    callToAction: input.callToAction?.trim(),
    notes: input.notes?.trim(),
    recentPosts: input.recentPosts?.map((value) => value.trim()).filter(Boolean),
  };

  if (!normalizedInput.topic) {
    throw new Error("MISSING_TOPIC");
  }

  try {
    const aiDrafts = await generateDraftsWithOpenAI(normalizedInput, siteConfig.shopName);
    if (aiDrafts && aiDrafts.length === 3) {
      return aiDrafts;
    }
  } catch (error) {
    console.warn("[content-ai] falling back to template drafts", error);
  }

  return buildEnhancedFallbackDrafts(normalizedInput, siteConfig.shopName);
}
