import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, BookOpenText, Clock3, Search } from "lucide-react";
import Navbar from "@/components/shared/Navbar";
import Footer from "@/components/shared/Footer";
import DeferredFloatingLine from "@/components/shared/DeferredFloatingLine";
import ArticleJsonLd from "@/components/seo/ArticleJsonLd";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import { LOCAL_SEO_KEYWORDS, absoluteUrl } from "@/lib/seo";
import { getSiteConfig } from "@/lib/site-config";
import { knowledgeArticleMap, knowledgeArticles } from "@/lib/knowledge-content";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return knowledgeArticles.map((article) => ({
    slug: article.slug,
  }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, config] = await Promise.all([params, getSiteConfig()]);
  const article = knowledgeArticleMap.get(slug);

  if (!article) {
    return {};
  }

  return {
    title: article.title,
    description: article.description,
    keywords: Array.from(new Set([article.title, ...article.relatedSearches, ...LOCAL_SEO_KEYWORDS])),
    alternates: {
      canonical: absoluteUrl(`/knowledge/${article.slug}`),
    },
    openGraph: {
      url: absoluteUrl(`/knowledge/${article.slug}`),
      title: article.title,
      description: article.description,
      images: [{ url: absoluteUrl(`/knowledge/${article.slug}/opengraph-image`) }],
    },
    twitter: {
      title: article.title,
      description: article.description,
      images: [absoluteUrl(`/knowledge/${article.slug}/opengraph-image`)],
    },
  };
}

const KnowledgeArticlePage = async ({ params }: Props) => {
  const [{ slug }, config] = await Promise.all([params, getSiteConfig()]);
  const article = knowledgeArticleMap.get(slug);

  if (!article) {
    notFound();
  }

  const relatedArticles = knowledgeArticles
    .filter((entry) => entry.slug !== article.slug)
    .sort((a, b) => {
      const scoreA = a.category === article.category ? 1 : 0;
      const scoreB = b.category === article.category ? 1 : 0;
      return scoreB - scoreA;
    })
    .slice(0, 3);

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
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-4xl px-4 py-5 sm:px-6 lg:px-8">
            <Link
              href="/knowledge"
              className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-[#10213d]"
            >
              <ArrowLeft className="h-4 w-4" />
              กลับไปคลังความรู้
            </Link>
          </div>
        </section>

        <article className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          <div className="rounded-[36px] border border-slate-200 bg-white p-7 shadow-sm sm:p-10">
            <div className="inline-flex rounded-full bg-[#f97316]/10 px-4 py-2 text-sm font-semibold text-[#f97316]">
              {article.category}
            </div>
            <h1 className="mt-5 font-kanit text-4xl font-bold leading-tight text-[#10213d] sm:text-5xl">
              {article.title}
            </h1>
            <div className="mt-5 flex flex-wrap items-center gap-4 text-sm text-slate-500">
              <span className="inline-flex items-center gap-2">
                <Clock3 className="h-4 w-4" />
                {article.readingMinutes} นาที
              </span>
              <span>อัปเดต {article.updatedAt}</span>
            </div>

            <p className="mt-8 text-base leading-8 text-slate-700 sm:text-lg">{article.intro}</p>

            <div className="mt-8 rounded-[28px] bg-slate-50 p-6">
              <div className="inline-flex rounded-2xl bg-[#10213d]/8 p-3 text-[#10213d]">
                <BookOpenText className="h-5 w-5" />
              </div>
              <h2 className="mt-4 font-kanit text-2xl font-semibold text-[#10213d]">
                ประเด็นสำคัญ
              </h2>
              <ul className="mt-4 space-y-3">
                {article.keyTakeaways.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm leading-7 text-slate-600 sm:text-base">
                    <span className="mt-2 h-2 w-2 flex-shrink-0 rounded-full bg-[#f97316]" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-10 space-y-9">
              {article.sections.map((section) => (
                <section key={section.heading}>
                  <h2 className="font-kanit text-3xl font-semibold text-[#10213d]">
                    {section.heading}
                  </h2>
                  <div className="mt-4 space-y-4">
                    {section.body.map((paragraph) => (
                      <p key={paragraph} className="text-sm leading-8 text-slate-700 sm:text-base">
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <div className="mt-10 rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="inline-flex rounded-2xl bg-[#f97316]/10 p-3 text-[#f97316]">
                <Search className="h-5 w-5" />
              </div>
              <h2 className="mt-4 font-kanit text-2xl font-semibold text-[#10213d]">
                คำค้นที่เกี่ยวข้อง
              </h2>
              <div className="mt-4 flex flex-wrap gap-2">
                {article.relatedSearches.map((term) => (
                  <Link
                    key={term}
                    href={`/products?q=${encodeURIComponent(term)}`}
                    className="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-600 transition hover:border-[#10213d] hover:text-[#10213d]"
                  >
                    {term}
                  </Link>
                ))}
              </div>
            </div>

            <div className="mt-10 rounded-[32px] bg-[#10213d] p-7 text-white sm:p-8">
              <h2 className="font-kanit text-3xl font-semibold">อยากให้ร้านช่วยเช็กต่อ</h2>
              <p className="mt-3 text-sm leading-7 text-white/76 sm:text-base">
                ถ้าคุณอ่านบทความนี้แล้วพอรู้ทิศทางของปัญหาหรือเริ่มเจอสินค้าที่ใกล้เคียง
                สามารถไปค้นหาต่อในหน้าสินค้า แล้วส่งข้อมูลรุ่นรถหรือรหัสสินค้าให้ร้านตรวจสอบผ่าน LINE OA ได้ทันที
              </p>
              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/products"
                  className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 font-semibold text-[#10213d] transition hover:bg-slate-100"
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
        </article>

        <section className="mx-auto max-w-7xl px-4 pb-12 sm:px-6 lg:px-8 lg:pb-16">
          <div className="rounded-[32px] border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
            <h2 className="font-kanit text-3xl font-semibold text-[#10213d]">อ่านต่อ</h2>
            <div className="mt-6 grid gap-4 lg:grid-cols-3">
              {relatedArticles.map((entry) => (
                <Link
                  key={entry.slug}
                  href={`/knowledge/${entry.slug}`}
                  className="group rounded-[24px] border border-slate-200 bg-slate-50 p-5 transition hover:border-slate-300 hover:bg-white"
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#f97316]">
                    {entry.category}
                  </p>
                  <h3 className="mt-3 font-kanit text-2xl font-semibold leading-tight text-[#10213d]">
                    {entry.title}
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{entry.description}</p>
                  <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[#10213d]">
                    อ่านบทความ
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer config={config} />
      <DeferredFloatingLine lineUrl={config.shopLineUrl} />
      <BreadcrumbJsonLd
        items={[
          { name: "หน้าแรก", item: absoluteUrl("/") },
          { name: "คลังความรู้", item: absoluteUrl("/knowledge") },
          { name: article.title, item: absoluteUrl(`/knowledge/${article.slug}`) },
        ]}
      />
      <ArticleJsonLd
        title={article.title}
        description={article.description}
        url={absoluteUrl(`/knowledge/${article.slug}`)}
        datePublished={article.publishedAt}
        dateModified={article.updatedAt}
        imageUrl={config.shopLogoUrl}
        publisherName={config.shopName}
        publisherLogoUrl={config.shopLogoUrl}
      />
    </>
  );
};

export default KnowledgeArticlePage;
