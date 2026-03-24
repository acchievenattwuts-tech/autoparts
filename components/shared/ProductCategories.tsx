import { ArrowRight } from "lucide-react";
import { type Category } from "@/types/product";

const LINE_OA_URL = "https://lin.ee/18P0SqG";

const categories: Category[] = [
  {
    id: "compressor",
    label: "คอมเพรสเซอร์แอร์",
    description: "คอมเพรสเซอร์ทุกยี่ห้อ ทุกรุ่น ทั้งของแท้และเทียบเท่า",
    icon: "❄️",
  },
  {
    id: "radiator",
    label: "หม้อน้ำรถยนต์",
    description: "หม้อน้ำอลูมิเนียม / พลาสติก ครบทุกรุ่นรถ",
    icon: "🌡️",
  },
  {
    id: "condenser",
    label: "แผงคอนเดนเซอร์",
    description: "แผงระบายความร้อนแอร์ คุณภาพสูง ราคาโรงงาน",
    icon: "🔲",
  },
  {
    id: "hose",
    label: "ท่อและสายแอร์",
    description: "ท่อแอร์ สายยางแอร์ ข้อต่อ วาล์ว ครบจบในที่เดียว",
    icon: "🔧",
  },
  {
    id: "other",
    label: "อะไหล่อื่นๆ",
    description: "แมกเนติก คลัทช์ แผงระบายความร้อนหม้อน้ำ และอีกมากมาย",
    icon: "⚙️",
  },
];

const ProductCategories = () => {
  return (
    <section id="categories" className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <span className="inline-block bg-[#1e3a5f]/10 text-[#1e3a5f] text-sm font-semibold px-4 py-1.5 rounded-full mb-3">
            หมวดหมู่สินค้า
          </span>
          <h2 className="font-kanit text-3xl sm:text-4xl font-bold text-gray-900 mb-3">
            อะไหล่ครบ จบในที่เดียว
          </h2>
          <p className="text-gray-500 text-lg max-w-xl mx-auto">
            สต็อกสินค้าพร้อมส่ง ทุกยี่ห้อ ทุกรุ่น ทั้งรถเก๋ง รถกระบะ และรถตู้
          </p>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {categories.map((cat, index) => (
            <a
              key={cat.id}
              href={LINE_OA_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`group relative bg-white rounded-2xl p-6 border border-gray-100 hover:border-[#f97316]/40 hover:shadow-lg transition-all duration-300 cursor-pointer ${
                index === 0 ? "lg:col-span-2" : ""
              }`}
            >
              {/* Icon */}
              <div className="text-4xl mb-4">{cat.icon}</div>

              {/* Content */}
              <h3 className="text-lg font-bold text-gray-900 group-hover:text-[#1e3a5f] transition-colors mb-2">
                {cat.label}
              </h3>
              <p className="text-gray-500 text-sm leading-relaxed mb-4">
                {cat.description}
              </p>

              {/* CTA */}
              <div className="flex items-center gap-1.5 text-[#f97316] text-sm font-semibold">
                สอบถามราคา
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>

              {/* Hover accent */}
              <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#1e3a5f]/0 to-[#f97316]/0 group-hover:from-[#1e3a5f]/3 group-hover:to-[#f97316]/5 transition-all duration-300" />
            </a>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="text-center mt-10">
          <p className="text-gray-500 mb-4">ไม่เจอรุ่นที่ต้องการ? สอบถามเราได้โดยตรง</p>
          <a
            href={LINE_OA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-[#06C755] hover:bg-[#05a847] text-white font-semibold px-6 py-3 rounded-full transition-all hover:scale-105"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
              <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.630 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.630 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
            </svg>
            แจ้งรุ่นรถ สอบถามทาง LINE
          </a>
        </div>
      </div>
    </section>
  );
};

export default ProductCategories;
