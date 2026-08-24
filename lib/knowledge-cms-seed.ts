import { absoluteUrl } from "@/lib/seo";
import { knowledgeArticles } from "@/lib/knowledge-content";
import { APPROVED_KNOWLEDGE_ARTICLE_SLUGS } from "@/lib/knowledge-corpus";
import { storefrontFaqItems } from "@/lib/storefront-content";
import type { KnowledgeContent } from "@/lib/knowledge-cms-types";
import {
  addDaysToDateString,
  KNOWLEDGE_FRESHNESS_DAYS,
} from "@/lib/knowledge-cms-quality";

export type KnowledgeSeedEntry = {
  sourceKey: string;
  type: "ARTICLE" | "FAQ" | "POLICY";
  slug: string | null;
  title: string;
  description: string | null;
  category: string | null;
  content: KnowledgeContent;
  answerScope: string;
  riskLevel: "LOW" | "MEDIUM";
  ragEnabled: boolean;
  sourceUrls: string[];
};

const approvedArticleSlugs = new Set<string>(APPROVED_KNOWLEDGE_ARTICLE_SLUGS);
// Shipping, shipping fees, warranty and returns are always admin-owned in chat.
// They may remain public storefront content, but must not enter the RAG corpus.
const approvedFaqIndexes = new Set([0, 1, 2, 4, 12, 13, 14]);
const reviewedOn = "2026-07-31";
const approvedChecklist = {
  factsChecked: true,
  sourcesTraceable: true,
  aiScopeReviewed: true,
  adminOnlyTopicsReviewed: true,
};
const articleExternalSources: Partial<Record<string, string[]>> = {
  "how-to-choose-the-right-ac-compressor": [
    "https://www.hella.com/techworld/en/car-parts/thermal-management/a-c-compressors/",
  ],
  "how-to-check-oem-part-number-before-ordering": [
    "https://www.denso-am.eu/de/news/201604-neue-kompressor-labels",
  ],
  "can-one-ac-part-fit-multiple-car-models": [
    "https://www.hella.com/techworld/ae/technical/car-air-conditioning/car-air-conditioning/",
    "https://www.mahle-aftermarket.com/media/homepage/facelift/media-center/klima/kompaktwissen-ac-fahrzeugklimatisierung-en-screen.pdf",
  ],
  "how-to-check-compressor-plug-pulley-and-mounting-points": [
    "https://www.hella.com/techworld/ae/technical/car-air-conditioning/car-air-conditioning/",
  ],
};
const faqEvidenceSources: Partial<Record<number, string[]>> = {
  12: [absoluteUrl("/knowledge/how-to-compare-old-part-before-chatting-with-the-shop")],
  13: [absoluteUrl("/knowledge/how-to-check-oem-part-number-before-ordering")],
  14: [
    absoluteUrl(
      "/knowledge/how-to-check-compressor-plug-pulley-and-mounting-points",
    ),
    "https://www.hella.com/techworld/ae/technical/car-air-conditioning/car-air-conditioning/",
  ],
};

const articleEntries: KnowledgeSeedEntry[] = knowledgeArticles.map((article) => {
  const ragEnabled = approvedArticleSlugs.has(article.slug);
  return {
    sourceKey: `article:${article.slug}`,
    type: "ARTICLE",
    slug: article.slug,
    title: article.title,
    description: article.description,
    category: article.category,
    content: {
      intro: article.intro,
      highlights: article.keyTakeaways,
      sections: article.sections.map((section) => ({
        heading: section.heading,
        body: section.body,
        format: "PARAGRAPHS" as const,
        aiEnabled: ragEnabled,
      })),
      relatedSearches: article.relatedSearches,
      internalLinks: article.internalLinks ?? [],
      readingMinutes: article.readingMinutes,
      publishedAt: article.publishedAt,
      governance: {
        ownerUserId: undefined,
        reviewedOn,
        validUntil: addDaysToDateString(
          reviewedOn,
          KNOWLEDGE_FRESHNESS_DAYS.ARTICLE,
        ),
        evidenceLevel: articleExternalSources[article.slug]
          ? "MULTIPLE_SOURCES"
          : "INTERNAL_REVIEWED",
        evidenceNotes: articleExternalSources[article.slug]
          ? "ตรวจเทียบกับเอกสารทางเทคนิคของผู้ผลิต/ผู้ให้บริการอะไหล่ และข้อกำหนดภายในร้าน"
          : "ตรวจทานจากขั้นตอนการให้ข้อมูลลูกค้าและเนื้อหาที่อนุมัติภายในร้าน",
        checklist: approvedChecklist,
      },
    },
    answerScope: "ใช้ช่วยลูกค้าเตรียมข้อมูลและคัดกรองเบื้องต้นเท่านั้น ห้ามยืนยันสินค้า ราคา สต็อก ความตรงรุ่น ผลวินิจฉัย หรือผลเคลม",
    riskLevel: "LOW",
    ragEnabled,
    sourceUrls: [
      absoluteUrl(`/knowledge/${article.slug}`),
      ...(articleExternalSources[article.slug] ?? []),
    ],
  };
});

const faqEntries: KnowledgeSeedEntry[] = storefrontFaqItems.map((faq, index) => ({
  sourceKey: `faq:storefront:${index + 1}`,
  type: "FAQ",
  slug: null,
  title: faq.question,
  description: faq.answer.slice(0, 240),
  category: "คำถามที่พบบ่อย",
  content: {
    intro: faq.answer,
    highlights: [],
    sections: [{ heading: "รายละเอียด", body: [faq.answer], format: "PARAGRAPHS", aiEnabled: false }],
    relatedSearches: [],
    internalLinks: [],
    readingMinutes: 1,
    governance: {
      ownerUserId: undefined,
      reviewedOn,
      validUntil: addDaysToDateString(
        reviewedOn,
        KNOWLEDGE_FRESHNESS_DAYS.FAQ,
      ),
      evidenceLevel: faqEvidenceSources[index]
        ? "MULTIPLE_SOURCES"
        : "INTERNAL_REVIEWED",
      evidenceNotes: "ตรวจทานกับข้อมูลหน้าร้านและบทความที่อนุมัติแล้ว",
      checklist: approvedChecklist,
    },
  },
  answerScope: "ตอบได้เฉพาะข้อมูลทั่วไปตามข้อความนี้ ห้ามยืนยันราคา สต็อก ความตรงรุ่น การชำระเงิน หรือสถานะออเดอร์",
  riskLevel: index === 4 ? "MEDIUM" : "LOW",
  ragEnabled: approvedFaqIndexes.has(index),
  sourceUrls: [
    absoluteUrl("/faq"),
    ...(faqEvidenceSources[index] ?? []),
  ],
}));

// นโยบายฉบับปัจจุบันมาจากเอกสาร "เงื่อนไขการรับประกันสินค้า" ที่เจ้าของร้านตรวจทานเมื่อ 2026-08-24
const policyReviewedOn = "2026-08-24";

const policyEntry: KnowledgeSeedEntry = {
  sourceKey: "policy:return-warranty",
  type: "POLICY",
  slug: "return-warranty-policy",
  title: "นโยบายคืนสินค้า / การรับประกัน",
  description:
    "เงื่อนไขการรับประกันสินค้า ข้อมูลที่ต้องแจ้งก่อนส่งเคลม กรณีที่ไม่อยู่ในการรับประกัน และเงื่อนไขค่าขนส่งสำหรับลูกค้าต่างจังหวัด",
  category: "นโยบายร้าน",
  content: {
    intro:
      "ก่อนส่งสินค้าเคลม กรุณาติดต่อทางร้านและแจ้งรายละเอียดปัญหา พร้อมส่งข้อมูลประกอบการตรวจสอบให้ครบถ้วน ทางร้านขอสงวนสิทธิ์ตรวจสอบสภาพสินค้า สาเหตุความเสียหาย การติดตั้ง และหลักฐานที่เกี่ยวข้องก่อนพิจารณาผลการเคลม",
    highlights: [],
    sections: [
      {
        heading: "ข้อมูลที่ต้องแจ้งก่อนส่งสินค้าเคลม",
        format: "BULLETS",
        aiEnabled: false,
        body: [
          "รูปภาพหรือวิดีโออาการเสีย",
          "เลขที่คำสั่งซื้อหรือใบเสร็จ",
          "รุ่นรถและรายละเอียดการติดตั้ง",
          "ข้อมูลอื่น ๆ ที่ทางร้านร้องขอเพื่อประกอบการตรวจสอบ",
        ],
      },
      {
        heading: "เงื่อนไขการรับประกันสินค้า",
        format: "BULLETS",
        aiEnabled: false,
        body: [
          "สินค้ารับประกันเฉพาะความเสียหายหรือความบกพร่องที่เกิดจากตัวสินค้าและการผลิต ภายในระยะเวลารับประกันที่ทางร้านกำหนด",
          "สินค้าจะต้องได้รับการติดตั้งและใช้งานอย่างถูกต้องตามประเภทของสินค้าและหลักวิชาช่าง",
          "ทางร้านขอสงวนสิทธิ์ตรวจสอบสภาพสินค้า สาเหตุความเสียหาย การติดตั้ง และหลักฐานที่เกี่ยวข้องก่อนพิจารณาผลการเคลม",
          "การส่งสินค้าเข้าตรวจสอบไม่ถือว่าได้รับอนุมัติการเคลมทันที ทางร้านจะแจ้งผลหลังจากตรวจสอบเรียบร้อยแล้ว",
          "กรณีที่ตรวจสอบพบว่าสินค้าเสียจากตัวสินค้า หรือเกิดจากความบกพร่องจากการผลิต ทางร้านจะดำเนินการตามเงื่อนไขการรับประกัน เช่น ซ่อม เปลี่ยนสินค้า หรือดำเนินการตามความเหมาะสม",
        ],
      },
      {
        heading: "การรับประกันไม่ครอบคลุมความเสียหายที่เกิดจากกรณีดังต่อไปนี้",
        format: "BULLETS",
        aiEnabled: false,
        body: [
          "การติดตั้งผิดวิธี",
          "การใช้งานผิดประเภท",
          "อุบัติเหตุ การกระแทก แตก หัก บิดงอ หรือความเสียหายจากภายนอก",
          "การดัดแปลง แกะ ซ่อม เชื่อม หรือเปลี่ยนแปลงสภาพสินค้า",
          "ความเสียหายที่เกิดจากอุปกรณ์หรือระบบอื่นของรถ",
          "การใช้น้ำยา น้ำมัน น้ำยาหล่อเย็น หรือสารเคมีผิดประเภท",
          "ระบบไม่ได้รับการล้างหรือทำความสะอาดก่อนติดตั้งอะไหล่ใหม่ ในกรณีที่จำเป็น",
          "สิ่งสกปรก เศษโลหะ หรือสิ่งแปลกปลอมในระบบ",
          "สินค้าพ้นระยะเวลารับประกัน",
          "กรณีที่ไม่สามารถแสดงหลักฐานการซื้อหรือข้อมูลที่จำเป็นต่อการตรวจสอบ",
        ],
      },
      {
        heading: "เงื่อนไขการส่งสินค้าเคลมสำหรับลูกค้าต่างจังหวัด",
        format: "BULLETS",
        aiEnabled: false,
        body: [
          "ลูกค้าต้องแพ็กสินค้าให้เรียบร้อยและเหมาะสมกับการขนส่ง เพื่อป้องกันความเสียหายระหว่างทาง",
          "ค่าจัดส่งสินค้าจากลูกค้ามายังทางร้านเพื่อส่งตรวจเคลม ให้ลูกค้าเป็นผู้สำรองจ่ายก่อน",
          "หลังจากทางร้านได้รับสินค้าแล้ว ทางร้านจะดำเนินการตรวจสอบหาสาเหตุของปัญหาและแจ้งผลให้ลูกค้าทราบ",
          "กรณีตรวจสอบแล้วพบว่าปัญหาเกิดจากตัวสินค้า หรือความบกพร่องจากการผลิตจริง และอยู่ภายใต้เงื่อนไขการรับประกัน ทางร้านจะรับผิดชอบค่าขนส่งสินค้าทั้งเที่ยวส่งเข้ามาตรวจสอบและเที่ยวจัดส่งสินค้ากลับไปยังลูกค้า",
          "สำหรับค่าขนส่งเที่ยวที่ลูกค้าสำรองจ่ายมาก่อน ทางร้านจะคืนค่าขนส่งตามค่าใช้จ่ายจริงและหลักฐานการจัดส่ง หรือตามอัตราที่ทางร้านกำหนดและแจ้งให้ทราบ",
          "กรณีตรวจสอบแล้วพบว่าสินค้าไม่ได้เสียจากตัวสินค้า หรือความเสียหายเกิดจากการติดตั้ง การใช้งาน อุปกรณ์อื่นในระบบ หรือสาเหตุที่อยู่นอกเงื่อนไขการรับประกัน ลูกค้าเป็นผู้รับผิดชอบค่าขนส่งทั้งไปและกลับ",
          "หากมีค่าใช้จ่ายในการซ่อม หรือค่าใช้จ่ายอื่นนอกเหนือจากเงื่อนไขการรับประกัน ทางร้านจะแจ้งให้ลูกค้าทราบและได้รับความยินยอมก่อนดำเนินการ",
          "กรุณาเก็บใบเสร็จหรือหลักฐานค่าจัดส่งสินค้าไว้จนกว่าการตรวจสอบเคลมจะเสร็จสิ้น เพื่อใช้เป็นหลักฐานสำหรับการคืนค่าจัดส่ง",
        ],
      },
      {
        heading: "สรุปเรื่องค่าขนส่งกรณีเคลม",
        format: "BULLETS",
        aiEnabled: false,
        body: [
          "ลูกค้าสำรองค่าขนส่งสินค้ามายังร้านก่อนทุกครั้ง",
          "หากตรวจสอบแล้วพบว่าสินค้าเสียจากตัวสินค้าจริง ทางร้านรับผิดชอบค่าขนส่งทั้งไปและกลับ",
          "หากตรวจสอบแล้วพบว่าปัญหาไม่ได้เกิดจากตัวสินค้า หรืออยู่นอกเงื่อนไขการรับประกัน ลูกค้ารับผิดชอบค่าขนส่งทั้งไปและกลับ",
        ],
      },
      {
        heading: "หมายเหตุ",
        format: "PARAGRAPHS",
        aiEnabled: false,
        body: [
          "ผลการเคลมพิจารณาจากสภาพสินค้า สาเหตุความเสียหาย หลักฐานประกอบ และเงื่อนไขการรับประกันของสินค้านั้น ๆ โดยไม่กระทบต่อสิทธิของผู้บริโภคตามที่กฎหมายกำหนด",
        ],
      },
    ],
    relatedSearches: [
      "เงื่อนไขการรับประกันสินค้า",
      "ขั้นตอนส่งเคลมสินค้า",
      "ค่าขนส่งเคลมต่างจังหวัด",
      "กรณีที่ไม่อยู่ในการรับประกัน",
    ],
    internalLinks: [],
    readingMinutes: 4,
    governance: {
      ownerUserId: undefined,
      reviewedOn: policyReviewedOn,
      validUntil: addDaysToDateString(
        policyReviewedOn,
        KNOWLEDGE_FRESHNESS_DAYS.POLICY,
      ),
      evidenceLevel: "INTERNAL_REVIEWED",
      evidenceNotes:
        "อ้างอิงเอกสารเงื่อนไขการรับประกันสินค้าที่เจ้าของร้านจัดทำ นโยบายให้แอดมินตอบเท่านั้น ต้องตรวจทานทุก 30 วัน",
      checklist: approvedChecklist,
    },
  },
  answerScope:
    "อธิบายเงื่อนไขและขั้นตอนทั่วไปได้ แต่ห้ามยืนยันผลเคลมของเคสจริงหรือรับรองว่าสินค้ารายการใดอยู่ในการรับประกัน",
  riskLevel: "MEDIUM",
  ragEnabled: false,
  sourceUrls: [absoluteUrl("/return-warranty-policy")],
};

export function getKnowledgeCmsSeedEntries(): KnowledgeSeedEntry[] {
  return [...articleEntries, ...faqEntries, policyEntry];
}

export function getLegacyPolicySeedEntry(): KnowledgeSeedEntry {
  return policyEntry;
}
