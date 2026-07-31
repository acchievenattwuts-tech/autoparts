export const KNOWLEDGE_FEEDBACK_REASONS = {
  HELPFUL: "คำตอบถูกต้องและมีประโยชน์",
  INCOMPLETE: "คำตอบยังไม่ครบ",
  WRONG_SOURCE: "อ้างอิงแหล่งข้อมูลไม่ตรง",
  STALE_SOURCE: "ข้อมูลหรือแหล่งอ้างอิงล้าสมัย",
  TOO_VERBOSE: "คำตอบยาวเกินไป",
  SHOULD_HANDOFF: "ควรส่งต่อแอดมิน",
  MISSING_KNOWLEDGE: "คลังความรู้ยังไม่มีเรื่องนี้",
} as const;

export type KnowledgeFeedbackReason = keyof typeof KNOWLEDGE_FEEDBACK_REASONS;
