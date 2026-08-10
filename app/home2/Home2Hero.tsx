import { Boxes, ShieldCheck, Truck, Wrench } from "lucide-react";
import Home2FitmentFinder, { type Home2FinderBrand } from "./Home2FitmentFinder";
import { HOME2_SECTION_CARD_CLASS } from "./home2-theme";

const SERVICE_HIGHLIGHTS = [
  { icon: Wrench, title: "เช็กความตรงรุ่น", description: "แจ้งรุ่นรถ ปี ให้ร้านช่วยเทียบก่อนสั่ง" },
  { icon: Boxes, title: "มีสต๊อกพร้อมส่ง", description: "สินค้าในเว็บอัปเดตจากสต๊อกจริงหน้าร้าน" },
  { icon: Truck, title: "ส่งทั่วประเทศ", description: "จัดส่งถึงอู่หรือบ้านได้ทุกจังหวัด" },
  { icon: ShieldCheck, title: "สินค้ามีประกัน", description: "ระยะประกันระบุชัดบนหน้าสินค้า" },
] as const;

interface Props {
  /** Active car brands with their models, for the fitment finder. */
  finderBrands: Home2FinderBrand[];
  /** Active category names, for the finder's multi-select. */
  finderCategories: string[];
  lineUrl: string;
}

/**
 * Hero banner built entirely around the fitment finder.
 *
 * Finding a part that fits is the one job customers arrive with, so the banner
 * carries no competing marketing column — just the headline and the form,
 * centred on the blue field.
 */
const Home2Hero = ({ finderBrands, finderCategories, lineUrl }: Props) => (
  <section className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#16345d] via-[#25508a] to-[#2563eb] px-4 py-8 text-white sm:px-8 sm:py-10 lg:py-12">
      {/* Soft light shapes — purely decorative, clipped by the card */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-white/10 blur-2xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-24 -left-16 h-64 w-64 rounded-full bg-[#06C755]/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
      />

      <div className="relative mx-auto max-w-5xl">
        <header className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3.5 py-1.5 text-xs font-semibold backdrop-blur-sm">
            <Wrench className="h-3.5 w-3.5" />
            เช็กความตรงรุ่นก่อนสั่ง
          </span>

          <h1 className="mt-4 font-kanit text-2xl font-bold leading-tight sm:text-4xl">
            ค้นหาอะไหล่ตามรถของคุณ
          </h1>

          <p className="mx-auto mt-2.5 max-w-2xl text-sm text-white/75 sm:text-base">
            เลือกยี่ห้อ รุ่น และปีรถ แล้วให้ระบบกรองเฉพาะอะไหล่ที่ระบุว่าตรงรุ่นให้ทันที
          </p>
        </header>

        <div className="mt-6 sm:mt-8">
          {/* Same search logic as "/", re-skinned to blue */}
          <Home2FitmentFinder
            brands={finderBrands}
            categories={finderCategories}
            lineUrl={lineUrl}
          />
        </div>
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
