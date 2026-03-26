import Link from "next/link";
import ProductCard from "@/components/shared/ProductCard";
import { db } from "@/lib/db";
import { ArrowRight } from "lucide-react";

interface Props {
  lineUrl: string;
}

const FeaturedProducts = async ({ lineUrl }: Props) => {
  const products = await db.product.findMany({
    where: { isActive: true, stock: { gt: 0 } },
    include: {
      category: { select: { name: true } },
      brand: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 6,
  });

  if (products.length === 0) return null;

  return (
    <section id="products" className="py-20 bg-white">
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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {products.map((product) => (
            <ProductCard key={product.id} product={product} lineUrl={lineUrl} />
          ))}
        </div>

        <div className="text-center mt-10">
          <Link
            href="/products"
            className="inline-flex items-center gap-2 bg-[#1e3a5f] hover:bg-[#163055] text-white font-semibold px-6 py-3 rounded-full transition-all hover:scale-105"
          >
            ดูสินค้าทั้งหมด
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </section>
  );
};

export default FeaturedProducts;
