export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowRight, ChevronRight, MessageCircle, Phone, Search, Sparkles } from "lucide-react";
import Navbar from "@/components/shared/Navbar";
import Footer from "@/components/shared/Footer";
import FloatingLine from "@/components/shared/FloatingLine";
import ProductCard from "@/components/shared/ProductCard";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";

const Home3Page = async () => {
  const config = await getSiteConfig();

  const [categories, featuredProducts, productCount] = await Promise.all([
    db.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      take: 3,
      select: { id: true, name: true, _count: { select: { products: true } } },
    }),
    db.product.findMany({
      where: { isActive: true, stock: { gt: 0 } },
      orderBy: [{ createdAt: "desc" }],
      take: 4,
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
          select: { carModel: { select: { name: true, carBrand: { select: { name: true } } } } },
          take: 6,
        },
      },
    }),
    db.product.count({ where: { isActive: true } }),
  ]);

  const displayPhone = config.shopPhone?.replace(/(\d{3})(\d{3})(\d{4})/, "$1-$2-$3");

  return (
    <>
      <Navbar shopName={config.shopName} shopSlogan={config.shopSlogan} lineUrl={config.shopLineUrl} shopPhone={config.shopPhone} />
      <main className="min-h-screen bg-[#0a0a0b] pt-16 text-white">
        <section className="relative overflow-hidden border-b border-white/10">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(216,180,101,0.22),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(94,104,121,0.14),transparent_26%),linear-gradient(180deg,#0a0a0b_0%,#121316_52%,#17181c_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px)] bg-[size:88px_88px]" />
          <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
            <div className="grid gap-10 lg:grid-cols-[1.25fr_0.75fr]">
              <div className="space-y-8">
                <div className="inline-flex items-center gap-2 rounded-full border border-[#d8b465]/25 bg-[#d8b465]/10 px-4 py-1.5 text-sm font-medium text-[#f6e7bf]">
                  <Sparkles className="h-4 w-4" />
                  Premium Editorial
                </div>

                <div className="space-y-5">
                  <p className="max-w-xl text-sm uppercase tracking-[0.32em] text-slate-400">
                    performance parts / editorial surface / inquiry first
                  </p>
                  <h1 className="max-w-5xl font-kanit text-5xl font-bold leading-[0.96] text-white sm:text-6xl lg:text-7xl">
                    หน้าแรกที่ทำให้ร้าน
                    <br />
                    ดูมีระดับขึ้น
                    <br />
                    และยังขายงานได้จริง
                  </h1>
                  <p className="max-w-2xl text-lg leading-8 text-slate-300">
                    ผมรื้อโครงใหม่ให้เป็น editorial จริง: ข้อความเด่น, จังหวะหายใจของหน้า, section ที่มีน้ำหนักต่างกัน และการนำสายตาไปสู่การค้นหาและติดต่อ ไม่ใช่แค่เอา panel มาวางเรียงกัน
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                  <form action="/products" method="GET" className="grid gap-3 rounded-[2rem] border border-white/10 bg-white/6 p-4 backdrop-blur md:grid-cols-[1fr_auto]">
                    <label className="sr-only" htmlFor="editorial-search">ค้นหาสินค้า</label>
                    <input
                      id="editorial-search"
                      name="q"
                      type="text"
                      placeholder="ค้นหาชื่อสินค้า รหัสอะไหล่ ยี่ห้อรถ หรือรุ่นรถ"
                      className="h-14 rounded-2xl border border-white/10 bg-black/25 px-5 text-base text-white placeholder:text-slate-500 focus:border-[#d8b465] focus:outline-none"
                    />
                    <Button type="submit" size="lg" className="h-14 rounded-2xl bg-[#d8b465] px-5 text-sm font-semibold text-[#111827] hover:bg-[#e4c67d]">
                      <Search className="h-4 w-4" />
                      ค้นหาอะไหล่
                    </Button>
                  </form>

                  <div className="rounded-[2rem] border border-white/10 bg-white/6 p-4 backdrop-blur">
                    <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Immediate Contact</p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <Button
                        nativeButton={false}
                        size="lg"
                        className="h-12 rounded-full bg-[#06C755] px-5 text-sm font-semibold text-white hover:bg-[#05a847]"
                        render={<a href={config.shopLineUrl} target="_blank" rel="noopener noreferrer" />}
                      >
                        <MessageCircle className="h-4 w-4" />
                        LINE OA
                      </Button>
                      {config.shopPhone && (
                        <Button
                          nativeButton={false}
                          size="lg"
                          variant="outline"
                          className="h-12 rounded-full border-white/15 bg-transparent px-5 text-sm font-semibold text-white hover:bg-white/5"
                          render={<a href={`tel:${config.shopPhone}`} />}
                        >
                          <Phone className="h-4 w-4" />
                          {displayPhone}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 self-start">
                <div className="rounded-[2.2rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.10),rgba(255,255,255,0.03))] p-6">
                  <p className="text-xs uppercase tracking-[0.22em] text-slate-500">Editorial Note</p>
                  <p className="mt-4 font-kanit text-3xl leading-tight text-white">
                    จุดต่างของเวอร์ชันนี้คือ
                    <br />
                    “ขายภาพลักษณ์”
                    <br />
                    พร้อมกับ “ขายงาน”
                  </p>
                  <p className="mt-4 text-sm leading-7 text-slate-300">
                    ลูกค้าควรรู้สึกว่าร้านนี้ดูดีพอจะเชื่อถือ และใช้ง่ายพอจะกดถามต่อทันที สองอย่างนี้ต้องอยู่พร้อมกัน
                  </p>
                </div>

                <div className="rounded-[2.2rem] border border-[#d8b465]/20 bg-[#d8b465]/10 p-6 text-[#f8edcf]">
                  <p className="text-xs uppercase tracking-[0.22em] text-[#f0dba2]/80">Store Snapshot</p>
                  <div className="mt-4 grid gap-3">
                    <div>
                      <p className="text-4xl font-semibold">{productCount.toLocaleString("th-TH")}+</p>
                      <p className="mt-1 text-sm text-[#f0dba2]/80">รายการสินค้าที่พร้อมให้ค้นหา</p>
                    </div>
                    <div className="border-t border-white/10 pt-3">
                      <p className="text-sm text-[#f0dba2]/80">LINE OA</p>
                      <p className="mt-1 text-lg font-semibold">{config.shopLineId || "ใช้บัญชีร้านจากระบบ"}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-white/10 bg-[#f1ece2] text-[#111827]">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
            <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="space-y-4">
                <p className="text-xs uppercase tracking-[0.24em] text-[#8b7355]">Curated Access</p>
                <h2 className="font-kanit text-4xl font-semibold leading-tight">
                  คัดทางเข้าหลักของสินค้า
                  <br />
                  ให้เหมือน section ในนิตยสาร
                </h2>
                <p className="max-w-lg text-base leading-7 text-[#57534e]">
                  แทนที่จะเอาหมวดมาวางเป็น utility grid ธรรมดา ผมให้แต่ละหมวดมีน้ำหนักแบบ curated showcase เพื่อให้หน้าเว็บหายใจและดูพรีเมียมขึ้น
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {categories.map((category, index) => (
                  <Link
                    key={category.id}
                    href={`/products?category=${encodeURIComponent(category.name)}`}
                    className="group flex min-h-[260px] flex-col justify-between rounded-[2rem] border border-[#d8cdb8] bg-white p-6 shadow-[0_24px_60px_-40px_rgba(0,0,0,0.35)] transition hover:-translate-y-1 hover:shadow-[0_34px_80px_-36px_rgba(0,0,0,0.35)]"
                  >
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-[#8b7355]">0{index + 1}</p>
                      <h3 className="mt-4 font-kanit text-3xl leading-tight text-[#111827]">{category.name}</h3>
                    </div>
                    <div>
                      <p className="text-sm text-[#6b5d49]">{category._count.products.toLocaleString("th-TH")} รายการ</p>
                      <div className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-[#111827]">
                        เปิดดูหมวดนี้
                        <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-white/10 bg-[#17181c]">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Selected Inventory</p>
                <h2 className="mt-2 font-kanit text-4xl font-semibold text-white">
                  เลือกสินค้าจริงจากระบบ
                  <br />
                  มาเล่าในบรรยากาศแบบ premium
                </h2>
              </div>
              <Link href="/products" className="inline-flex items-center gap-2 text-sm font-semibold text-[#f0dba2] transition hover:text-white">
                ไปหน้าสินค้าทั้งหมด
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
              {featuredProducts.map((product) => (
                <ProductCard key={product.id} product={product} lineUrl={config.shopLineUrl} />
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="bg-[#0a0a0b]">
          <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[2.2rem] border border-white/10 bg-white/[0.04] p-8">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Closing Scene</p>
                <h2 className="mt-3 max-w-2xl font-kanit text-4xl font-semibold leading-tight text-white">
                  เมื่อภาพลักษณ์ดูดีแล้ว
                  <br />
                  หน้าเว็บต้องพาไปสู่การติดต่อ
                  <br />
                  อย่างไม่ลังเล
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-400">
                  ตอนจบของหน้า editorial นี้จึงไม่ใช่ section ที่อัดข้อมูลเพิ่ม แต่เป็นพื้นที่ที่บอกชัดว่าลูกค้าควรคุยต่อผ่านช่องทางไหน เพื่อปิดงานจริง
                </p>

                <div className="mt-8 flex flex-wrap gap-3">
                  <Button
                    nativeButton={false}
                    size="lg"
                    className="h-12 rounded-full bg-[#06C755] px-5 text-sm font-semibold text-white hover:bg-[#05a847]"
                    render={<a href={config.shopLineUrl} target="_blank" rel="noopener noreferrer" />}
                  >
                    <MessageCircle className="h-4 w-4" />
                    ติดต่อผ่าน LINE OA
                  </Button>
                  {config.shopPhone && (
                    <Button
                      nativeButton={false}
                      size="lg"
                      variant="outline"
                      className="h-12 rounded-full border-white/15 bg-transparent px-5 text-sm font-semibold text-white hover:bg-white/5"
                      render={<a href={`tel:${config.shopPhone}`} />}
                    >
                      <Phone className="h-4 w-4" />
                      โทร {displayPhone}
                    </Button>
                  )}
                </div>
              </div>

              <div className="rounded-[2.2rem] border border-[#d8b465]/20 bg-[#d8b465]/10 p-8 text-[#f8edcf]">
                <p className="text-xs uppercase tracking-[0.24em] text-[#f0dba2]/80">Suggested Message</p>
                <div className="mt-4 rounded-[1.6rem] border border-white/10 bg-black/15 p-5 text-sm leading-7">
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

export default Home3Page;

