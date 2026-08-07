import Link from "next/link";
import { ArrowRight, Car } from "lucide-react";
import { HOME2_SECTION_CARD_CLASS } from "./home2-theme";

interface Props {
  /** Active car brands from the live catalogue, with their model counts. */
  brands: { id: string; name: string; modelCount: number }[];
  lineUrl: string;
}

const Home2CarBrands = ({ brands, lineUrl }: Props) => {
  if (brands.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 pt-3 sm:px-6 lg:px-8">
      <div className={HOME2_SECTION_CARD_CLASS}>
        <div className="flex items-center justify-between border-b border-[#eef3fa] px-4 py-3 sm:px-5">
          <div>
            <h2 className="font-kanit text-base font-bold text-[#1e3a5f] sm:text-lg">
              เลือกอะไหล่ตามยี่ห้อรถ
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              กดยี่ห้อรถเพื่อกรองเฉพาะอะไหล่ที่ระบุว่าตรงรุ่น
            </p>
          </div>
          <Link
            href="/products"
            className="-mr-2 inline-flex min-h-[28px] shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold text-[#2563eb] transition-colors hover:bg-[#eff5fc] hover:text-[#1d4ed8] sm:text-sm"
          >
            ดูทั้งหมด
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 sm:p-4 lg:grid-cols-6">
          {brands.map((brand) => (
            <Link
              key={brand.id}
              href={`/products?brand=${encodeURIComponent(brand.name)}`}
              prefetch={false}
              className="group flex items-center gap-2 rounded-xl border border-[#e3ecf8] px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:border-[#1e3a5f]/30 hover:bg-[#f6f9fe]"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#eff5fc] text-[#1e3a5f] transition-colors group-hover:bg-[#1e3a5f] group-hover:text-white">
                <Car className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-800">
                  {brand.name}
                </span>
                <span className="block text-[10px] text-slate-400">
                  {brand.modelCount.toLocaleString("th-TH")} รุ่น
                </span>
              </span>
            </Link>
          ))}
        </div>

        {lineUrl && (
          <div className="flex flex-col gap-2 border-t border-[#eef3fa] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="text-xs text-slate-500 sm:text-sm">
              ไม่เจอยี่ห้อหรือรุ่นรถที่ต้องการ? ส่งรุ่นรถและปีมาทาง LINE ให้แอดมินเช็กให้ชัวร์ก่อน
            </p>
            <a
              href={lineUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-[#1e3a5f] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#163055] sm:text-sm"
            >
              ทักแอดมินทาง LINE
            </a>
          </div>
        )}
      </div>
    </section>
  );
};

export default Home2CarBrands;
