import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpenText, Search, Sparkles } from "lucide-react";
import Navbar from "@/components/shared/Navbar";
import Footer from "@/components/shared/Footer";
import FloatingLine from "@/components/shared/FloatingLine";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import { LOCAL_SEO_KEYWORDS, absoluteUrl } from "@/lib/seo";
import { getSiteConfig } from "@/lib/site-config";
import { knowledgeArticles } from "@/lib/knowledge-content";

export async function generateMetadata(): Promise<Metadata> {
  const config = await getSiteConfig();
  const title = `คลังความรู้ | ${config.shopName}`;
  const description =
    "รวมบทความความรู้เกี่ยวกับอะไหล่แอร์รถยนต์ หม้อน้ำรถยนต์ วิธีเลือกซื้อ วิธีค้นหาสินค้าบนเว็บไซต์ และคำแนะนำสำหรับลูกค้าที่กำลังหาอะไหล่แอร์รถยนต์ในนครสวรรค์";

  return {
    title,
    description,
    keywords: LOCAL_SEO_KEYWORDS,
    alternates: {
      canonical: absoluteUrl("/knowledge"),
    },
    openGraph: {
      url: absoluteUrl("/knowledge"),
      title,
      description,
      images: [{ url: absoluteUrl("/knowledge/opengraph-image") }],
    },
    twitter: {
      title,
      description,
      images: [absoluteUrl("/knowledge/opengraph-image")],
    },
  };
}

const KnowledgePage = async () => {
  const config = await getSiteConfig();
  const featuredArticle = knowledgeArticles[0];
  const categories = Array.from(new Set(knowledgeArticles.map((article) => article.category)));
  const groupedArticles = categories.map((category) => ({
    category,
    articles: knowledgeArticles.filter((article) => article.category === category),
  }));
  const localArticles = knowledgeArticles.filter(
    (article) =>
      article.title.includes("นครสวรรค์") ||
      article.description.includes("นครสวรรค์") ||
      article.relatedSearches.some((term) => term.includes("นครสวรรค์")),
  );

  return (
    <>
      <Navbar
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        lineUrl={config.shopLineUrl}
        shopPhone={config.shopPhone}
      />
      <main className="min-h-screen bg-slate-50 pt-16">
        <section className="relative overflow-hidden bg-[#10213d]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.2),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_25%)]" />
          <div className="relative mx-auto grid max-w-7xl gap-8 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] lg:px-8 lg:py-20">
            <div>
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-[#f97316]">
                คลังความรู้
              </p>
              <h1 className="font-kanit text-4xl font-bold leading-tight text-white sm:text-5xl">
                เนื้อหาที่ช่วยให้ลูกค้าหาอะไหล่ได้เร็วขึ้น
              </h1>
              <p className="mt-5 max-w-3xl text-base leading-8 text-white/78 sm:text-lg">
                หน้านี้รวบรวมบทความที่ตอบคำถามจริงของลูกค้า เช่น วิธีเลือกอะไหล่แอร์
                วิธีเช็กอาการเบื้องต้น และวิธีใช้งานเว็บไซต์นี้ให้เกิดประโยชน์สูงสุดก่อนคุยกับร้าน
                โดยมีทั้งคำแนะนำทั่วไปและคำแนะนำสำหรับลูกค้าที่กำลังหาอะไหล่แอร์รถยนต์ในนครสวรรค์
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                {categories.map((category) => (
                  <span
                    key={category}
                    className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm text-white/84"
                  >
                    {category}
                  </span>
                ))}
              </div>
            </div>

            <div className="rounded-[32px] border border-white/12 bg-white/10 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
              <div className="inline-flex rounded-2xl bg-[#f97316]/15 p-3 text-[#f97316]">
                <Sparkles className="h-5 w-5" />
              </div>
              <p className="mt-5 text-sm font-semibold uppercase tracking-[0.18em] text-white/62">
                บทความแนะนำ
              </p>
              <h2 className="mt-2 font-kanit text-2xl font-semibold text-white">
                {featuredArticle.title}
              </h2>
              <p className="mt-3 text-sm leading-7 text-white/72">{featuredArticle.description}</p>
              <Link
                href={`/knowledge/${featuredArticle.slug}`}
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 font-semibold text-[#10213d] transition hover:bg-slate-100"
              >
                อ่านบทความนี้
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
          {localArticles.length > 0 && (
            <div className="mb-8 rounded-[32px] border border-[#f97316]/15 bg-white p-6 shadow-sm sm:p-8">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#f97316]">
                Local SEO Guides
              </p>
              <h2 className="mt-3 font-kanit text-3xl font-semibold text-[#10213d]">
                คู่มือสำหรับลูกค้าที่กำลังหาอะไหล่แอร์รถยนต์ในนครสวรรค์
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">
                ถ้าคุณกำลังหาอะไหล่แอร์รถยนต์ในนครสวรรค์หรือจังหวัดใกล้เคียง กลุ่มบทความนี้จะช่วยให้เตรียมข้อมูลได้ครบขึ้น
                ค้นหาได้เร็วขึ้น และคุยกับร้านต่อได้ง่ายขึ้น
              </p>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                {localArticles.map((article) => (
                  <Link
                    key={article.slug}
                    href={`/knowledge/${article.slug}`}
                    className="rounded-[24px] border border-slate-200 bg-slate-50 p-5 transition hover:border-[#f97316]/30 hover:bg-white"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#f97316]">
                      {article.category}
                    </p>
                    <h3 className="mt-3 font-kanit text-2xl font-semibold leading-tight text-[#10213d]">
                      {article.title}
                    </h3>
                    <p className="mt-3 text-sm leading-7 text-slate-600">{article.description}</p>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            {knowledgeArticles.map((article) => (
              <Link
                key={article.slug}
                href={`/knowledge/${article.slug}`}
                className="group rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="inline-flex rounded-2xl bg-[#10213d]/8 p-3 text-[#10213d]">
                  <BookOpenText className="h-5 w-5" />
                </div>
                <div className="mt-5 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#f97316]">
                  <span>{article.category}</span>
                  <span className="text-slate-300">•</span>
                  <span>{article.readingMinutes} นาที</span>
                </div>
                <h2 className="mt-3 font-kanit text-2xl font-semibold leading-tight text-[#10213d]">
                  {article.title}
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-600">{article.description}</p>
                <div className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[#10213d]">
                  อ่านต่อ
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8">
          <div className="space-y-8">
            {groupedArticles.map(({ category, articles }) => (
              <div key={category} className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#f97316]">
                      หมวดบทความ
                    </p>
                    <h2 className="mt-2 font-kanit text-3xl font-semibold text-[#10213d]">
                      {category}
                    </h2>
                  </div>
                  <p className="text-sm text-slate-500">{articles.length} บทความ</p>
                </div>

                <div className="mt-6 grid gap-4 lg:grid-cols-3">
                  {articles.map((article) => (
                    <Link
                      key={article.slug}
                      href={`/knowledge/${article.slug}`}
                      className="rounded-[24px] border border-slate-200 bg-slate-50 p-5 transition hover:border-slate-300 hover:bg-white"
                    >
                      <h3 className="font-kanit text-2xl font-semibold leading-tight text-[#10213d]">
                        {article.title}
                      </h3>
                      <p className="mt-3 text-sm leading-7 text-slate-600">{article.description}</p>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8 lg:pb-16">
          <div className="rounded-[32px] bg-white p-7 shadow-sm ring-1 ring-slate-200 sm:p-8">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div>
                <div className="inline-flex rounded-2xl bg-[#f97316]/10 p-3 text-[#f97316]">
                  <Search className="h-5 w-5" />
                </div>
                <h2 className="mt-4 font-kanit text-3xl font-semibold text-[#10213d]">
                  อยากหาอะไหล่ต่อเลย
                </h2>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600 sm:text-base">
                  หลังอ่านบทความแล้ว สามารถไปค้นหาสินค้าในหน้าสินค้าได้ต่อทันที
                  แล้วส่งลิงก์หรือชื่อสินค้าที่เจอให้ร้านช่วยตรวจสอบผ่าน LINE OA ได้เลย
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/products"
                  className="inline-flex items-center justify-center rounded-full bg-[#10213d] px-5 py-3 font-semibold text-white transition hover:bg-[#18345f]"
                >
                  ไปหน้าสินค้า
                </Link>
                <a
                  href={config.shopLineUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-full bg-[#06C755] px-5 py-3 font-semibold text-white transition hover:bg-[#05a847]"
                >
                  คุยผ่าน LINE OA
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer config={config} />
      <FloatingLine lineUrl={config.shopLineUrl} />
      <BreadcrumbJsonLd
        items={[
          { name: "หน้าแรก", item: absoluteUrl("/") },
          { name: "คลังความรู้", item: absoluteUrl("/knowledge") },
        ]}
      />
    </>
  );
};

export default KnowledgePage;
