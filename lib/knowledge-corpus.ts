import { createHash } from "node:crypto";
import { knowledgeArticleMap } from "@/lib/knowledge-content";
import { absoluteUrl } from "@/lib/seo";

export type KnowledgeSourceType = "FAQ" | "SHOP_POLICY" | "TECHNICAL_GUIDE";
export type KnowledgeRiskLevel = "LOW" | "MEDIUM";

export type ApprovedKnowledgeDocument = {
  id: string;
  sourceType: KnowledgeSourceType;
  sourceRef: string;
  title: string;
  sectionHeading: string;
  content: string;
  answerScope: string;
  riskLevel: KnowledgeRiskLevel;
  sourceUrls: string[];
  metadata: Record<string, string | number | boolean | null>;
};

const faqDocuments: ApprovedKnowledgeDocument[] = [
  {
    id: "faq:ordering-process",
    sourceType: "FAQ",
    sourceRef: "storefront-faq",
    title: "ขั้นตอนค้นหาและสั่งซื้อสินค้า",
    sectionHeading: "การสั่งซื้อผ่านเว็บไซต์และแชต",
    content:
      "เว็บไซต์ใช้ช่วยค้นหาอะไหล่ก่อนสั่งซื้อ เมื่อลูกค้าพบรายการที่สนใจ ให้ส่งชื่อสินค้า รหัสอะไหล่ รุ่นรถ ปีรถ เครื่องยนต์ หรือรูปอะไหล่เดิมในแชต เพื่อให้ร้านตรวจสต็อกและความเข้ากันได้ก่อนยืนยันการสั่งซื้อ การยืนยันออเดอร์ ราคา สต็อก และการชำระเงินต้องให้แอดมินดำเนินการ",
    answerScope: "ตอบขั้นตอนทั่วไปได้ แต่ห้ามยืนยันออเดอร์ ราคา สต็อก หรือการชำระเงิน",
    riskLevel: "LOW",
    sourceUrls: [absoluteUrl("/faq")],
    metadata: { topic: "ordering", approvedFrom: "storefrontFaqItems" },
  },
  {
    id: "faq:search-without-code",
    sourceType: "FAQ",
    sourceRef: "storefront-faq",
    title: "ค้นหาอะไหล่เมื่อไม่ทราบรหัส",
    sectionHeading: "ข้อมูลที่ใช้ค้นหาได้",
    content:
      "ลูกค้าค้นหาจากชื่อสินค้า คำเรียกทั่วไป รหัสอะไหล่ ยี่ห้อรถ รุ่นรถ หมวดสินค้า และคำใกล้เคียงได้ ถ้ายังไม่แน่ใจ ให้ส่งข้อมูลรถและรูปอะไหล่เดิมในแชตเพื่อให้ร้านช่วยตรวจสอบ ห้ามยืนยันความตรงรุ่นจากชื่อรถเพียงอย่างเดียว",
    answerScope: "ตอบวิธีค้นหาและข้อมูลที่ควรส่งได้ แต่ห้ามยืนยันความตรงรุ่น",
    riskLevel: "LOW",
    sourceUrls: [absoluteUrl("/faq")],
    metadata: { topic: "search", approvedFrom: "storefrontFaqItems" },
  },
  {
    id: "faq:web-data-and-stock",
    sourceType: "FAQ",
    sourceRef: "storefront-faq",
    title: "ที่มาของข้อมูลสินค้าและการยืนยันสต็อก",
    sectionHeading: "ข้อมูลบนเว็บไซต์",
    content:
      "ข้อมูลสินค้าและข้อมูลหน้าร้านบนเว็บไซต์อัปเดตจากระบบหลังบ้านของร้าน แต่สินค้าหน้าร้านอาจมีการขายหรืออัปเดตระหว่างวัน ก่อนสั่งซื้อจริงต้องให้แอดมินยืนยันสต็อกอีกครั้ง ห้ามใช้บทความหรือ RAG ยืนยันว่ามีหรือไม่มีสินค้า",
    answerScope: "อธิบายที่มาข้อมูลได้ แต่สต็อกจริงต้องส่งแอดมิน",
    riskLevel: "LOW",
    sourceUrls: [absoluteUrl("/faq")],
    metadata: { topic: "stock-policy", approvedFrom: "storefrontFaqItems" },
  },
  {
    id: "faq:no-search-result",
    sourceType: "FAQ",
    sourceRef: "storefront-faq",
    title: "ค้นหาแล้วไม่พบสินค้า",
    sectionHeading: "ความหมายของผลค้นหาว่าง",
    content:
      "การค้นหาไม่พบไม่ได้ยืนยันว่าร้านไม่มีสินค้า เพราะชื่อเรียกอาจต่างจากข้อมูลในระบบ เมื่อลูกค้าค้นหาไม่พบ ให้ส่งรุ่นรถ รหัส หรือรูปอะไหล่เดิมเพื่อให้แอดมินตรวจสอบ ห้ามแนะนำสินค้าอื่นจากบทความแทนผลค้นหาที่ว่าง",
    answerScope: "อธิบายนโยบายผลค้นหาได้ แต่การตรวจสินค้าต้องส่งแอดมิน",
    riskLevel: "LOW",
    sourceUrls: [absoluteUrl("/faq")],
    metadata: { topic: "no-result", approvedFrom: "storefrontFaqItems" },
  },
  {
    id: "faq:shipping-general",
    sourceType: "SHOP_POLICY",
    sourceRef: "storefront-faq",
    title: "การจัดส่งสินค้า",
    sectionHeading: "พื้นที่จัดส่งและหลักการคิดค่าขนส่ง",
    content:
      "ร้านมีบริการจัดส่งทั่วประเทศ ค่าขนส่งทั่วไปพิจารณาจากขนาดและน้ำหนักสินค้า ส่วนการจัดส่งภายในจังหวัดนครสวรรค์คิดตามระยะทาง ค่าจัดส่งจริง บริษัทขนส่ง วันส่ง และเวลาถึงต้องให้แอดมินประเมินจากสินค้าและปลายทาง ห้ามรับปากราคา วันส่ง หรือวันถึงแทนแอดมิน",
    answerScope: "ตอบว่าจัดส่งได้และหลักการทั่วไปได้ แต่ห้ามประเมินราคา/ETA/COD/บริษัทขนส่ง",
    riskLevel: "MEDIUM",
    sourceUrls: [absoluteUrl("/faq")],
    metadata: { topic: "shipping", approvedFrom: "storefrontFaqItems" },
  },
  {
    id: "faq:quotation-and-fitment",
    sourceType: "FAQ",
    sourceRef: "storefront-faq",
    title: "ข้อมูลสำหรับขอใบเสนอราคาและตรวจความเข้ากันได้",
    sectionHeading: "ข้อมูลที่ควรเตรียม",
    content:
      "ควรส่งรายละเอียดสินค้า รหัสอะไหล่ ยี่ห้อรถ รุ่นรถ ปีรถ เครื่องยนต์ และรูปชิ้นงานเดิม การจัดทำใบเสนอราคาและการยืนยันความเข้ากันได้เป็นงานของแอดมิน RAG มีหน้าที่บอกข้อมูลที่ควรเตรียมเท่านั้น",
    answerScope: "บอกข้อมูลที่ต้องเตรียมได้ แต่คำขอให้จัดทำใบเสนอราคาต้องส่งแอดมิน",
    riskLevel: "LOW",
    sourceUrls: [absoluteUrl("/faq")],
    metadata: { topic: "quotation-fitment", approvedFrom: "storefrontFaqItems" },
  },
  {
    id: "policy:return-window",
    sourceType: "SHOP_POLICY",
    sourceRef: "return-warranty-policy",
    title: "การคืนและเปลี่ยนสินค้า",
    sectionHeading: "ระยะเวลาและสภาพสินค้า",
    content:
      "นโยบายหน้าเว็บไซต์ระบุให้แจ้งความประสงค์คืนหรือเปลี่ยนสินค้าภายใน 7 วันนับจากวันที่ได้รับสินค้า สินค้าต้องอยู่ในสภาพสมบูรณ์ ครบกล่องและอุปกรณ์ และยังไม่ผ่านการติดตั้งหรือใช้งาน การพิจารณาเคสจริงและการอนุมัติต้องให้แอดมินตรวจสอบ",
    answerScope: "ตอบนโยบายทั่วไปได้ แต่ห้ามอนุมัติการคืนหรือเคลม",
    riskLevel: "MEDIUM",
    sourceUrls: [absoluteUrl("/return-warranty-policy")],
    metadata: { topic: "return-policy", approvedFrom: "public-shop-policy" },
  },
  {
    id: "policy:shipping-damage",
    sourceType: "SHOP_POLICY",
    sourceRef: "return-warranty-policy",
    title: "สินค้าเสียหายจากการขนส่ง",
    sectionHeading: "หลักฐานที่ควรเตรียม",
    content:
      "เมื่อลูกค้าได้รับสินค้าที่อาจเสียหายจากการขนส่ง ควรเก็บกล่องและอุปกรณ์ทั้งหมด และเตรียมคลิปวิดีโอขณะแกะกล่องแบบต่อเนื่องตั้งแต่กล่องยังปิดจนเห็นสินค้า พร้อมรูปหรือคลิปอาการ การรับเรื่องและผลพิจารณาต้องส่งให้แอดมิน",
    answerScope: "บอกหลักฐานที่ควรเตรียมได้ แต่ห้ามรับรองว่าจะอนุมัติเคลม",
    riskLevel: "MEDIUM",
    sourceUrls: [absoluteUrl("/return-warranty-policy")],
    metadata: { topic: "shipping-damage", approvedFrom: "public-shop-policy" },
  },
  {
    id: "policy:claim-process",
    sourceType: "SHOP_POLICY",
    sourceRef: "return-warranty-policy",
    title: "ขั้นตอนแจ้งเคลม",
    sectionHeading: "ข้อมูลและหลักฐานสำหรับแอดมิน",
    content:
      "ขั้นตอนทั่วไปคือแจ้งเลขที่ใบเสร็จหรือเลขออเดอร์ ส่งรูปหรือคลิปพร้อมอธิบายอาการ และรอเจ้าหน้าที่ประเมินตามนโยบายหน้าเว็บไซต์ การแจ้งเคลมที่กำลังเกิดขึ้นต้องส่งต่อแอดมินเสมอ ห้าม RAG ตัดสินผลเคลมหรือระบุว่าสินค้าผ่านเงื่อนไข",
    answerScope: "บอกข้อมูลที่ต้องเตรียมได้ แต่ active claim ต้องส่งแอดมิน",
    riskLevel: "MEDIUM",
    sourceUrls: [absoluteUrl("/return-warranty-policy")],
    metadata: { topic: "claim-process", approvedFrom: "public-shop-policy" },
  },
];

/**
 * Conservative first release. Technical diagnosis, refrigerants, authenticity,
 * vehicle-specific guides, compressor replacement, pricing and warranty claims
 * are deliberately excluded until their claim-level sources are reviewed.
 */
export const APPROVED_KNOWLEDGE_ARTICLE_SLUGS = [
  "how-to-choose-the-right-ac-compressor",
  "what-information-to-send-before-ordering",
  "how-to-search-sriwanparts-faster",
  "auto-ac-parts-nakhon-sawan-how-to-order",
  "how-to-check-oem-part-number-before-ordering",
  "can-one-ac-part-fit-multiple-car-models",
  "how-to-compare-old-part-before-chatting-with-the-shop",
  "how-to-check-compressor-plug-pulley-and-mounting-points",
] as const;

function articleDocuments(): ApprovedKnowledgeDocument[] {
  const documents: ApprovedKnowledgeDocument[] = [];

  for (const slug of APPROVED_KNOWLEDGE_ARTICLE_SLUGS) {
    const article = knowledgeArticleMap.get(slug);
    if (!article) {
      throw new Error(`APPROVED_KNOWLEDGE_ARTICLE_MISSING:${slug}`);
    }

    documents.push({
      id: `article:${slug}:overview`,
      sourceType: "TECHNICAL_GUIDE",
      sourceRef: slug,
      title: article.title,
      sectionHeading: "สรุป",
      content: [article.intro, ...article.keyTakeaways].join("\n"),
      answerScope:
        "ใช้เพื่อช่วยลูกค้าเตรียมข้อมูลและคัดกรองเบื้องต้นเท่านั้น ห้ามยืนยัน fitment สต็อก ราคา หรือผลวินิจฉัย",
      riskLevel: "LOW",
      sourceUrls: [absoluteUrl(`/knowledge/${slug}`)],
      metadata: {
        topic: article.category,
        articleSlug: slug,
        publishedAt: article.publishedAt,
        updatedAt: article.updatedAt,
      },
    });

    article.sections.forEach((section, index) => {
      documents.push({
        id: `article:${slug}:section:${index + 1}`,
        sourceType: "TECHNICAL_GUIDE",
        sourceRef: slug,
        title: article.title,
        sectionHeading: section.heading,
        content: section.body.join("\n"),
        answerScope:
          "ใช้เพื่อช่วยลูกค้าเตรียมข้อมูลและคัดกรองเบื้องต้นเท่านั้น ห้ามยืนยัน fitment สต็อก ราคา หรือผลวินิจฉัย",
        riskLevel: "LOW",
        sourceUrls: [absoluteUrl(`/knowledge/${slug}`)],
        metadata: {
          topic: article.category,
          articleSlug: slug,
          sectionOrder: index + 1,
          updatedAt: article.updatedAt,
        },
      });
    });
  }

  return documents;
}

export function getApprovedKnowledgeDocuments(): ApprovedKnowledgeDocument[] {
  return [...faqDocuments, ...articleDocuments()];
}

export function buildKnowledgeDocumentText(document: ApprovedKnowledgeDocument): string {
  return [
    `title: ${document.title}`,
    `section: ${document.sectionHeading}`,
    `text: ${document.content}`,
    `answer scope: ${document.answerScope}`,
  ].join(" | ");
}

export function buildKnowledgeSourceHash(document: ApprovedKnowledgeDocument): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        sourceType: document.sourceType,
        sourceRef: document.sourceRef,
        title: document.title,
        sectionHeading: document.sectionHeading,
        content: document.content,
        answerScope: document.answerScope,
        riskLevel: document.riskLevel,
        sourceUrls: document.sourceUrls,
        metadata: document.metadata,
      }),
      "utf8",
    )
    .digest("hex");
}
