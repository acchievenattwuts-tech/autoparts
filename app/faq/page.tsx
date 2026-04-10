export const revalidate = 3600;

import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, MessagesSquare, Phone, Search } from "lucide-react";
import StorefrontNavbar from "@/components/shared/StorefrontNavbar";
import Footer from "@/components/shared/Footer";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import FaqJsonLd from "@/components/seo/FaqJsonLd";
import { LOCAL_SEO_KEYWORDS, absoluteUrl } from "@/lib/seo";
import { getSiteConfig } from "@/lib/site-config";
import { storefrontFaqItems } from "@/lib/storefront-content";

export async function generateMetadata(): Promise<Metadata> {
  const config = await getSiteConfig();
  const title = `คำถามที่พบบ่อย | ${config.shopName}`;
  const description =
    "รวมคำถามที่ลูกค้ามักสงสัยเกี่ยวกับร้านอะไหล่แอร์รถยนต์ในนครสวรรค์ วิธีสั่งซื้อ การเช็กสต็อก การจัดส่ง ความน่าเชื่อถือของร้าน และการติดต่อร้าน";

  return {
    title,
    description,
    keywords: LOCAL_SEO_KEYWORDS,
    alternates: {
      canonical: absoluteUrl("/faq"),
    },
    openGraph: {
      url: absoluteUrl("/faq"),
      title,
      description,
      images: [{ url: absoluteUrl("/faq/opengraph-image") }],
    },
    twitter: {
      title,
      description,
      images: [absoluteUrl("/faq/opengraph-image")],
    },
  };
}

const FaqPage = async () => {
  const config = await getSiteConfig();

  const quickGuides = [
    {
      title: "อยากหาอะไหล่ให้เจอเร็ว",
      description:
        "เริ่มจากหน้าสินค้าแล้วค้นหาด้วยชื่อสินค้า รหัสอะไหล่ ยี่ห้อรถ หรือรุ่นรถ",
      href: "/products",
      icon: Search,
    },
    {
      title: "อยากให้ร้านช่วยเช็กให้",
      description:
        "ส่งรายละเอียดรุ่นรถหรือรูปอะไหล่เดิมเข้ามาทาง LINE OA เพื่อให้ร้านช่วยดูต่อได้เร็วขึ้น",
      href: config.shopLineUrl,
      icon: MessagesSquare,
      external: true,
    },
    {
      title: "อยากคุยกับร้านโดยตรง",
      description:
        "กรณีต้องการเช็กสต็อกหรือคุยเรื่องสั่งซื้อแบบเร่งด่วน สามารถโทรเข้าร้านได้ทันที",
      href: config.shopPhone ? `tel:${config.shopPhone}` : config.shopLineUrl,
      icon: Phone,
      external: Boolean(config.shopPhone),
    },
  ];

  return (
    <>
      <StorefrontNavbar
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        lineUrl={config.shopLineUrl}
        shopPhone={config.shopPhone}
      />
      <main className="min-h-screen bg-slate-50 pt-16">
        <section className="relative overflow-hidden bg-[#10213d]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.16),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_25%)]" />
          <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
            <div className="max-w-3xl">
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-[#f97316]">
                คำถามที่พบบ่อย
              </p>
              <h1 className="font-kanit text-4xl font-bold leading-tight text-white sm:text-5xl">
                คำถามที่ลูกค้ามักสงสัยก่อนติดต่อร้าน
              </h1>
              <p className="mt-5 text-base leading-8 text-white/78 sm:text-lg">
                หน้านี้รวบรวมคำถามที่เกี่ยวกับการค้นหาสินค้า วิธีสั่งซื้อ ความน่าเชื่อถือของร้าน
                การเช็กสต็อก และการติดต่อร้าน เพื่อช่วยให้ลูกค้าที่กำลังหาอะไหล่แอร์รถยนต์ในนครสวรรค์หรือจังหวัดอื่น ๆ เข้าใจวิธีใช้งานเว็บไซต์นี้ได้เร็วขึ้น
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
          <div className="grid gap-4 lg:grid-cols-3">
            {quickGuides.map(({ title, description, href, icon: Icon, external }) => {
              const content = (
                <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                  <div className="inline-flex rounded-2xl bg-[#f97316]/10 p-3 text-[#f97316]">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h2 className="mt-5 font-kanit text-2xl font-semibold text-[#10213d]">{title}</h2>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{description}</p>
                  <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#10213d]">
                    ไปต่อ
                    <ChevronRight className="h-4 w-4" />
                  </div>
                </div>
              );

              if (external) {
                return (
                  <a
                    key={title}
                    href={href}
                    target={href.startsWith("http") ? "_blank" : undefined}
                    rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
                  >
                    {content}
                  </a>
                );
              }

              return (
                <Link key={title} href={href}>
                  {content}
                </Link>
              );
            })}
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 pb-12 sm:px-6 lg:px-8 lg:pb-16">
          <div className="space-y-4">
            {storefrontFaqItems.map((item, index) => (
              <details
                key={item.question}
                className="group rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm"
                open={index === 0}
              >
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#f97316]">
                      FAQ {String(index + 1).padStart(2, "0")}
                    </p>
                    <h2 className="mt-2 font-kanit text-2xl font-semibold leading-tight text-[#10213d]">
                      {item.question}
                    </h2>
                  </div>
                  <span className="mt-1 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-[#10213d] transition group-open:rotate-90">
                    <ChevronRight className="h-4 w-4" />
                  </span>
                </summary>
                <p className="mt-5 pr-2 text-sm leading-8 text-slate-600 sm:text-base">
                  {item.answer}
                </p>
              </details>
            ))}
          </div>

          <div className="mt-8 rounded-[28px] bg-[#10213d] p-7 text-white shadow-sm sm:p-8">
            <h2 className="font-kanit text-2xl font-semibold">ยังมีคำถามเพิ่มเติมไหม</h2>
            <p className="mt-3 text-sm leading-7 text-white/76 sm:text-base">
              ถ้ายังไม่แน่ใจว่าสินค้าชิ้นไหนเหมาะกับรถของคุณ หรืออยากยืนยันสต็อกก่อนสั่งซื้อ
              ติดต่อร้านผ่าน LINE OA หรือโทรศัพท์ได้โดยตรงเพื่อให้ช่วยเช็กให้เร็วที่สุด
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <a
                href={config.shopLineUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-full bg-[#06C755] px-5 py-3 font-semibold text-white transition hover:bg-[#05a847]"
              >
                สอบถามผ่าน LINE OA
              </a>
              <Link
                href="/products"
                className="inline-flex items-center justify-center rounded-full border border-white/15 px-5 py-3 font-semibold text-white transition hover:bg-white/5"
              >
                กลับไปค้นหาสินค้า
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer config={config} />
      <StorefrontDeferredAssets lineUrl={config.shopLineUrl} />

      <FaqJsonLd items={storefrontFaqItems} />
      <BreadcrumbJsonLd
        items={[
          { name: "หน้าแรก", item: absoluteUrl("/") },
          { name: "คำถามที่พบบ่อย", item: absoluteUrl("/faq") },
        ]}
      />
    </>
  );
};

export default FaqPage;
