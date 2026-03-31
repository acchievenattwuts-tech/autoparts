export const dynamic = "force-dynamic";

import Link from "next/link";
import {
  BadgeDollarSign,
  ArrowRight,
  Award,
  Clock3,
  MessageCircle,
  PackageCheck,
  PackageSearch,
  Phone,
  ShieldCheck,
  Sparkles,
  Truck,
} from "lucide-react";
import Navbar from "@/components/shared/Navbar";
import Footer from "@/components/shared/Footer";
import FloatingLine from "@/components/shared/FloatingLine";
import ProductCard from "@/components/shared/ProductCard";
import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";

const Home2Page = async () => {
  const config = await getSiteConfig();

  const [categories, brands, featuredProducts, productCount] = await Promise.all([
    db.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      take: 8,
      select: { id: true, name: true, _count: { select: { products: true } } },
    }),
    db.carBrand.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      take: 6,
      select: { id: true, name: true, _count: { select: { carModels: true } } },
    }),
    db.product.findMany({
      where: { isActive: true, stock: { gt: 0 } },
      orderBy: [{ stock: "desc" }, { createdAt: "desc" }],
      take: 6,
      select: {
        id: true,
        name: true,
        code: true,
        imageUrl: true,
        salePrice: true,
        stock: true,
        reportUnitName: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
        carModels: {
          select: {
            carModel: {
              select: {
                name: true,
                carBrand: { select: { name: true } },
              },
            },
          },
          take: 6,
        },
      },
    }),
    db.product.count({ where: { isActive: true } }),
  ]);

  const quickFacts = [
    {
      label: "สินค้าที่พร้อมให้ค้นหา",
      value: `${productCount.toLocaleString("th-TH")}+`,
      icon: PackageSearch,
    },
    {
      label: "สอบถามผ่าน LINE OA ได้ทันที",
      value: "เช็กราคาและสต็อกได้รวดเร็ว",
      icon: MessageCircle,
    },
    {
      label: "ติดต่อทางโทรศัพท์ได้ทันที",
      value: config.shopPhone || "มีเบอร์หน้าร้านพร้อมติดต่อ",
      icon: Phone,
    },
  ];

  const reasons = [
    {
      title: "ค้นหาอะไหล่ได้ง่าย",
      description:
        "ค้นหาได้จากชื่อสินค้า รหัสอะไหล่ ยี่ห้อรถ หรือรุ่นรถ ช่วยให้ลูกค้าเจอสินค้าที่ต้องการได้รวดเร็วขึ้น",
      icon: PackageSearch,
    },
    {
      title: "สอบถามกับร้านได้โดยตรง",
      description:
        "หากต้องการเช็กราคา เช็กสต็อก หรือสอบถามว่าอะไหล่ใช้กับรถรุ่นใดได้บ้าง ติดต่อผ่าน LINE OA หรือโทรหาเราได้ทันที",
      icon: MessageCircle,
    },
    {
      title: "ราคายุติธรรม",
      description:
        "เราคัดสรรสินค้าในราคาที่เหมาะสม เพื่อให้ลูกค้าได้อะไหล่คุณภาพดีในราคาที่คุ้มค่า",
      icon: BadgeDollarSign,
    },
    {
      title: "ส่งสินค้าทั่วประเทศ",
      description:
        "รองรับการจัดส่งทั่วประเทศ ช่วยให้ลูกค้าต่างจังหวัดสามารถสั่งซื้อและรับสินค้าได้สะดวก",
      icon: Truck,
    },
    {
      title: "บริการรวดเร็ว",
      description:
        "ทีมงานพร้อมตอบคำถามและช่วยเช็กสินค้าอย่างรวดเร็ว เพื่อให้ลูกค้าได้รับข้อมูลที่ต้องการโดยไม่ต้องรอนาน",
      icon: Clock3,
    },
    {
      title: "ประสบการณ์มากกว่า 30 ปี",
      description:
        "ด้วยประสบการณ์ในธุรกิจอะไหล่มายาวนาน เราพร้อมช่วยแนะนำสินค้าให้เหมาะกับความต้องการของลูกค้า",
      icon: Award,
    },
    {
      title: "มีสินค้าในสต๊อก พร้อมส่ง",
      description:
        "สินค้าหลายรายการมีสต๊อกพร้อมจัดส่ง ช่วยให้ลูกค้าได้รับของไวและนำไปใช้งานได้ทันเวลา",
      icon: PackageCheck,
    },
    {
      title: "ข้อมูลชัดเจน ดูน่าเชื่อถือ",
      description:
        "หน้าเว็บนี้จัดวางข้อมูลสำคัญไว้ครบ ทั้งหมวดสินค้า สินค้าแนะนำ และช่องทางติดต่อที่ใช้งานได้จริง",
      icon: ShieldCheck,
    },
  ];

  const displayPhone = config.shopPhone?.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");

  return (
    <>
      <Navbar
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        lineUrl={config.shopLineUrl}
        shopPhone={config.shopPhone}
      />

      <main className="min-h-screen overflow-hidden bg-stone-950 pt-16 text-stone-100">
        <section className="relative isolate border-b border-white/10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(249,115,22,0.22),_transparent_30%),radial-gradient(circle_at_top_right,_rgba(245,158,11,0.18),_transparent_26%),linear-gradient(180deg,_rgba(24,24,27,0.96),_rgba(9,9,11,1))]" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />
          <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.2fr_0.8fr] lg:px-8 lg:py-20">
            <div className="space-y-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-1.5 text-sm font-medium text-amber-200">
                <Sparkles className="h-4 w-4" />
                หน้าแนะนำสินค้าและช่องทางติดต่อ
              </div>

              <div className="space-y-5">
                <p className="max-w-xl text-sm uppercase tracking-[0.28em] text-stone-400">
                  AUTO PARTS / AIRCON PARTS / QUICK INQUIRY
                </p>
                <h1 className="max-w-4xl font-kanit text-4xl font-bold leading-tight text-white sm:text-5xl lg:text-6xl">
                  ค้นหาอะไหล่ที่ต้องการ
                  <br />
                  แล้วสอบถามกับร้านได้ทันที
                </h1>
                <p className="max-w-2xl text-base leading-7 text-stone-300 sm:text-lg">
                  เรารวบรวมสินค้าและหมวดหมู่ไว้ให้ค้นหาได้ง่าย ลูกค้าสามารถเริ่มจากชื่อสินค้า รหัสอะไหล่ ยี่ห้อรถ หรือรุ่นรถ และติดต่อสอบถามต่อผ่าน LINE OA หรือโทรศัพท์ได้ทันที
                </p>
              </div>

              <form
                action="/products"
                method="GET"
                className="grid gap-3 rounded-[2rem] border border-white/10 bg-white/6 p-4 shadow-2xl shadow-black/30 backdrop-blur md:grid-cols-[1fr_auto_auto]"
              >
                <label className="sr-only" htmlFor="home2-search">
                  ค้นหาสินค้า
                </label>
                <input
                  id="home2-search"
                  name="q"
                  type="text"
                  placeholder="ค้นหาชื่อสินค้า รหัสอะไหล่ ยี่ห้อรถ หรือรุ่นรถ"
                  className="h-14 rounded-2xl border border-white/10 bg-stone-900/80 px-5 text-base text-white placeholder:text-stone-500 focus:border-amber-400 focus:outline-none"
                />
                <button
                  type="submit"
                  className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-amber-500 px-5 font-semibold text-stone-950 transition hover:bg-amber-400"
                >
                  <PackageSearch className="h-4 w-4" />
                  เริ่มค้นหา
                </button>
                <a
                  href={config.shopLineUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl border border-[#06C755]/40 bg-[#06C755]/15 px-5 font-semibold text-white transition hover:bg-[#06C755]/25"
                >
                  <MessageCircle className="h-4 w-4" />
                  สอบถามผ่าน LINE OA
                </a>
              </form>

              <div className="grid gap-3 sm:grid-cols-3">
                {quickFacts.map(({ label, value, icon: Icon }) => (
                  <div
                    key={label}
                    className="rounded-[1.6rem] border border-white/10 bg-white/5 p-4 backdrop-blur"
                  >
                    <Icon className="mb-4 h-5 w-5 text-amber-300" />
                    <p className="text-2xl font-semibold text-white">{value}</p>
                    <p className="mt-1 text-sm text-stone-400">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute -left-10 top-8 hidden h-32 w-32 rounded-full bg-amber-500/15 blur-3xl lg:block" />
              <div className="rounded-[2rem] border border-white/10 bg-stone-900/80 p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] backdrop-blur">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
                      ช่องทางติดต่อหลัก
                    </p>
                    <h2 className="mt-2 font-kanit text-2xl font-semibold text-white">
                      ติดต่อเราได้ทันที
                    </h2>
                  </div>
                  <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">
                    พร้อมตอบ
                  </span>
                </div>

                <div className="mt-6 space-y-4">
                  <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5">
                    <p className="text-sm text-stone-400">LINE OA</p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {config.shopLineId || "สอบถามผ่านไลน์ร้าน"}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-stone-300">
                      เหมาะสำหรับส่งรูปสินค้า รหัสอะไหล่ หรือรายละเอียดรถ เพื่อให้ร้านช่วยเช็กสินค้าและแจ้งราคาได้สะดวกยิ่งขึ้น
                    </p>
                    <a
                      href={config.shopLineUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-amber-300 hover:text-amber-200"
                    >
                      เปิด LINE OA
                      <ArrowRight className="h-4 w-4" />
                    </a>
                  </div>

                  <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5">
                    <p className="text-sm text-stone-400">โทรศัพท์</p>
                    <p className="mt-2 text-xl font-semibold text-white">
                      {displayPhone || "มีเบอร์หน้าร้านพร้อมติดต่อ"}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-stone-300">
                      เหมาะสำหรับลูกค้าที่ต้องการคำตอบรวดเร็ว หรือต้องการสอบถามหลายรายการพร้อมกัน
                    </p>
                    {config.shopPhone && (
                      <a
                        href={`tel:${config.shopPhone}`}
                        className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-amber-300 hover:text-amber-200"
                      >
                        โทรหาเรา
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="mt-6 rounded-[1.5rem] border border-dashed border-amber-400/30 bg-amber-400/8 p-5">
                  <p className="text-xs uppercase tracking-[0.22em] text-amber-200/80">
                    ขั้นตอนแนะนำ
                  </p>
                  <ol className="mt-3 space-y-3 text-sm text-stone-200">
                    <li>1. ค้นหาชื่อสินค้า รหัสอะไหล่ ยี่ห้อรถ หรือรุ่นรถ</li>
                    <li>2. เปิดดูรายการสินค้าและเลือกสินค้าที่ใกล้เคียง</li>
                    <li>3. ติดต่อร้านผ่าน LINE OA หรือโทรศัพท์เพื่อเช็กราคาและสต็อก</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-white/10 bg-stone-900">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
                  หมวดและทางลัด
                </p>
                <h2 className="mt-3 font-kanit text-3xl font-semibold text-white">
                  เริ่มค้นหาได้จากหมวดสินค้าและยี่ห้อรถ
                </h2>
              </div>
              <Link
                href="/products"
                className="inline-flex items-center gap-2 self-start rounded-full border border-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:border-amber-400/40 hover:bg-white/5"
              >
                ดูสินค้าทั้งหมด
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-[1.25fr_0.75fr]">
              <div className="rounded-[2rem] border border-white/10 bg-stone-950/80 p-6">
                <div className="flex items-center justify-between">
                  <h3 className="font-kanit text-2xl text-white">หมวดสินค้ายอดนิยม</h3>
                  <span className="text-sm text-stone-500">อ้างอิงจากข้อมูลจริงในระบบ</span>
                </div>
                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {categories.map((category) => (
                    <Link
                      key={category.id}
                      href={`/products?category=${encodeURIComponent(category.name)}`}
                      className="group rounded-[1.5rem] border border-white/10 bg-white/[0.03] p-5 transition hover:border-amber-400/40 hover:bg-white/[0.06]"
                    >
                      <p className="text-xs uppercase tracking-[0.18em] text-stone-500">
                        หมวดสินค้า
                      </p>
                      <p className="mt-3 font-kanit text-2xl text-white">{category.name}</p>
                      <div className="mt-6 flex items-center justify-between text-sm">
                        <span className="text-stone-400">
                          {category._count.products.toLocaleString("th-TH")} รายการ
                        </span>
                        <span className="inline-flex items-center gap-1 font-semibold text-amber-300">
                          เปิดดู
                          <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-stone-950/80 p-6">
                <h3 className="font-kanit text-2xl text-white">ค้นหาต่อจากยี่ห้อรถ</h3>
                <div className="mt-6 flex flex-wrap gap-3">
                  {brands.map((brand) => (
                    <Link
                      key={brand.id}
                      href={`/products?brand=${encodeURIComponent(brand.name)}`}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-stone-200 transition hover:border-amber-400/40 hover:text-white"
                    >
                      {brand.name}
                      <span className="ml-2 text-stone-500">
                        {brand._count.carModels.toLocaleString("th-TH")}
                      </span>
                    </Link>
                  ))}
                </div>

                <div className="mt-8 rounded-[1.5rem] border border-white/10 bg-gradient-to-br from-white/[0.07] to-transparent p-5">
                  <p className="text-sm text-stone-400">
                    เหมาะสำหรับลูกค้าที่ทราบยี่ห้อรถ แต่ยังไม่ทราบชื่ออะไหล่ที่ต้องการ
                  </p>
                  <p className="mt-3 text-lg font-semibold text-white">
                    เลือกยี่ห้อรถก่อน แล้วค่อยกรองต่อในหน้าสินค้า
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-white/10 bg-[#f2efe8] text-stone-900">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
                จุดเด่นของหน้าเว็บนี้
              </p>
              <h2 className="mt-3 font-kanit text-3xl font-semibold text-stone-950">
                ออกแบบให้ใช้งานง่าย เข้าใจเร็ว และติดต่อได้ทันที
              </h2>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {reasons.map(({ title, description, icon: Icon }) => (
                <div
                  key={title}
                  className="rounded-[1.75rem] border border-stone-300 bg-white p-6 shadow-[0_15px_40px_-25px_rgba(0,0,0,0.35)]"
                >
                  <Icon className="h-5 w-5 text-amber-600" />
                  <h3 className="mt-5 font-kanit text-2xl text-stone-950">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-stone-600">{description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-white/10 bg-stone-100 text-stone-950">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
                  สินค้าแนะนำ
                </p>
                <h2 className="mt-3 font-kanit text-3xl font-semibold text-stone-950">
                  ตัวอย่างสินค้าที่ดึงจากระบบจริง
                </h2>
              </div>
              <Link
                href="/products"
                className="inline-flex items-center gap-2 self-start rounded-full bg-stone-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-800"
              >
                ไปหน้าค้นหาสินค้า
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {featuredProducts.map((product) => (
                <ProductCard key={product.id} product={product} lineUrl={config.shopLineUrl} />
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="bg-stone-950">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-8">
                <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
                  ขั้นตอนถัดไป
                </p>
                <h2 className="mt-3 max-w-2xl font-kanit text-3xl font-semibold text-white">
                  เมื่อพบสินค้าที่สนใจแล้ว สามารถติดต่อร้านต่อได้ทันที
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-stone-300">
                  หน้าเว็บนี้ทำหน้าที่ช่วยให้ลูกค้าค้นหาสินค้าได้ง่ายขึ้น และส่งต่อไปสู่การสอบถามกับร้านผ่านช่องทางที่สะดวกที่สุด คือ LINE OA และโทรศัพท์
                </p>

                <div className="mt-8 flex flex-wrap gap-3">
                  <a
                    href={config.shopLineUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-[#06C755] px-5 py-3 font-semibold text-white transition hover:bg-[#05a847]"
                  >
                    <MessageCircle className="h-4 w-4" />
                    ติดต่อผ่าน LINE OA
                  </a>
                  {config.shopPhone && (
                    <a
                      href={`tel:${config.shopPhone}`}
                      className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 font-semibold text-white transition hover:bg-white/5"
                    >
                      <Phone className="h-4 w-4" />
                      โทร {displayPhone}
                    </a>
                  )}
                </div>
              </div>

              <div className="rounded-[2rem] border border-amber-400/20 bg-gradient-to-br from-amber-500/12 to-transparent p-8">
                <p className="text-xs uppercase tracking-[0.24em] text-amber-200/80">
                  ข้อความตัวอย่างสำหรับสอบถาม
                </p>
                <div className="mt-4 rounded-[1.5rem] border border-white/10 bg-black/20 p-5 text-sm leading-7 text-stone-200">
                  สวัสดีครับ สนใจอะไหล่ชิ้นนี้
                  <br />
                  รุ่นรถ:
                  <br />
                  ยี่ห้อรถ:
                  <br />
                  รหัสหรือชื่อสินค้า:
                  <br />
                  ขอเช็กราคาและสต็อกให้หน่อยครับ
                </div>
                <p className="mt-4 text-sm text-stone-400">
                  สามารถคัดลอกข้อความนี้และกรอกรายละเอียดเพิ่มเติมก่อนส่งหาเราได้ เพื่อให้ตอบกลับได้รวดเร็วยิ่งขึ้น
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>

      <Footer config={config} />
      <FloatingLine lineUrl={config.shopLineUrl} />
    </>
  );
};

export default Home2Page;
