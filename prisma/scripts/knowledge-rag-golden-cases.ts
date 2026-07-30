import type { AdminOnlyKnowledgeTopic } from "../../lib/chat-core/admin-only-knowledge";

export type KnowledgeRetrievalGoldenCase = {
  question: string;
  expectedSourceRefs: string[];
};

export type KnowledgeAdminOnlyGoldenCase = {
  question: string;
  expectedTopic: AdminOnlyKnowledgeTopic;
};

const articleRefs = (slug: string) => [slug, `article:${slug}`];

export const knowledgeRetrievalGoldenCases: KnowledgeRetrievalGoldenCase[] = [
  {
    question: "เช็กรหัส OEM ก่อนสั่งซื้ออย่างไร",
    expectedSourceRefs: articleRefs("how-to-check-oem-part-number-before-ordering"),
  },
  {
    question: "รหัสอะไหล่เดิมดูตรงไหนและควรถ่ายรูปอย่างไร",
    expectedSourceRefs: articleRefs("how-to-check-oem-part-number-before-ordering"),
  },
  {
    question: "ก่อนสั่งอะไหล่ต้องส่งข้อมูลรถและรูปอะไรบ้าง",
    expectedSourceRefs: articleRefs("what-information-to-send-before-ordering"),
  },
  {
    question: "ไม่รู้รหัสอะไหล่ต้องเตรียมข้อมูลอะไรให้ร้าน",
    expectedSourceRefs: articleRefs("what-information-to-send-before-ordering"),
  },
  {
    question: "ค้นหาสินค้าในเว็บศรีวรรณให้เร็วควรพิมพ์อะไร",
    expectedSourceRefs: articleRefs("how-to-search-sriwanparts-faster"),
  },
  {
    question: "วิธีค้นหาอะไหล่จากชื่อรถและรหัสสินค้าในเว็บไซต์",
    expectedSourceRefs: articleRefs("how-to-search-sriwanparts-faster"),
  },
  {
    question: "คอมแอร์ต้องตรวจปลั๊ก พูลเลย์ และขายึดอะไรบ้าง",
    expectedSourceRefs: articleRefs(
      "how-to-check-compressor-plug-pulley-and-mounting-points",
    ),
  },
  {
    question: "ควรถ่ายรูปอะไหล่เก่าเทียบกับของใหม่จากมุมไหน",
    expectedSourceRefs: articleRefs("how-to-compare-old-part-before-chatting-with-the-shop"),
  },
  {
    question: "อะไหล่แอร์เบอร์เดียวกันอาจใช้ข้ามรุ่นรถได้เพราะอะไร",
    expectedSourceRefs: articleRefs("can-one-ac-part-fit-multiple-car-models"),
  },
  {
    question: "หลักการเลือกคอมแอร์ให้ถูกต้องต้องตรวจอะไร",
    expectedSourceRefs: articleRefs("how-to-choose-the-right-ac-compressor"),
  },
];

export const knowledgeAdminOnlyGoldenCases: KnowledgeAdminOnlyGoldenCase[] = [
  { question: "สินค้ารับประกันกี่วัน", expectedTopic: "warranty_return" },
  { question: "ประกันคอมแอร์กี่เดือน", expectedTopic: "warranty_return" },
  { question: "มีวารันตีไหม", expectedTopic: "warranty_return" },
  { question: "warranty ยังเหลือไหม", expectedTopic: "warranty_return" },
  { question: "ขอเคลมสินค้า", expectedTopic: "warranty_return" },
  { question: "claim ต้องใช้อะไรบ้าง", expectedTopic: "warranty_return" },
  { question: "คืนสินค้าได้ภายในกี่วัน", expectedTopic: "warranty_return" },
  { question: "อยากคืนของ", expectedTopic: "warranty_return" },
  { question: "ขอคืนเงินได้ไหม", expectedTopic: "warranty_return" },
  { question: "เปลี่ยนสินค้าได้หรือเปล่า", expectedTopic: "warranty_return" },
  { question: "นโยบาย return เป็นอย่างไร", expectedTopic: "warranty_return" },
  { question: "อนุมัติเคลมหรือยัง", expectedTopic: "warranty_return" },
  { question: "ค่าจัดส่งเท่าไร", expectedTopic: "shipping" },
  { question: "ค่าส่งไปเชียงใหม่เท่าไหร่", expectedTopic: "shipping" },
  { question: "ส่งต่างจังหวัดไหม", expectedTopic: "shipping" },
  { question: "ส่งทั่วประเทศหรือเปล่า", expectedTopic: "shipping" },
  { question: "มีบริการจัดส่งไหม", expectedTopic: "shipping" },
  { question: "จัดส่งกี่วันถึง", expectedTopic: "shipping" },
  { question: "ใช้ขนส่งอะไร", expectedTopic: "shipping" },
  { question: "ส่งของนานไหม", expectedTopic: "shipping" },
  { question: "ระยะเวลาส่งกี่วัน", expectedTopic: "shipping" },
  { question: "delivery ใช้เวลากี่วัน", expectedTopic: "shipping" },
  { question: "shipping fee เท่าไร", expectedTopic: "shipping" },
  { question: "สินค้าเสียหายจากขนส่งทำอย่างไร", expectedTopic: "shipping" },
];
