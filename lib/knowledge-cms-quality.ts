import type {
  KnowledgeContent,
  KnowledgeEvidenceLevel,
  KnowledgeGovernance,
} from "@/lib/knowledge-cms-types";

export type KnowledgeQualitySourceType = "ARTICLE" | "FAQ" | "POLICY";
export type KnowledgeQualityIssueCode =
  | "OWNER_MISSING"
  | "REVIEW_DATE_MISSING"
  | "EXPIRY_MISSING"
  | "EXPIRED"
  | "EXPIRY_BEFORE_REVIEW"
  | "EVIDENCE_UNVERIFIED"
  | "EVIDENCE_URL_MISSING"
  | "CHECKLIST_INCOMPLETE"
  | "DUPLICATE_TITLE"
  | "CONFLICTING_ANSWER";

export type KnowledgeQualityIssue = {
  code: KnowledgeQualityIssueCode;
  severity: "BLOCKING" | "WARNING";
  message: string;
};

export const KNOWLEDGE_FRESHNESS_DAYS: Record<
  KnowledgeQualitySourceType,
  number
> = {
  ARTICLE: 180,
  FAQ: 90,
  POLICY: 30,
};

export const knowledgeEvidenceLevelLabel: Record<
  KnowledgeEvidenceLevel,
  string
> = {
  UNVERIFIED: "ยังไม่ตรวจหลักฐาน",
  INTERNAL_REVIEWED: "ตรวจสอบภายในร้าน",
  PRIMARY_SOURCE: "แหล่งข้อมูลต้นทาง",
  MULTIPLE_SOURCES: "ยืนยันหลายแหล่ง",
};

export function bangkokDateString(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function addDaysToDateString(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00+07:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return bangkokDateString(date);
}

export function defaultKnowledgeGovernance(
  type: KnowledgeQualitySourceType,
  ownerUserId = "",
  reviewedOn = bangkokDateString(),
): KnowledgeGovernance {
  return {
    ownerUserId,
    reviewedOn,
    validUntil: addDaysToDateString(reviewedOn, KNOWLEDGE_FRESHNESS_DAYS[type]),
    evidenceLevel: "UNVERIFIED",
    evidenceNotes: "",
    checklist: {
      factsChecked: false,
      sourcesTraceable: false,
      aiScopeReviewed: false,
      adminOnlyTopicsReviewed: false,
    },
  };
}

function normalizeForComparison(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("th-TH")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function assessKnowledgeQuality(input: {
  type: KnowledgeQualitySourceType;
  content: KnowledgeContent;
  ragEnabled: boolean;
  sourceUrls: string[];
  today?: string;
}): KnowledgeQualityIssue[] {
  const issues: KnowledgeQualityIssue[] = [];
  const governance = input.content.governance;
  const today = input.today ?? bangkokDateString();

  if (!governance?.ownerUserId) {
    issues.push({
      code: "OWNER_MISSING",
      severity: "BLOCKING",
      message: "ยังไม่ได้กำหนดผู้รับผิดชอบเนื้อหา",
    });
  }
  if (!governance?.reviewedOn) {
    issues.push({
      code: "REVIEW_DATE_MISSING",
      severity: "BLOCKING",
      message: "ยังไม่ได้ระบุวันที่ตรวจทานล่าสุด",
    });
  }
  if (!governance?.validUntil) {
    issues.push({
      code: "EXPIRY_MISSING",
      severity: "BLOCKING",
      message: "ยังไม่ได้ระบุวันครบกำหนดทบทวน",
    });
  } else if (governance.validUntil < today) {
    issues.push({
      code: "EXPIRED",
      severity: "BLOCKING",
      message: `เนื้อหาครบกำหนดทบทวนแล้ว (${governance.validUntil})`,
    });
  }
  if (
    governance?.reviewedOn &&
    governance.validUntil &&
    governance.validUntil <= governance.reviewedOn
  ) {
    issues.push({
      code: "EXPIRY_BEFORE_REVIEW",
      severity: "BLOCKING",
      message: "วันครบกำหนดทบทวนต้องอยู่หลังวันที่ตรวจทานล่าสุด",
    });
  }
  if (!governance?.evidenceLevel || governance.evidenceLevel === "UNVERIFIED") {
    issues.push({
      code: "EVIDENCE_UNVERIFIED",
      severity: "BLOCKING",
      message: "ยังไม่ได้ยืนยันระดับหลักฐานของเนื้อหา",
    });
  }
  if (input.ragEnabled && input.sourceUrls.length === 0) {
    issues.push({
      code: "EVIDENCE_URL_MISSING",
      severity: "BLOCKING",
      message: "เนื้อหาที่ให้ AI ใช้ต้องมี URL แหล่งอ้างอิงอย่างน้อย 1 รายการ",
    });
  }
  const checklist = governance?.checklist;
  if (
    !checklist?.factsChecked ||
    !checklist.sourcesTraceable ||
    !checklist.aiScopeReviewed ||
    !checklist.adminOnlyTopicsReviewed
  ) {
    issues.push({
      code: "CHECKLIST_INCOMPLETE",
      severity: "BLOCKING",
      message: "เช็กลิสต์ก่อนอนุมัติยังไม่ครบทุกข้อ",
    });
  }
  return issues;
}

export function findKnowledgeDuplicateIssues(input: {
  sourceId: string;
  title: string;
  intro: string;
  others: Array<{
    sourceId: string;
    title: string;
    intro: string;
  }>;
}): KnowledgeQualityIssue[] {
  const normalizedTitle = normalizeForComparison(input.title);
  const normalizedIntro = normalizeForComparison(input.intro);
  const issues: KnowledgeQualityIssue[] = [];

  for (const other of input.others) {
    if (other.sourceId === input.sourceId) continue;
    if (normalizeForComparison(other.title) !== normalizedTitle) continue;
    const sameAnswer = normalizeForComparison(other.intro) === normalizedIntro;
    issues.push({
      code: sameAnswer ? "DUPLICATE_TITLE" : "CONFLICTING_ANSWER",
      severity: "BLOCKING",
      message: sameAnswer
        ? `พบเนื้อหาซ้ำกับ “${other.title}”`
        : `พบชื่อเรื่องเดียวกันแต่คำตอบขัดกันกับ “${other.title}”`,
    });
  }
  return issues;
}

export function expiryUrgency(
  validUntil: string | undefined,
  today = bangkokDateString(),
): "MISSING" | "EXPIRED" | "DUE_SOON" | "CURRENT" {
  if (!validUntil) return "MISSING";
  if (validUntil < today) return "EXPIRED";
  const dueSoon = addDaysToDateString(today, 30);
  return validUntil <= dueSoon ? "DUE_SOON" : "CURRENT";
}
