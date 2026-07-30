export type AdminOnlyKnowledgeTopic = "warranty_return" | "shipping";

type KnowledgePolicySection = {
  heading: string;
  body: string[];
  aiEnabled: boolean;
};

export type KnowledgeRagPolicyInput = {
  title: string;
  description?: string | null;
  content: {
    intro: string;
    highlights: string[];
    sections: KnowledgePolicySection[];
  };
  ragEnabled: boolean;
};

export type KnowledgeRagPolicyViolation = {
  topic: AdminOnlyKnowledgeTopic;
  scope: "SOURCE" | "SECTION";
  sectionIndex?: number;
};

const WARRANTY_RETURN_RE =
  /(รับประกัน|ประกัน(?:สินค้า|กี่วัน|กี่เดือน|ไหม|มั้ย|หรือไม่)?|วารันตี|warranty|เคลม|claim|คืน(?:สินค้า|ของ|เงิน)|เปลี่ยนสินค้า|return)/i;
const SHIPPING_RE =
  /(ค่าจัดส่ง|ค่าส่ง|ส่งต่างจังหวัด|ส่งทั่วประเทศ|มีบริการ(?:จัด)?ส่ง|จัดส่ง|การส่ง(?:สินค้า|ของ)|ขนส่ง|ส่งของ|ส่งกี่วัน|ส่งนาน|ส่งถึง|ระยะเวลาส่ง|delivery|shipping)/i;

export function detectAdminOnlyKnowledgeTopic(text?: string | null): AdminOnlyKnowledgeTopic | null {
  const normalized = text?.trim();
  if (!normalized) return null;
  if (WARRANTY_RETURN_RE.test(normalized)) return "warranty_return";
  if (SHIPPING_RE.test(normalized)) return "shipping";
  return null;
}

export function findKnowledgeRagPolicyViolations(
  input: KnowledgeRagPolicyInput,
): KnowledgeRagPolicyViolation[] {
  if (!input.ragEnabled) return [];

  const violations: KnowledgeRagPolicyViolation[] = [];
  const overviewTopic = detectAdminOnlyKnowledgeTopic(
    [input.title, input.description, input.content.intro, ...input.content.highlights]
      .filter(Boolean)
      .join("\n"),
  );
  if (overviewTopic) {
    violations.push({ topic: overviewTopic, scope: "SOURCE" });
  }

  input.content.sections.forEach((section, sectionIndex) => {
    if (!section.aiEnabled) return;
    const topic = detectAdminOnlyKnowledgeTopic(
      [section.heading, ...section.body].join("\n"),
    );
    if (topic) {
      violations.push({ topic, scope: "SECTION", sectionIndex });
    }
  });
  return violations;
}

export function knowledgeRagPolicyError(
  input: KnowledgeRagPolicyInput,
): string | null {
  const violation = findKnowledgeRagPolicyViolations(input)[0];
  if (!violation) return null;
  const subject =
    violation.topic === "warranty_return"
      ? "ประกันหรือการคืนสินค้า"
      : "ค่าจัดส่งหรือการจัดส่ง";
  const location =
    violation.scope === "SECTION" && violation.sectionIndex !== undefined
      ? `หัวข้อที่ ${violation.sectionIndex + 1}`
      : "เนื้อหาหลัก";
  return `${location}เกี่ยวข้องกับ${subject} ซึ่งกำหนดให้แอดมินตอบเท่านั้น กรุณาปิดการใช้กับ AI ในส่วนนี้`;
}

export function buildJuneAdminOnlyHandoffMessage(topic: AdminOnlyKnowledgeTopic): string {
  const subject =
    topic === "warranty_return"
      ? "เรื่องประกันหรือการคืนสินค้า"
      : "เรื่องค่าจัดส่งหรือการจัดส่ง";
  return `${subject} จูนขอส่งให้แอดมินช่วยตรวจสอบรายละเอียดให้นะคะ 🙏 เดี๋ยวแอดมินติดต่อกลับทางแชตนี้ค่ะ`;
}
