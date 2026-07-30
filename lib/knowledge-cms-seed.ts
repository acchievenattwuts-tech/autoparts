import { absoluteUrl } from "@/lib/seo";
import { knowledgeArticles } from "@/lib/knowledge-content";
import { APPROVED_KNOWLEDGE_ARTICLE_SLUGS } from "@/lib/knowledge-corpus";
import { storefrontFaqItems } from "@/lib/storefront-content";
import type { KnowledgeContent } from "@/lib/knowledge-cms-types";

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
const approvedFaqIndexes = new Set([0, 1, 2, 4, 5, 10]);

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
    },
    answerScope: "ใช้ช่วยลูกค้าเตรียมข้อมูลและคัดกรองเบื้องต้นเท่านั้น ห้ามยืนยันสินค้า ราคา สต็อก ความตรงรุ่น ผลวินิจฉัย หรือผลเคลม",
    riskLevel: "LOW",
    ragEnabled,
    sourceUrls: [absoluteUrl(`/knowledge/${article.slug}`)],
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
  },
  answerScope: "ตอบได้เฉพาะข้อมูลทั่วไปตามข้อความนี้ ห้ามยืนยันราคา สต็อก ความตรงรุ่น การชำระเงิน หรือสถานะออเดอร์",
  riskLevel: index === 4 ? "MEDIUM" : "LOW",
  ragEnabled: approvedFaqIndexes.has(index),
  sourceUrls: [absoluteUrl("/faq")],
}));

const policyEntry: KnowledgeSeedEntry = {
  sourceKey: "policy:return-warranty",
  type: "POLICY",
  slug: "return-warranty-policy",
  title: "นโยบายคืนสินค้า / การรับประกัน",
  description: "เงื่อนไขการรับประกัน การคืนสินค้า การแจ้งความเสียหายจากขนส่ง และขั้นตอนการเคลม",
  category: "นโยบายร้าน",
  content: {
    intro: "ทางร้านจำหน่ายอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์ โดยระยะเวลาการรับประกันของสินค้าแต่ละประเภทแตกต่างกัน กรุณาตรวจสอบเงื่อนไขก่อนสั่งซื้อ",
    highlights: [
      "แจ้งคืนหรือเปลี่ยนสินค้าภายใน 7 วันนับจากวันที่ได้รับสินค้า",
      "กรณีเสียหายจากขนส่ง กรุณาแจ้งภายใน 24–48 ชั่วโมงและเก็บหลักฐานการแกะกล่อง",
      "การอนุมัติเคลมแต่ละกรณีต้องให้เจ้าหน้าที่ตรวจสอบหลักฐาน",
    ],
    sections: [
      {
        heading: "ระยะเวลาการรับประกัน",
        format: "TABLE",
        aiEnabled: false,
        body: [
          "คอมเพรสเซอร์แอร์ (คอมแอร์) | 180 วัน",
          "ตู้แอร์ / คอยล์เย็น | 90 วัน",
          "แผงแอร์ / คอนเดนเซอร์ / คอยล์ร้อน | 90 วัน",
          "หม้อน้ำรถยนต์ | 90 วัน",
          "หมายเหตุ: สินค้ายี่ห้อ Cool Gear และ Denso ไม่มีการรับประกันทุกกรณี",
        ],
      },
      {
        heading: "เงื่อนไขที่อยู่ในการรับประกัน",
        format: "BULLETS",
        aiEnabled: false,
        body: [
          "สินค้าชำรุดหรือบกพร่องจากกระบวนการผลิต ที่แสดงอาการขึ้นเองภายในระยะเวลารับประกัน",
          "ร้านจัดส่งสินค้าผิดรุ่นหรือผิดสเปกจากความผิดพลาดของร้านเอง โดยยินดีเปลี่ยนหรือคืนเต็มจำนวน",
        ],
      },
      {
        heading: "กรณีที่ไม่อยู่ในการรับประกัน",
        format: "BULLETS",
        aiEnabled: false,
        body: [
          "ความเสียหายจากการติดตั้งผิดวิธีหรือติดตั้งโดยช่างที่ไม่ชำนาญ",
          "รอยขีดข่วน บุบ แตก ร้าว งอ หรือความเสียหายหลังการติดตั้งหรือใช้งาน",
          "สติกเกอร์รับประกันฉีกขาด หลุดหาย หรือมีร่องรอยการแกะหรือถอดซ่อมเอง",
          "ความเสียหายจากอุบัติเหตุ ภัยธรรมชาติ น้ำท่วม หรือการใช้งานผิดประเภท",
          "สินค้าที่หมดระยะเวลารับประกันตามตาราง",
          "สินค้ายี่ห้อ Cool Gear และ Denso ไม่มีการรับประกันทุกกรณี",
        ],
      },
      {
        heading: "สินค้าชำรุดหรือแตกหักจากการขนส่ง",
        format: "BULLETS",
        aiEnabled: true,
        body: [
          "ถ่ายคลิปวิดีโอขณะแกะกล่องพัสดุแบบต่อเนื่องไม่ตัดต่อ ตั้งแต่กล่องยังปิดสนิทจนเห็นตัวสินค้า",
          "แจ้งร้านภายใน 24–48 ชั่วโมงหลังได้รับพัสดุ พร้อมรูปกล่อง ตัวสินค้า และใบจัดส่ง",
          "ร้านจะประสานงานบริษัทขนส่งและดำเนินการเปลี่ยนสินค้าหรือคืนเงินตามผลตรวจสอบ",
        ],
      },
      {
        heading: "การคืนหรือเปลี่ยนสินค้า",
        format: "BULLETS",
        aiEnabled: true,
        body: [
          "แจ้งความประสงค์ภายใน 7 วันนับจากวันที่ได้รับสินค้า",
          "สินค้าต้องอยู่ในสภาพสมบูรณ์ ครบกล่องและอุปกรณ์ และยังไม่ผ่านการติดตั้งหรือใช้งาน",
          "ถ้าเป็นความผิดพลาดของร้าน ร้านรับผิดชอบค่าจัดส่งคืน",
          "ร้านจะเปลี่ยนเป็นรุ่นเดิม หากสินค้าหมดจะคืนเงินหรือเสนอรุ่นใกล้เคียงให้พิจารณา",
        ],
      },
      {
        heading: "ขั้นตอนการแจ้งเคลม",
        format: "STEPS",
        aiEnabled: true,
        body: [
          "ติดต่อร้านพร้อมเลขที่ใบเสร็จหรือเลขออเดอร์",
          "ส่งรูปหรือคลิปวิดีโอ พร้อมอธิบายอาการของสินค้า",
          "รอเจ้าหน้าที่ประเมินและแจ้งผลภายใน 1–3 วันทำการ",
          "เมื่อได้รับคำแนะนำจากเจ้าหน้าที่ จึงจัดส่งสินค้ากลับตามขั้นตอน",
        ],
      },
    ],
    relatedSearches: ["เงื่อนไขรับประกันอะไหล่รถยนต์", "คืนสินค้า", "สินค้าเสียหายจากขนส่ง", "ขั้นตอนเคลม"],
    internalLinks: [],
    readingMinutes: 5,
  },
  answerScope: "อธิบายเงื่อนไขและขั้นตอนทั่วไปได้ แต่ห้ามยืนยันผลเคลมของเคสจริงหรือรับรองว่าสินค้ารายการใดอยู่ในการรับประกัน",
  riskLevel: "MEDIUM",
  ragEnabled: true,
  sourceUrls: [absoluteUrl("/return-warranty-policy")],
};

export function getKnowledgeCmsSeedEntries(): KnowledgeSeedEntry[] {
  return [...articleEntries, ...faqEntries, policyEntry];
}

export function getLegacyPolicySeedEntry(): KnowledgeSeedEntry {
  return policyEntry;
}
