import Link from "next/link";
import { ArrowRight, Boxes, MessageCircle, ShieldCheck, Truck, Wrench } from "lucide-react";
import Home2FitmentFinder, { type Home2FinderBrand } from "./Home2FitmentFinder";
import { HOME2_SECTION_CARD_CLASS } from "./home2-theme";

const SERVICE_HIGHLIGHTS = [
  { icon: Wrench, title: "เช็กความตรงรุ่น", description: "แจ้งรุ่นรถ ปี ให้ร้านช่วยเทียบก่อนสั่ง" },
  { icon: Boxes, title: "มีสต๊อกพร้อมส่ง", description: "สินค้าในเว็บอัปเดตจากสต๊อกจริงหน้าร้าน" },
  { icon: Truck, title: "ส่งทั่วประเทศ", description: "จัดส่งถึงอู่หรือบ้านได้ทุกจังหวัด" },
  { icon: ShieldCheck, title: "สินค้ามีประกัน", description: "ระยะประกันระบุชัดบนหน้าสินค้า" },
] as const;

interface Props {
  shopName: string;
  heroTitle: string;
  heroSubtitle: string;
  lineUrl: string;
  /** Active car brands with their models, for the fitment finder. */
  finderBrands: Home2FinderBrand[];
  /** Active category names, for the finder's multi-select. */
  finderCategories: string[];
}

const Home2Hero = ({
  shopName,
  heroTitle,
  heroSubtitle,
  lineUrl,
  finderBrands,
  finderCategories,
}: Props) => (
  <section className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
    {/* Primary banner — the finder lives inside it, so the pitch and the
        "find my part" step read as one unit instead of two stacked cards. */}
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1e3a5f] via-[#25508a] to-[#2563eb] p-5 text-white sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-20 -left-10 h-52 w-52 rounded-full bg-white/5"
        />

        <div className="relative grid items-center gap-6 lg:grid-cols-2 lg:gap-10">
          <div className="max-w-xl">
            <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
              {shopName}
            </span>
            <h1 className="mt-3 font-kanit text-2xl font-bold leading-tight sm:text-4xl">
              {heroTitle}
            </h1>
            <p className="mt-2 text-sm text-white/80 sm:text-base">{heroSubtitle}</p>

            <div className="mt-5 flex flex-wrap gap-2.5">
              <Link
                href="/products"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#1e3a5f] transition-colors hover:bg-[#e6eefa]"
              >
                ดูสินค้าทั้งหมด
                <ArrowRight className="h-4 w-4" />
              </Link>
              {lineUrl && (
                <a
                  href={lineUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-white/40 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                >
                  <MessageCircle className="h-4 w-4" />
                  สอบถามทาง LINE
                </a>
              )}
            </div>
          </div>

          {/* Same search logic as "/", re-skinned to blue */}
          <Home2FitmentFinder
            brands={finderBrands}
            categories={finderCategories}
            lineUrl={lineUrl}
          />
        </div>
      </div>

    {/* Service strip */}
    <div className={`${HOME2_SECTION_CARD_CLASS} mt-3 grid grid-cols-2 gap-px overflow-hidden lg:grid-cols-4`}>
      {SERVICE_HIGHLIGHTS.map(({ icon: Icon, title, description }) => (
        <div key={title} className="flex items-start gap-2.5 bg-white p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#eff5fc] text-[#1e3a5f]">
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-slate-800">{title}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{description}</span>
          </span>
        </div>
      ))}
    </div>

  </section>
);

export default Home2Hero;
