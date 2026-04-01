import type { Metadata } from "next";
import Link from "next/link";
import {
  BadgeCheck,
  Boxes,
  CarFront,
  Clock3,
  MapPin,
  MessagesSquare,
  Phone,
  Search,
  ShieldCheck,
} from "lucide-react";
import Navbar from "@/components/shared/Navbar";
import Footer from "@/components/shared/Footer";
import FloatingLine from "@/components/shared/FloatingLine";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import LocalBusinessJsonLd from "@/components/seo/LocalBusinessJsonLd";
import OrganizationJsonLd from "@/components/seo/OrganizationJsonLd";
import { db } from "@/lib/db";
import { absoluteUrl } from "@/lib/seo";
import { getSiteConfig } from "@/lib/site-config";

export async function generateMetadata(): Promise<Metadata> {
  const config = await getSiteConfig();
  const title = `เกี่ยวกับร้าน ${config.shopName}`;
  const description =
    "ข้อมูลร้านศรีวรรณ อะไหล่แอร์ ช่องทางติดต่อ วิธีการให้บริการ และแนวทางที่ช่วยให้ลูกค้าค้นหาอะไหล่แอร์และหม้อน้ำรถยนต์ได้รวดเร็วขึ้น";

  return {
    title,
    description,
    alternates: {
      canonical: absoluteUrl("/about"),
    },
    openGraph: {
      url: absoluteUrl("/about"),
      title,
      description,
      images: [{ url: absoluteUrl("/about/opengraph-image") }],
    },
    twitter: {
      title,
      description,
      images: [absoluteUrl("/about/opengraph-image")],
    },
  };
}

const AboutPage = async () => {
  const [config, activeProductCount, activeCategoryCount, activeBrandCount, activeModelCount] =
    await Promise.all([
      getSiteConfig(),
      db.product.count({ where: { isActive: true } }),
      db.category.count({ where: { isActive: true } }),
      db.carBrand.count({ where: { isActive: true } }),
      db.carModel.count({ where: { isActive: true } }),
    ]);

  const stats = [
    { label: "รายการสินค้าที่เปิดใช้งาน", value: activeProductCount, icon: Boxes },
    { label: "หมวดสินค้าที่ค้นหาได้", value: activeCategoryCount, icon: BadgeCheck },
    { label: "ยี่ห้อรถที่รองรับการค้นหา", value: activeBrandCount, icon: CarFront },
    { label: "รุ่นรถในระบบค้นหา", value: activeModelCount, icon: Search },
  ];

  const highlights = [
    {
      title: "เว็บนี้ออกแบบมาเพื่อช่วยให้หาของเจอเร็ว",
      description:
        "ลูกค้าค้นหาสินค้าได้จากชื่อสินค้า รหัสอะไหล่ ยี่ห้อรถ รุ่นรถ หมวดสินค้า และคำเรียกที่ใช้กันจริงในร้าน",
      icon: Search,
    },
    {
      title: "การปิดการขายยังคุยกับร้านโดยตรง",
      description:
        "หลังจากค้นหาเจอ ลูกค้าติดต่อร้านผ่าน LINE OA หรือโทรศัพท์เพื่อเช็กความเข้ากันได้ของอะไหล่ ยืนยันสต็อก และคุยรายละเอียดการสั่งซื้อ",
      icon: MessagesSquare,
    },
    {
      title: "ข้อมูลหน้าร้านอัปเดตจากหลังบ้าน",
      description:
        "ข้อมูลชื่อร้าน โลโก้ เบอร์โทร เวลาเปิดทำการ และลิงก์ติดต่อ ถูกจัดการจากระบบหลังบ้านของร้านโดยตรงเพื่อลดข้อมูลตกหล่น",
      icon: ShieldCheck,
    },
  ];

  const trustPoints = [
    "มีข้อมูลติดต่อร้านชัดเจน ทั้งเบอร์โทร LINE OA และลิงก์แผนที่",
    "หน้าเว็บช่วยค้นหาสินค้า แต่ยังยืนยันรายละเอียดกับร้านโดยตรงก่อนสั่งซื้อจริง",
    "ข้อมูลสินค้าถูกจัดการในระบบหลังบ้านเดียวกับร้าน ช่วยให้ค้นหาและตรวจสอบได้รวดเร็วขึ้น",
    "เหมาะกับลูกค้าที่ต้องการความสะดวก รวดเร็ว และไม่ต้องเสียเวลาค้นหาอะไหล่แบบเดิม",
  ];

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
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_26%)]" />
          <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
            <div className="max-w-3xl">
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-[#f97316]">
                เกี่ยวกับร้าน
              </p>
              <h1 className="font-kanit text-4xl font-bold leading-tight text-white sm:text-5xl">
                {config.shopName}
              </h1>
              <p className="mt-5 text-base leading-8 text-white/78 sm:text-lg">
                ร้านนี้สร้างเว็บไซต์ขึ้นมาเพื่อช่วยให้ลูกค้าค้นหาอะไหล่แอร์และหม้อน้ำรถยนต์ได้เร็วขึ้น
                แล้วติดต่อร้านผ่านช่องทางที่ใช้งานสะดวกที่สุดอย่าง LINE OA หรือโทรศัพท์
                เพื่อคุยรายละเอียดก่อนสั่งซื้อจริง
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {stats.map(({ label, value, icon: Icon }) => (
              <div
                key={label}
                className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"
              >
                <div className="inline-flex rounded-2xl bg-[#f97316]/10 p-3 text-[#f97316]">
                  <Icon className="h-5 w-5" />
                </div>
                <p className="mt-5 text-3xl font-bold text-[#10213d]">{value.toLocaleString()}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 pb-10 sm:px-6 lg:px-8 lg:pb-14">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <div className="rounded-[32px] border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-[#f97316]">
                วิธีที่เว็บนี้ช่วยลูกค้า
              </p>
              <div className="mt-6 space-y-4">
                {highlights.map(({ title, description, icon: Icon }) => (
                  <div
                    key={title}
                    className="rounded-3xl border border-slate-100 bg-slate-50 p-5"
                  >
                    <div className="flex items-start gap-4">
                      <div className="inline-flex rounded-2xl bg-white p-3 text-[#10213d] shadow-sm">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div>
                        <h2 className="font-kanit text-xl font-semibold text-[#10213d]">{title}</h2>
                        <p className="mt-2 text-sm leading-7 text-slate-600 sm:text-base">
                          {description}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-[32px] bg-[#10213d] p-7 text-white shadow-sm sm:p-8">
                <h2 className="font-kanit text-2xl font-semibold">เหตุผลที่ลูกค้าไว้ใจร้าน</h2>
                <ul className="mt-5 space-y-3">
                  {trustPoints.map((point) => (
                    <li key={point} className="flex items-start gap-3 text-sm leading-7 text-white/78">
                      <ShieldCheck className="mt-1 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-[32px] border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
                <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">ติดต่อร้าน</h2>
                <div className="mt-5 space-y-4 text-sm leading-7 text-slate-600">
                  {config.shopPhone && (
                    <div className="flex items-start gap-3">
                      <Phone className="mt-1 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                      <a href={`tel:${config.shopPhone}`} className="hover:text-[#10213d]">
                        {config.shopPhone}
                      </a>
                    </div>
                  )}
                  {config.shopBusinessHours && (
                    <div className="flex items-start gap-3">
                      <Clock3 className="mt-1 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                      <span>{config.shopBusinessHours}</span>
                    </div>
                  )}
                  {config.shopAddress && (
                    <div className="flex items-start gap-3">
                      <MapPin className="mt-1 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                      <span className="whitespace-pre-line">{config.shopAddress}</span>
                    </div>
                  )}
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <a
                    href={config.shopLineUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center rounded-full bg-[#06C755] px-5 py-3 font-semibold text-white transition hover:bg-[#05a847]"
                  >
                    คุยผ่าน LINE OA
                  </a>
                  <Link
                    href="/products"
                    className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-3 font-semibold text-[#10213d] transition hover:border-[#10213d]"
                  >
                    ไปหน้าค้นหาสินค้า
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer config={config} />
      <FloatingLine lineUrl={config.shopLineUrl} />

      <OrganizationJsonLd config={config} />
      <LocalBusinessJsonLd config={config} />
      <BreadcrumbJsonLd
        items={[
          { name: "หน้าแรก", item: absoluteUrl("/") },
          { name: "เกี่ยวกับร้าน", item: absoluteUrl("/about") },
        ]}
      />
    </>
  );
};

export default AboutPage;
