export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowRight, Gauge, MessageCircle, Phone, Search, ShieldCheck, SlidersHorizontal, Wrench } from "lucide-react";
import Navbar from "@/components/shared/Navbar";
import Footer from "@/components/shared/Footer";
import FloatingLine from "@/components/shared/FloatingLine";
import ProductCard from "@/components/shared/ProductCard";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";

const Home4Page = async () => {
  const config = await getSiteConfig();

  const [categories, featuredProducts, productCount] = await Promise.all([
    db.category.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      take: 6,
      select: { id: true, name: true, _count: { select: { products: true } } },
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
      <main className="min-h-screen bg-[#121316] pt-16 text-white">
        <section className="border-b border-white/10 bg-[linear-gradient(180deg,#121316_0%,#1a1c21_100%)]">
          <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
            <div className="grid gap-4 lg:grid-cols-[0.95fr_1.2fr_0.85fr]">
              <div className="border border-white/10 bg-black/20 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Mode</p>
                <h1 className="mt-3 font-kanit text-4xl font-semibold leading-tight text-white">
                  Premium Mechanical
                  <br />
                  Control Surface
                </h1>
                <p className="mt-4 text-sm leading-7 text-slate-400">
                  เวอร์ชันนี้ไม่เล่าเรื่องแบบ editorial แต่ทำให้หน้าบ้านเหมือนแผงควบคุมสินค้าและการสอบถาม ใช้ข้อมูลและจังหวะที่แน่นขึ้น ชัดขึ้น และเป็นเครื่องกลมากขึ้น
                </p>
              </div>

              <div className="border border-[#f97316]/35 bg-[linear-gradient(135deg,rgba(249,115,22,0.18),rgba(255,255,255,0.04))] p-5 shadow-[0_0_0_1px_rgba(249,115,22,0.2)]">
                <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-orange-200/80">Primary Search</p>
                    <p className="mt-2 font-kanit text-3xl text-white">ค้นหาสินค้า แล้วต่อเข้าแชตทันที</p>
                  </div>
                  <Gauge className="h-6 w-6 text-orange-200" />
                </div>

                <form action="/products" method="GET" className="mt-5 grid gap-3 md:grid-cols-[1fr_auto_auto]">
                  <label className="sr-only" htmlFor="home4-search">ค้นหาสินค้า</label>
                  <input
                    id="home4-search"
                    name="q"
                    type="text"
                    placeholder="ค้นหาชื่อสินค้า รหัสอะไหล่ ยี่ห้อรถ หรือรุ่นรถ"
                    className="h-14 border border-white/10 bg-black/25 px-4 text-base text-white placeholder:text-slate-500 focus:border-[#f97316] focus:outline-none"
                  />
                  <Button type="submit" size="lg" className="h-14 rounded-none bg-[#f97316] px-5 text-sm font-semibold text-white hover:bg-[#ea6c0a]">
                    <Search className="h-4 w-4" />
                    Search
                  </Button>
                  <Button
                    type="button"
                    nativeButton={false}
                    size="lg"
                    className="h-14 rounded-none bg-[#06C755] px-5 text-sm font-semibold text-white hover:bg-[#05a847]"
                    render={<a href={config.shopLineUrl} target="_blank" rel="noopener noreferrer" />}
                  >
                    <MessageCircle className="h-4 w-4" />
                    LINE OA
                  </Button>
                </form>

                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  <div className="border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Inventory</p>
                    <p className="mt-2 text-3xl font-semibold text-white">{productCount.toLocaleString("th-TH")}+</p>
                  </div>
                  <div className="border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Contact</p>
                    <p className="mt-2 text-sm font-semibold text-white">LINE / โทร</p>
                  </div>
                  <div className="border border-white/10 bg-black/20 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Intent</p>
                    <p className="mt-2 text-sm font-semibold text-white">Search to inquiry</p>
                  </div>
                </div>
              </div>

              <div className="border border-white/10 bg-black/20 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Comms</p>
                <div className="mt-4 space-y-4">
                  <div className="border border-white/10 bg-white/5 p-4">
                    <p className="text-sm text-slate-400">LINE OA</p>
                    <p className="mt-1 text-xl font-semibold text-white">{config.shopLineId || "ใช้บัญชีร้านจากระบบ"}</p>
                  </div>
                  <div className="border border-white/10 bg-white/5 p-4">
                    <p className="text-sm text-slate-400">โทรหน้าร้าน</p>
                    <p className="mt-1 text-xl font-semibold text-white">{displayPhone || "ใช้เบอร์ร้านจากระบบ"}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-white/10 bg-[#17191d]">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
              <div className="border border-white/10 bg-black/20 p-6">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Interface Logic</p>
                <h2 className="mt-3 font-kanit text-4xl font-semibold text-white">
                  ต่างจาก `home3`
                  <br />
                  ตรงที่หน้านี้
                  <br />
                  ใช้ภาษาของระบบ
                </h2>
                <p className="mt-4 text-sm leading-7 text-slate-400">
                  ไม่มี curated cards แบบ magazine และไม่มีจังหวะการเล่าเรื่องยาว ๆ หน้านี้คิดแบบเครื่องมือ ใช้เส้น grid, panel, stat box และ action rail เป็นหลัก
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {[
                  {
                    title: "Spec-driven",
                    description: "ทุกบล็อกควรอ่านเหมือนส่วนหนึ่งของ spec sheet ไม่ใช่ section marketing",
                    icon: SlidersHorizontal,
                  },
                  {
                    title: "Mechanical",
                    description: "ใช้สี graphite + steel + orange เพื่อให้ลุคเหมือนเครื่องมือและเครื่องจักร",
                    icon: Wrench,
                  },
                  {
                    title: "Trustable",
                    description: "ใช้ข้อมูลจริงและช่องทางติดต่อชัดเจนเพื่อพาลูกค้าไปคุยต่ออย่างมั่นใจ",
                    icon: ShieldCheck,
                  },
                ].map(({ title, description, icon: Icon }) => (
                  <div key={title} className="border border-white/10 bg-black/20 p-5">
                    <Icon className="h-5 w-5 text-[#f97316]" />
                    <h3 className="mt-4 font-kanit text-2xl text-white">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-b border-white/10 bg-[#0f1114]">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Category Matrix</p>
                <h2 className="mt-2 font-kanit text-4xl font-semibold text-white">
                  หมวดสินค้าในรูปแบบ
                  <br />
                  matrix panel
                </h2>
              </div>
              <Link href="/products" className="inline-flex items-center gap-2 text-sm font-semibold text-orange-300 transition hover:text-white">
                ไปหน้าสินค้าทั้งหมด
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {categories.map((category, index) => (
                <Link
                  key={category.id}
                  href={`/products?category=${encodeURIComponent(category.name)}`}
                  className="group border border-white/10 bg-black/20 p-5 transition hover:border-[#f97316]/60 hover:bg-black/30"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Sector 0{index + 1}</p>
                      <h3 className="mt-3 font-kanit text-3xl text-white">{category.name}</h3>
                    </div>
                    <div className="border border-white/10 px-3 py-1 text-xs font-semibold text-slate-300">
                      {category._count.products.toLocaleString("th-TH")}
                    </div>
                  </div>
                  <div className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-orange-300">
                    เปิดหมวดนี้
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-white/10 bg-[#ece7dc] text-[#111827]">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-3xl">
                <p className="text-xs uppercase tracking-[0.24em] text-[#78716c]">Live Parts Feed</p>
                <h2 className="mt-2 font-kanit text-4xl font-semibold text-[#111827]">
                  สินค้าจริงจากระบบ
                  <br />
                  ในหน้าตาแบบ control surface
                </h2>
              </div>
              <Link href="/products" className="inline-flex items-center gap-2 text-sm font-semibold text-[#111827] transition hover:text-[#ea6c0a]">
                เปิดหน้าค้นหาสินค้า
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

        <section id="contact" className="bg-[#121316]">
          <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
            <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="border border-[#f97316]/35 bg-[linear-gradient(135deg,rgba(249,115,22,0.18),rgba(255,255,255,0.02))] p-8 text-white">
                <p className="text-xs uppercase tracking-[0.24em] text-orange-200/80">Final Action</p>
                <h2 className="mt-3 max-w-2xl font-kanit text-4xl font-semibold leading-tight text-white">
                  ปิดหน้าด้วย action rail
                  <br />
                  ไม่ใช่ closing scene แบบ `home3`
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">
                  หน้านี้สรุปตรง ๆ ว่าหลังค้นหาแล้วให้ลูกค้าไปต่อที่ LINE OA หรือโทร ไม่มีภาษานิตยสาร ไม่มีจังหวะอารมณ์ยาว แต่วางเหมือน panel ปฏิบัติการ
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Button
                    nativeButton={false}
                    size="lg"
                    className="h-12 rounded-none bg-[#06C755] px-5 text-sm font-semibold text-white hover:bg-[#05a847]"
                    render={<a href={config.shopLineUrl} target="_blank" rel="noopener noreferrer" />}
                  >
                    <MessageCircle className="h-4 w-4" />
                    ติดต่อ LINE OA
                  </Button>
                  {config.shopPhone && (
                    <Button
                      nativeButton={false}
                      size="lg"
                      variant="outline"
                      className="h-12 rounded-none border-white/15 bg-transparent px-5 text-sm font-semibold text-white hover:bg-white/5"
                      render={<a href={`tel:${config.shopPhone}`} />}
                    >
                      <Phone className="h-4 w-4" />
                      โทร {displayPhone}
                    </Button>
                  )}
                </div>
              </div>

              <div className="border border-white/10 bg-black/20 p-8 text-white">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Message Format</p>
                <div className="mt-4 border border-white/10 bg-white/5 p-5 text-sm leading-7 text-slate-200">
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

export default Home4Page;
