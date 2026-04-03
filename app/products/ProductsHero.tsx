import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";

interface ProductsHeroProps {
  lineUrl: string;
  searchQuery?: string;
}

const orderSteps = [
  "แจ้งรุ่นรถ ปีรถ หรือชื่อสินค้า",
  "ร้านเช็กราคาและความตรงรุ่นให้ทันที",
  "ชำระเงินและจัดส่งสินค้า",
];

const ProductsHero = ({ lineUrl, searchQuery }: ProductsHeroProps) => (
  <section className="overflow-hidden bg-[#10213d]">
    <div className="bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.22),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_32%)]">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <div className="max-w-4xl">
          <h1 className="font-kanit text-2xl font-bold leading-tight text-white sm:text-3xl lg:text-4xl">
            หาอะไหล่ให้เจอเร็ว แล้วให้ร้านเช็กต่อได้ทันที
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-white/72 sm:text-base">
            ค้นหาจากชื่อสินค้า รหัสอะไหล่ ยี่ห้อรถ หรือรุ่นรถ แล้วส่งข้อมูลต่อให้ร้านเช็กความตรงรุ่น ราคา และการจัดส่งได้ในขั้นตอนเดียว
          </p>
        </div>

        <form action="/products/search" method="GET" className="mt-4 hidden max-w-3xl sm:block">
          <label className="sr-only" htmlFor="products-hero-search">
            ค้นหาสินค้า
          </label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                id="products-hero-search"
                type="text"
                name="q"
                defaultValue={searchQuery ?? ""}
                placeholder="เช่น คอมแอร์ Denso, VIGO, แผงคอนเดนเซอร์..."
                className="h-12 w-full rounded-2xl border border-white/12 bg-white px-11 text-sm text-slate-900 outline-none transition focus:border-[#f97316] focus:ring-4 focus:ring-[#f97316]/15"
              />
            </div>
            <button
              type="submit"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#f97316] px-5 text-sm font-semibold text-white transition hover:bg-[#ea6c0a] sm:min-w-[170px]"
            >
              ค้นหาสินค้า
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </form>

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {orderSteps.map((step, index) => (
            <div key={step} className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#f97316]">
                Step {index + 1}
              </p>
              <p className="mt-1 text-sm leading-6 text-white/82">{step}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/products/search"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-white/14 bg-white/8 px-5 text-sm font-semibold text-white transition hover:bg-white/14"
          >
            เปิดหน้าค้นหาและตัวกรอง
            <ArrowRight className="h-4 w-4" />
          </Link>
          <a
            href={lineUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 items-center justify-center rounded-2xl border border-white/14 px-5 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            ส่งรูปหรือรหัสให้ร้านช่วยเช็ก
          </a>
        </div>
      </div>
    </div>
  </section>
);

export default ProductsHero;
