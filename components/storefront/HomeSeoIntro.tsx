import { Fragment } from "react";
import Link from "next/link";
import { getCategoryPath } from "@/lib/product-slug";

/**
 * Long-form intro block at the foot of the homepage — the same shape shopee.co.th
 * uses below its product grid: a full-bleed white band holding two headings and
 * a few paragraphs of plain body copy with inline internal links.
 *
 * Its job is the text signal the rest of this page cannot give: the grid above is
 * almost entirely product names and prices, so crawlers and answer engines have
 * nothing describing what the shop actually is or how buying works.
 *
 * Every claim here is drawn from what the page already knows — the catalogue
 * counts are the same figures the hero renders, and the service statements match
 * the trust row and /about. No promotion, free-shipping or money-back language:
 * the shop runs none of those.
 *
 * Server-rendered on purpose (no "use client"): it ships zero JavaScript and the
 * copy has to be in the HTML to count for SEO at all.
 */

/** Blue, not the storefront's orange — orange stays reserved for prices. */
const INLINE_LINK_CLASS =
  "font-medium text-[#1e3a5f] underline decoration-[#9db8dd] underline-offset-2 transition-colors hover:text-[#2563eb] hover:decoration-[#2563eb]";

/** Only what a link needs — the same rows the category strip already renders. */
interface CategoryLink {
  id: string;
  name: string;
  slug: string | null;
}

interface Props {
  /** Storefront-visible products — the same total the "สินค้ามาใหม่" header shows. */
  productCount: number;
  /** Active categories, in the order the category strip lists them. */
  categories: CategoryLink[];
  /** Active car brand names, as carried by the fitment finder. */
  carBrandNames: string[];
  shopName: string;
}

/**
 * Comma-separated run of links, the way shopee.co.th lists its categories: one
 * flowing sentence rather than a chip grid, so the block stays compact and reads
 * as prose to a crawler.
 */
const LinkRun = ({ items }: { items: { key: string; label: string; href: string }[] }) => (
  <>
    {items.map((item, index) => (
      <Fragment key={item.key}>
        {index > 0 && ", "}
        <Link href={item.href} className={INLINE_LINK_CLASS}>
          {item.label}
        </Link>
      </Fragment>
    ))}
  </>
);

const HomeSeoIntro = ({ productCount, categories, carBrandNames, shopName }: Props) => {
  const formatCount = (value: number) => value.toLocaleString("th-TH");
  const categoryCount = categories.length;
  const carBrandCount = carBrandNames.length;

  const categoryLinks = categories.map((category) => ({
    key: category.id,
    label: category.name,
    href: getCategoryPath(category),
  }));

  // `carBrand` is the param /products already reads for its brand filter, so a
  // click lands on the same result set the filter drawer would produce.
  const carBrandLinks = carBrandNames.map((name) => ({
    key: name,
    label: name,
    href: `/products?carBrand=${encodeURIComponent(name)}`,
  }));

  return (
    <section className="mt-3 bg-white py-8 sm:py-10">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="font-kanit text-xl font-bold text-[#1e3a5f] sm:text-2xl">
          ซื้ออะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์ออนไลน์ ง่ายกว่าเดิมกับ {shopName}
        </h2>

        <div className="mt-4 space-y-3 text-sm leading-7 text-slate-600">
          <p>
            {shopName} เป็นร้านอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์ในจังหวัดนครสวรรค์
            ที่รวมอะไหล่ไว้ให้ค้นหาได้ในที่เดียว ตอนนี้มีสินค้าบนหน้าเว็บ{" "}
            {formatCount(productCount)} รายการ ครอบคลุม {formatCount(categoryCount)} หมวด
            ตั้งแต่คอมเพรสเซอร์แอร์ คอมแอร์ แผงคอนเดนเซอร์ คอยล์เย็น ท่อแอร์ ไปจนถึงหม้อน้ำและ
            อะไหล่ที่เกี่ยวข้อง คุณเลือกดูได้จาก{" "}
            <Link href="/products" className={INLINE_LINK_CLASS}>
              สินค้าทั้งหมด
            </Link>{" "}
            หรือค้นหาจากชื่อสินค้า รหัสอะไหล่ และรุ่นรถได้โดยตรงจากช่องค้นหาด้านบน
          </p>

          <p>
            ถ้ารู้รถของตัวเองอยู่แล้ว ใช้ตัวช่วยค้นหาตามรุ่นรถบนหน้าแรกได้เลย — เลือกยี่ห้อ รุ่น
            และปีรถ แล้วระบบจะกรองเฉพาะอะไหล่ที่ระบุว่าตรงรุ่นให้ ปัจจุบันรองรับรถ{" "}
            {formatCount(carBrandCount)} ยี่ห้อ และยังเลือกหมวดอะไหล่ซ้อนเข้าไปพร้อมกันได้
            ส่วนใครที่ยังไม่แน่ใจว่าอะไหล่ตัวเดิมคือรุ่นไหน ส่งรุ่นรถ ปีรถ รหัสอะไหล่เดิม
            หรือรูปของเก่ามาทาง LINE ให้ทางร้านช่วยเทียบก่อนสั่งซื้อจริงได้
          </p>

          <p>
            ข้อมูลสินค้าบนหน้าเว็บอัปเดตมาจากระบบหลังร้านโดยตรง ระยะเวลาประกันของแต่ละรายการ
            ระบุไว้บนหน้าสินค้านั้น ๆ และจัดส่งได้ทั่วประเทศ ไม่ว่าจะส่งถึงอู่หรือส่งถึงบ้าน
            ขั้นตอนสรุปรายการและยืนยันราคายังคุยกับทางร้านโดยตรง เพื่อให้แน่ใจว่าของที่ส่งออกไป
            ตรงกับรถของคุณจริง ๆ
          </p>
        </div>

        <h2 className="mt-8 font-kanit text-xl font-bold text-[#1e3a5f] sm:text-2xl">
          ครบทุกหมวดอะไหล่ ครอบคลุมรถทุกยี่ห้อที่ร้านมีของ
        </h2>

        <div className="mt-4 space-y-3 text-sm leading-7 text-slate-600">
          <p>
            เลือกดูตามชิ้นส่วนที่ต้องการได้เลย ทั้ง <LinkRun items={categoryLinks} />
          </p>

          <p>
            หรือเริ่มจากรถของคุณก่อน ตอนนี้มีอะไหล่ให้เลือกสำหรับ{" "}
            <LinkRun items={carBrandLinks} />
          </p>
        </div>

        <h2 className="mt-8 font-kanit text-xl font-bold text-[#1e3a5f] sm:text-2xl">
          ข้อมูลร้านและเงื่อนไขบริการ ที่ควรอ่านก่อนสั่งซื้อ
        </h2>

        <div className="mt-4 space-y-3 text-sm leading-7 text-slate-600">
          <p>
            อยากรู้ว่าร้านทำงานอย่างไรก่อนตัดสินใจสั่ง อ่านได้จาก{" "}
            <Link href="/about" className={INLINE_LINK_CLASS}>
              เกี่ยวกับร้าน
            </Link>{" "}
            ซึ่งอธิบายรูปแบบการให้บริการและช่องทางติดต่อทั้งหมด ส่วนคำถามที่ลูกค้าถามบ่อย เช่น
            การเช็กสต็อก ความตรงรุ่น และขั้นตอนสั่งซื้อ สรุปไว้แล้วที่{" "}
            <Link href="/faq" className={INLINE_LINK_CLASS}>
              คำถามที่พบบ่อย
            </Link>
          </p>

          <p>
            เงื่อนไขการคืนสินค้าและการรับประกันดูได้ที่{" "}
            <Link href="/return-warranty-policy" className={INLINE_LINK_CLASS}>
              นโยบายการคืนสินค้าและการรับประกัน
            </Link>{" "}
            และถ้าอยากเข้าใจตัวอะไหล่มากขึ้นก่อนเลือกซื้อ — อาการเสียแบบไหนเกิดจากชิ้นส่วนใด
            หรือแต่ละชิ้นทำหน้าที่อะไรในระบบแอร์รถยนต์ — อ่านบทความได้จาก{" "}
            <Link href="/knowledge" className={INLINE_LINK_CLASS}>
              คลังความรู้
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
};

export default HomeSeoIntro;
