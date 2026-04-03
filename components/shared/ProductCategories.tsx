import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { db } from "@/lib/db";
import { getCategoryPath } from "@/lib/product-slug";

const LINE_OA_URL = "https://lin.ee/18P0SqG";

const CATEGORY_ICON: Record<string, string> = {
  คอมเพรสเซอร์: "❄️",
  หม้อน้ำ: "🌡️",
  คอนเดนเซอร์: "🪟",
  ท่อแอร์: "🔧",
  ท่อ: "🔧",
};

const getIcon = (name: string) => {
  for (const [key, icon] of Object.entries(CATEGORY_ICON)) {
    if (name.includes(key)) return icon;
  }
  return "⚙️";
};

const fallbackCategories = [
  { label: "คอมเพรสเซอร์แอร์", desc: "ทุกยี่ห้อ ทุกรุ่น", icon: "❄️" },
  { label: "หม้อน้ำรถยนต์", desc: "ครบทุกขนาด", icon: "🌡️" },
  { label: "แผงคอนเดนเซอร์", desc: "พร้อมส่ง", icon: "🪟" },
  { label: "ท่อและสายแอร์", desc: "ใช้งานได้หลายรุ่น", icon: "🔧" },
  { label: "วาล์วและอุปกรณ์", desc: "อะไหล่เสริม", icon: "⚙️" },
];

const ProductCategories = async () => {
  const categories = await db.category.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { products: { where: { isActive: true } } } },
    },
  });

  const items =
    categories.length > 0
      ? categories.map((category) => ({
          id: category.id,
          name: category.name,
          count: category._count.products,
          icon: getIcon(category.name),
          href: getCategoryPath(category),
        }))
      : fallbackCategories.map((category) => ({
          id: category.label,
          name: category.label,
          count: null,
          icon: category.icon,
          href: `/products?q=${encodeURIComponent(category.label)}`,
          desc: category.desc,
        }));

  return (
    <section id="categories" className="bg-gray-50 py-10 sm:py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <span className="mb-2 inline-block rounded-full bg-[#1e3a5f]/10 px-3 py-1 text-xs font-semibold tracking-wide text-[#1e3a5f] sm:text-sm">
              หมวดหมู่สินค้า
            </span>
            <h2 className="font-kanit text-2xl font-bold text-gray-900 sm:text-3xl">
              เลือกดูหมวดอะไหล่ได้รวดเร็ว
            </h2>
            <p className="mt-2 text-sm text-gray-500 sm:text-base">
              รวมหมวดหลักของอะไหล่แอร์และหม้อน้ำรถยนต์ กดเข้าไปดูสินค้าในหมวดที่ต้องการได้ทันที
            </p>
          </div>

          <Link
            href="/products"
            className="inline-flex items-center gap-2 self-start rounded-full border border-[#1e3a5f]/15 bg-white px-4 py-2 text-sm font-semibold text-[#1e3a5f] transition hover:border-[#1e3a5f]/30 hover:bg-[#1e3a5f]/5"
          >
            ดูสินค้าทั้งหมด
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="overflow-x-auto pb-2 lg:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex min-w-max gap-3 sm:gap-4 lg:grid lg:min-w-0 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                prefetch
                className="group flex w-[220px] shrink-0 snap-start items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-4 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-[#f97316]/35 hover:shadow-md sm:w-[240px] lg:w-auto lg:shrink lg:snap-none"
              >
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#1e3a5f]/10 to-[#f97316]/10 text-2xl">
                  {item.icon}
                </div>

                <div className="min-w-0 flex-1">
                  <h3 className="line-clamp-1 text-sm font-bold text-gray-900 transition-colors group-hover:text-[#1e3a5f] sm:text-base">
                    {item.name}
                  </h3>
                  <p className="mt-1 text-xs text-gray-500 sm:text-sm">
                    {item.count !== null ? `${item.count} รายการสินค้า` : item.desc}
                  </p>
                </div>

                <ArrowRight className="h-4 w-4 shrink-0 text-[#f97316] transition-transform group-hover:translate-x-1" />
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-[#06C755]/15 bg-white px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900 sm:text-base">
                ยังไม่เจอหมวดหรือรุ่นที่ต้องการ?
              </p>
              <p className="text-sm text-gray-500">
                ส่งชื่อสินค้า รหัสอะไหล่ หรือรุ่นรถมาทาง LINE แล้วให้ร้านช่วยเช็กให้ได้ทันที
              </p>
            </div>

            <a
              href={LINE_OA_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 self-start rounded-full bg-[#06C755] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#05a847]"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white">
                <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
              </svg>
              สอบถามทาง LINE
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};

export default ProductCategories;
