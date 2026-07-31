import assert from "node:assert/strict";
import test from "node:test";
import {
  addDaysToDateString,
  assessKnowledgeQuality,
  defaultKnowledgeGovernance,
  findKnowledgeDuplicateIssues,
} from "@/lib/knowledge-cms-quality";
import type { KnowledgeContent } from "@/lib/knowledge-cms-types";

function validContent(): KnowledgeContent {
  return {
    intro: "เตรียมรุ่นรถ ปีรถ และรูปอะไหล่เดิมก่อนสอบถาม",
    highlights: [],
    sections: [
      {
        heading: "ข้อมูลที่ควรเตรียม",
        body: ["รุ่นรถ ปีรถ รหัสเดิม และรูปอะไหล่"],
        format: "BULLETS",
        aiEnabled: true,
        evidenceUrls: ["https://example.com/source"],
      },
    ],
    relatedSearches: [],
    internalLinks: [],
    readingMinutes: 2,
    governance: {
      ownerUserId: "user-1",
      reviewedOn: "2026-07-31",
      validUntil: "2027-01-27",
      evidenceLevel: "PRIMARY_SOURCE",
      evidenceNotes: "ตรวจจากคู่มือ",
      checklist: {
        factsChecked: true,
        sourcesTraceable: true,
        aiScopeReviewed: true,
        adminOnlyTopicsReviewed: true,
      },
    },
  };
}

test("knowledge freshness SLA uses date-only Bangkok-safe arithmetic", () => {
  assert.equal(addDaysToDateString("2026-07-31", 30), "2026-08-30");
  const governance = defaultKnowledgeGovernance(
    "FAQ",
    "user-1",
    "2026-07-31",
  );
  assert.equal(governance.validUntil, "2026-10-29");
});

test("quality gate accepts complete, current, traceable governance", () => {
  assert.deepEqual(
    assessKnowledgeQuality({
      type: "ARTICLE",
      content: validContent(),
      ragEnabled: true,
      sourceUrls: ["https://example.com/source"],
      today: "2026-07-31",
    }),
    [],
  );
});

test("quality gate blocks stale and incomplete RAG sources", () => {
  const content = validContent();
  content.governance = {
    evidenceLevel: "UNVERIFIED",
    validUntil: "2026-07-30",
  };
  const codes = assessKnowledgeQuality({
    type: "FAQ",
    content,
    ragEnabled: true,
    sourceUrls: [],
    today: "2026-07-31",
  }).map((issue) => issue.code);
  assert.ok(codes.includes("OWNER_MISSING"));
  assert.ok(codes.includes("REVIEW_DATE_MISSING"));
  assert.ok(codes.includes("EXPIRED"));
  assert.ok(codes.includes("EVIDENCE_UNVERIFIED"));
  assert.ok(codes.includes("EVIDENCE_URL_MISSING"));
  assert.ok(codes.includes("CHECKLIST_INCOMPLETE"));
});

test("duplicate gate distinguishes identical and conflicting answers", () => {
  const duplicate = findKnowledgeDuplicateIssues({
    sourceId: "current",
    title: "รหัส OEM ช่วยค้นหาอย่างไร?",
    intro: "ใช้รหัสเดิมช่วยลดความคลุมเครือ",
    others: [
      {
        sourceId: "same",
        title: "รหัส OEM ช่วยค้นหาอย่างไร",
        intro: "ใช้รหัสเดิมช่วยลดความคลุมเครือ",
      },
    ],
  });
  assert.equal(duplicate[0]?.code, "DUPLICATE_TITLE");

  const conflict = findKnowledgeDuplicateIssues({
    sourceId: "current",
    title: "รหัส OEM ช่วยค้นหาอย่างไร?",
    intro: "ใช้รหัสเดิมช่วยลดความคลุมเครือ",
    others: [
      {
        sourceId: "other",
        title: "รหัส OEM ช่วยค้นหาอย่างไร",
        intro: "ใช้รหัสอย่างเดียวยืนยันสินค้าได้เสมอ",
      },
    ],
  });
  assert.equal(conflict[0]?.code, "CONFLICTING_ANSWER");
});
