import { MessageCircle } from "lucide-react";
import { type Product } from "@/types/product";

const LINE_OA_URL = "https://lin.ee/18P0SqG";

const products: Product[] = [
  {
    id: "1",
    name: "คอมเพรสเซอร์แอร์ Toyota Hilux Vigo",
    description: "คอมแอร์แท้เทียบเท่า OEM รับประกัน 6 เดือน",
    price: "3,500",
    category: "compressor",
    badge: "ขายดี",
  },
  {
    id: "2",
    name: "หม้อน้ำ Honda Civic FD 2006-2012",
    description: "หม้อน้ำอลูมิเนียม คุณภาพสูง ระบายความร้อนได้ดีเยี่ยม",
    price: "2,800",
    category: "radiator",
    badge: "ใหม่",
  },
  {
    id: "3",
    name: "แผงคอนเดนเซอร์ Isuzu D-Max",
    description: "แผงคอนเดนเซอร์แท้เทียบเท่า ติดตั้งง่าย",
    price: "2,200",
    category: "condenser",
  },
  {
    id: "4",
    name: "คอมเพรสเซอร์แอร์ Ford Ranger T6",
    description: "คอมแอร์คุณภาพดี พร้อมน้ำมันและฟิลเตอร์",
    price: "4,200",
    category: "compressor",
    badge: "โปรโมชัน",
  },
  {
    id: "5",
    name: "หม้อน้ำ Toyota Fortuner",
    description: "หม้อน้ำอลูมิเนียมคุณภาพสูง ทนทาน ใช้งานได้ยาวนาน",
    price: "3,100",
    category: "radiator",
  },
  {
    id: "6",
    name: "ท่อแอร์สายสูง-สายต่ำ Universal",
    description: "ท่อแอร์คุณภาพสูง ทนทานต่อแรงดัน ไม่รั่วซึม",
    price: "850",
    category: "hose",
  },
];

const badgeStyles: Record<string, string> = {
  ขายดี: "bg-red-500 text-white",
  ใหม่: "bg-blue-500 text-white",
  โปรโมชัน: "bg-[#f97316] text-white",
};

const categoryEmoji: Record<string, string> = {
  compressor: "❄️",
  radiator: "🌡️",
  condenser: "🔲",
  hose: "🔧",
  other: "⚙️",
};

const FeaturedProducts = () => {
  return (
    <section id="products" className="py-20 bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <span className="inline-block bg-[#1e3a5f]/10 text-[#1e3a5f] text-sm font-semibold px-4 py-1.5 rounded-full mb-3">
            สินค้าแนะนำ
          </span>
          <h2 className="font-kanit text-3xl sm:text-4xl font-bold text-gray-900 mb-3">
            สินค้าขายดีประจำร้าน
          </h2>
          <p className="text-gray-500 text-lg">
            สอบถามราคาและสั่งซื้อได้ทันทีผ่าน LINE OA
          </p>
        </div>

        {/* Products Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((product) => (
            <div
              key={product.id}
              className="group bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-lg hover:border-gray-200 transition-all duration-300"
            >
              {/* Image placeholder */}
              <div className="relative h-44 bg-gradient-to-br from-gray-100 to-gray-50 flex items-center justify-center">
                <span className="text-6xl">{categoryEmoji[product.category]}</span>
                {product.badge && (
                  <span className={`absolute top-3 right-3 text-xs font-bold px-2.5 py-1 rounded-full ${badgeStyles[product.badge] ?? "bg-gray-200 text-gray-700"}`}>
                    {product.badge}
                  </span>
                )}
              </div>

              {/* Content */}
              <div className="p-5">
                <h3 className="font-bold text-gray-900 mb-1 group-hover:text-[#1e3a5f] transition-colors leading-snug">
                  {product.name}
                </h3>
                <p className="text-gray-500 text-sm mb-3 leading-relaxed">{product.description}</p>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-400">ราคาเริ่มต้น</p>
                    <p className="text-xl font-bold text-[#f97316]">฿{product.price}</p>
                  </div>
                  <a
                    href={LINE_OA_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 bg-[#06C755] hover:bg-[#05a847] text-white text-sm font-semibold px-4 py-2 rounded-full transition-all hover:scale-105"
                  >
                    <MessageCircle className="w-4 h-4" />
                    สอบถาม
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>

        <p className="text-center text-gray-400 text-sm mt-8">
          * ราคาอาจเปลี่ยนแปลงตามต้นทุน สอบถามราคาปัจจุบันทาง LINE OA
        </p>
      </div>
    </section>
  );
};

export default FeaturedProducts;
