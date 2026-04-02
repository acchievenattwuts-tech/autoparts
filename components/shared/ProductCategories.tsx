import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { db } from "@/lib/db";

const LINE_OA_URL = "https://lin.ee/18P0SqG";

const CATEGORY_ICON: Record<string, string> = {
  คอมเพรสเซอร์: "❄️",
  หม้อน้ำ: "🌡️",
  คอนเดนเซอร์: "🔲",
  ท่อแอร์: "🔧",
  ท่อ: "🔧",
};

const getIcon = (name: string) => {
  for (const [key, icon] of Object.entries(CATEGORY_ICON)) {
    if (name.includes(key)) return icon;
  }
  return "⚙️";
};

const ProductCategories = async () => {
  const categories = await db.category.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: { _count: { select: { products: { where: { isActive: true } } } } },
  });

  return (
    <section id="categories" className="bg-gray-50 py-12 sm:py-14 lg:py-16">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 text-center sm:mb-10">
          <span className="mb-3 inline-block rounded-full bg-[#1e3a5f]/10 px-4 py-1.5 text-sm font-semibold text-[#1e3a5f]">
            หมวดหมู่สินค้า
          </span>
          <h2 className="mb-3 font-kanit text-2xl font-bold text-gray-900 sm:text-3xl lg:text-4xl">
            อะไหล่ครบ จบในที่เดียว
          </h2>
          <p className="mx-auto max-w-xl text-base text-gray-500 sm:text-lg">
            สต็อกสินค้าพร้อมส่ง ทุกยี่ห้อ ทุกรุ่น ทั้งรถเก๋ง รถกระบะ และรถตู้
          </p>
        </div>

        {categories.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/products?category=${encodeURIComponent(category.name)}`}
                className="group relative rounded-2xl border border-gray-100 bg-white p-4 transition-all duration-300 hover:border-[#f97316]/40 hover:shadow-lg sm:p-5"
              >
                <div className="mb-3 text-3xl sm:text-4xl">{getIcon(category.name)}</div>
                <h3 className="mb-1 line-clamp-2 text-base font-bold text-gray-900 transition-colors group-hover:text-[#1e3a5f] sm:text-lg">
                  {category.name}
                </h3>
                <p className="mb-3 text-xs text-gray-400 sm:text-sm">
                  {category._count.products} รายการสินค้า
                </p>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-[#f97316]">
                  ดูสินค้า
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#1e3a5f]/0 to-[#f97316]/0 transition-all duration-300 group-hover:from-[#1e3a5f]/3 group-hover:to-[#f97316]/5" />
              </Link>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {[
              { label: "คอมเพรสเซอร์แอร์", desc: "ทุกยี่ห้อ ทุกรุ่น", icon: "❄️" },
              { label: "หม้อน้ำรถยนต์", desc: "ครบทุกรุ่น", icon: "🌡️" },
              { label: "แผงคอนเดนเซอร์", desc: "คุณภาพสูง", icon: "🔲" },
              { label: "ท่อและสายแอร์", desc: "ครบชุด", icon: "🔧" },
              { label: "อะไหล่อื่นๆ", desc: "เลือกดูได้", icon: "⚙️" },
            ].map((category) => (
              <Link
                key={category.label}
                href={`/products?q=${encodeURIComponent(category.label)}`}
                className="group relative rounded-2xl border border-gray-100 bg-white p-4 transition-all duration-300 hover:border-[#f97316]/40 hover:shadow-lg sm:p-5"
              >
                <div className="mb-3 text-3xl sm:text-4xl">{category.icon}</div>
                <h3 className="mb-1 line-clamp-2 text-base font-bold text-gray-900 transition-colors group-hover:text-[#1e3a5f] sm:text-lg">
                  {category.label}
                </h3>
                <p className="mb-3 text-xs text-gray-500 sm:text-sm">{category.desc}</p>
                <div className="flex items-center gap-1.5 text-sm font-semibold text-[#f97316]">
                  ดูสินค้า
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </div>
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8 text-center">
          <p className="mb-4 text-gray-500">ไม่เจอรุ่นที่ต้องการ? สอบถามเราได้โดยตรง</p>
          <a
            href={LINE_OA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full bg-[#06C755] px-6 py-3 font-semibold text-white transition-all hover:scale-105 hover:bg-[#05a847]"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white">
              <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
            </svg>
            แจ้งรุ่นรถ สอบถามทาง LINE
          </a>
        </div>
      </div>
    </section>
  );
};

export default ProductCategories;
