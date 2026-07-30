export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ExternalLink, MapPin, MessagesSquare, Phone, ShieldCheck } from "lucide-react";
import StorefrontNavbar from "@/components/shared/StorefrontNavbar";
import Footer from "@/components/shared/Footer";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import { LOCAL_SEO_KEYWORDS, absoluteUrl } from "@/lib/seo";
import { getPublicSiteConfig } from "@/lib/site-config";
import { STOREFRONT_LINE_PRIMARY_BUTTON_CLASS } from "@/lib/storefront-line-theme";
import { getPublicPolicyEntry } from "@/lib/knowledge-public";
import { getLegacyPolicySeedEntry } from "@/lib/knowledge-cms-seed";
import type { KnowledgeSection } from "@/lib/knowledge-cms-types";

const SHOP_PHONE = "065-751-7873";
const SHOP_LINE_ID = "@sriwanparts";
const SHOP_ADDRESS = "118/7 หมู่ 12 ต.บางม่วง อ.เมือง จ.นครสวรรค์ 60000";
const SHOP_MAP_URL = "https://maps.app.goo.gl/3ZaXDsG7uWLKvTSE8";

async function getPolicy() {
  const active = await getPublicPolicyEntry();
  if (active) return active;
  const fallback = getLegacyPolicySeedEntry();
  return {
    title: fallback.title,
    description: fallback.description,
    category: fallback.category,
    content: fallback.content,
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const [config, policy] = await Promise.all([getPublicSiteConfig(), getPolicy()]);
  const title = `${policy.title} | ${config.shopName}`;
  const description = policy.description ?? policy.content.intro;
  return {
    title,
    description,
    keywords: LOCAL_SEO_KEYWORDS,
    alternates: { canonical: absoluteUrl("/return-warranty-policy") },
    openGraph: { url: absoluteUrl("/return-warranty-policy"), title, description },
    twitter: { title, description },
  };
}

function PolicySection({ section, index }: { section: KnowledgeSection; index: number }) {
  return (
    <section className="rounded-[32px] border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
      <div className="flex items-start gap-4">
        <div className="inline-flex rounded-2xl bg-[#f97316]/10 p-3 text-[#f97316]">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">{index + 1}. {section.heading}</h2>
          {section.format === "TABLE" ? (
            <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-[#10213d]"><tr><th className="px-4 py-3">รายการ</th><th className="px-4 py-3">รายละเอียด</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {section.body.map((line) => {
                    const [name, ...details] = line.split("|");
                    return <tr key={line}><td className="px-4 py-3 text-slate-700">{name.trim()}</td><td className="px-4 py-3 font-medium text-[#10213d]">{details.join("|").trim() || "-"}</td></tr>;
                  })}
                </tbody>
              </table>
            </div>
          ) : section.format === "PARAGRAPHS" ? (
            <div className="mt-4 space-y-3">{section.body.map((line) => <p key={line} className="text-sm leading-7 text-slate-600 sm:text-base">{line}</p>)}</div>
          ) : (
            <ol className="mt-4 space-y-3">
              {section.body.map((line, itemIndex) => (
                <li key={line} className="flex items-start gap-3 text-sm leading-7 text-slate-600">
                  {section.format === "STEPS" ? (
                    <span className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#f97316] text-xs font-bold text-white">{itemIndex + 1}</span>
                  ) : <CheckCircle2 className="mt-1 h-4 w-4 flex-shrink-0 text-[#f97316]" />}
                  <span>{line}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

export default async function ReturnWarrantyPolicyPage() {
  const [config, policy] = await Promise.all([getPublicSiteConfig(), getPolicy()]);
  return (
    <>
      <StorefrontNavbar shopName={config.shopName} shopSlogan={config.shopSlogan} shopLogoUrl={config.shopLogoUrl} lineUrl={config.shopLineUrl} shopPhone={config.shopPhone} />
      <main className="min-h-screen bg-slate-50 pt-16">
        <section className="relative overflow-hidden bg-[#10213d]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_26%)]" />
          <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
            <div className="max-w-3xl">
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-[#f97316]">{policy.category ?? "นโยบายร้าน"}</p>
              <h1 className="font-kanit text-4xl font-bold leading-tight text-white sm:text-5xl">{policy.title}</h1>
              <p className="mt-5 text-base leading-8 text-white/78 sm:text-lg">{policy.content.intro}</p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
          {policy.content.highlights.length > 0 && (
            <div className="mb-6 rounded-[28px] border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-start gap-3"><AlertTriangle className="mt-1 h-5 w-5 text-amber-600" /><div><h2 className="font-kanit text-lg font-semibold text-amber-900">เรื่องสำคัญที่ควรทราบ</h2><ul className="mt-2 space-y-1 text-sm leading-7 text-amber-800">{policy.content.highlights.map((item) => <li key={item}>• {item}</li>)}</ul></div></div>
            </div>
          )}
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <div className="space-y-6">{policy.content.sections.map((section, index) => <PolicySection key={`${section.heading}-${index}`} section={section} index={index} />)}</div>
            <aside className="space-y-6">
              <div className="rounded-[32px] border border-slate-200 bg-white p-7 shadow-sm lg:sticky lg:top-24">
                <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">ช่องทางติดต่อ / แจ้งเคลม</h2>
                <div className="mt-5 space-y-4 text-sm leading-7 text-slate-600">
                  <div className="flex gap-3"><Phone className="mt-1 h-4 w-4 text-[#f97316]" /><a href={`tel:${SHOP_PHONE.replace(/-/g, "")}`}>{SHOP_PHONE}</a></div>
                  <div className="flex gap-3"><MessagesSquare className="mt-1 h-4 w-4 text-[#f97316]" /><span>LINE: {SHOP_LINE_ID}</span></div>
                  <div className="flex gap-3"><MapPin className="mt-1 h-4 w-4 text-[#f97316]" /><span>{SHOP_ADDRESS}</span></div>
                </div>
                <div className="mt-6 flex flex-col gap-3">
                  <a href={config.shopLineUrl} target="_blank" rel="noopener noreferrer" className={STOREFRONT_LINE_PRIMARY_BUTTON_CLASS}>คุยผ่าน LINE OA</a>
                  <a href={SHOP_MAP_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 px-5 py-3 font-semibold text-[#10213d]">เปิด Google Maps <ExternalLink className="h-4 w-4" /></a>
                  <Link href="/products" className="inline-flex items-center justify-center rounded-full border border-slate-200 px-5 py-3 font-semibold text-[#10213d]">ไปหน้าค้นหาสินค้า</Link>
                </div>
              </div>
            </aside>
          </div>
        </section>
      </main>
      <Footer config={config} />
      <StorefrontDeferredAssets lineUrl={config.shopLineUrl} />
      <BreadcrumbJsonLd items={[{ name: "หน้าแรก", item: absoluteUrl("/") }, { name: policy.title, item: absoluteUrl("/return-warranty-policy") }]} />
    </>
  );
}
