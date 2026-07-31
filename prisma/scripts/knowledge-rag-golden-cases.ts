import type { AdminOnlyKnowledgeTopic } from "../../lib/chat-core/admin-only-knowledge";

export type KnowledgeRetrievalGoldenCase = {
  question: string;
  expectedSourceRefs: string[];
  group: "baseline" | "paraphrase";
};

export type KnowledgeAdminOnlyGoldenCase = {
  question: string;
  expectedTopic: AdminOnlyKnowledgeTopic;
};

export type KnowledgeHardNegativeGoldenCase = {
  question: string;
  expected: "HUMAN_ONLY" | "NO_RETRIEVAL";
};

const articleRefs = (slug: string) => [slug, `article:${slug}`];

export const knowledgeRetrievalGoldenCases: KnowledgeRetrievalGoldenCase[] = [
  {
    question: "เช็กรหัส OEM ก่อนสั่งซื้ออย่างไร",
    expectedSourceRefs: articleRefs("how-to-check-oem-part-number-before-ordering"),
    group: "baseline",
  },
  {
    question: "รหัสอะไหล่เดิมดูตรงไหนและควรถ่ายรูปอย่างไร",
    expectedSourceRefs: articleRefs("how-to-check-oem-part-number-before-ordering"),
    group: "baseline",
  },
  {
    question: "ก่อนสั่งอะไหล่ต้องส่งข้อมูลรถและรูปอะไรบ้าง",
    expectedSourceRefs: articleRefs("what-information-to-send-before-ordering"),
    group: "baseline",
  },
  {
    question: "ไม่รู้รหัสอะไหล่ต้องเตรียมข้อมูลอะไรให้ร้าน",
    expectedSourceRefs: articleRefs("what-information-to-send-before-ordering"),
    group: "baseline",
  },
  {
    question: "ค้นหาสินค้าในเว็บศรีวรรณให้เร็วควรพิมพ์อะไร",
    expectedSourceRefs: articleRefs("how-to-search-sriwanparts-faster"),
    group: "baseline",
  },
  {
    question: "วิธีค้นหาอะไหล่จากชื่อรถและรหัสสินค้าในเว็บไซต์",
    expectedSourceRefs: articleRefs("how-to-search-sriwanparts-faster"),
    group: "baseline",
  },
  {
    question: "คอมแอร์ต้องตรวจปลั๊ก พูลเลย์ และขายึดอะไรบ้าง",
    expectedSourceRefs: articleRefs(
      "how-to-check-compressor-plug-pulley-and-mounting-points",
    ),
    group: "baseline",
  },
  {
    question: "ควรถ่ายรูปอะไหล่เก่าเทียบกับของใหม่จากมุมไหน",
    expectedSourceRefs: articleRefs("how-to-compare-old-part-before-chatting-with-the-shop"),
    group: "baseline",
  },
  {
    question: "อะไหล่แอร์เบอร์เดียวกันอาจใช้ข้ามรุ่นรถได้เพราะอะไร",
    expectedSourceRefs: articleRefs("can-one-ac-part-fit-multiple-car-models"),
    group: "baseline",
  },
  {
    question: "หลักการเลือกคอมแอร์ให้ถูกต้องต้องตรวจอะไร",
    expectedSourceRefs: articleRefs("how-to-choose-the-right-ac-compressor"),
    group: "baseline",
  },
  {
    question: "ถ่ายรูปอะไหล่เดิมมุมไหนให้ร้านช่วยตรวจได้ง่าย",
    expectedSourceRefs: articleRefs(
      "how-to-compare-old-part-before-chatting-with-the-shop",
    ),
    group: "baseline",
  },
  {
    question: "รหัส OEM บนสติกเกอร์ช่วยค้นหาอะไหล่อย่างไร",
    expectedSourceRefs: articleRefs(
      "how-to-check-oem-part-number-before-ordering",
    ),
    group: "baseline",
  },
  {
    question: "ทำไมต้องเทียบปลั๊ก พูลเลย์ และตำแหน่งขายึด",
    expectedSourceRefs: articleRefs(
      "how-to-check-compressor-plug-pulley-and-mounting-points",
    ),
    group: "baseline",
  },
  {
    question: "ถ้าไม่มีเลขอะไหล่ ต้องส่งอะไรให้จูนช่วยดูเบื้องต้น",
    expectedSourceRefs: articleRefs("what-information-to-send-before-ordering"),
    group: "paraphrase",
  },
  {
    question: "ป้ายเบอร์บนชิ้นส่วนเดิมมีประโยชน์ตอนหาอะไหล่ยังไง",
    expectedSourceRefs: articleRefs("how-to-check-oem-part-number-before-ordering"),
    group: "paraphrase",
  },
  {
    question: "อยากหาอะไหล่ในเว็บให้เจอไว ๆ ควรเริ่มจากคำไหน",
    expectedSourceRefs: articleRefs("how-to-search-sriwanparts-faster"),
    group: "paraphrase",
  },
  {
    question: "ชิ้นเก่ากับชิ้นใหม่ควรเทียบรายละเอียดตรงไหนบ้าง",
    expectedSourceRefs: articleRefs("how-to-compare-old-part-before-chatting-with-the-shop"),
    group: "paraphrase",
  },
  {
    question: "ก่อนเลือกคอมเพรสเซอร์แอร์รถ ต้องดูจุดต่อกับฐานยึดไหม",
    expectedSourceRefs: articleRefs(
      "how-to-check-compressor-plug-pulley-and-mounting-points",
    ),
    group: "paraphrase",
  },
  {
    question: "ทำไมเลขเดียวกันถึงพบในรถมากกว่าหนึ่งรุ่น",
    expectedSourceRefs: articleRefs("can-one-ac-part-fit-multiple-car-models"),
    group: "paraphrase",
  },
  {
    question: "ข้อมูลอะไรบนตัวคอมแอร์ช่วยลดโอกาสเลือกผิด",
    expectedSourceRefs: articleRefs("how-to-choose-the-right-ac-compressor"),
    group: "paraphrase",
  },
  {
    question: "รูปอะไหล่ควรถ่ายให้เห็นสติกเกอร์กับขั้วสายหรือไม่",
    expectedSourceRefs: [
      ...articleRefs("how-to-check-oem-part-number-before-ordering"),
      ...articleRefs("how-to-compare-old-part-before-chatting-with-the-shop"),
    ],
    group: "paraphrase",
  },
];

export const knowledgeHardNegativeGoldenCases: KnowledgeHardNegativeGoldenCase[] = [
  { question: "คอมแอร์รุ่นนี้ราคาเท่าไร", expected: "HUMAN_ONLY" },
  { question: "มีของพร้อมส่งไหม", expected: "HUMAN_ONLY" },
  { question: "อะไหล่ตัวนี้ใส่รถผมได้ไหม", expected: "HUMAN_ONLY" },
  { question: "ขอใบเสนอราคาสินค้าชุดนี้", expected: "HUMAN_ONLY" },
  { question: "วันนี้ฝนจะตกหรือไม่", expected: "NO_RETRIEVAL" },
  { question: "ขอสูตรทำข้าวผัด", expected: "NO_RETRIEVAL" },
  { question: "ผลฟุตบอลเมื่อคืนเป็นอย่างไร", expected: "NO_RETRIEVAL" },
  { question: "วิธีสมัครสินเชื่อบ้าน", expected: "NO_RETRIEVAL" },
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
