export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import Navbar from "@/components/shared/Navbar";
import Footer from "@/components/shared/Footer";
import ProductCard from "@/components/shared/ProductCard";
import FloatingLine from "@/components/shared/FloatingLine";
import Link from "next/link";
import { Search } from "lucide-react";

interface Props {
  searchParams: Promise<{ q?: string; category?: string }>;
}

const ProductsPage = async ({ searchParams }: Props) => {
  const { q, category } = await searchParams;
  const config = await getSiteConfig();

  const searchWhere = q?.trim()
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { code: { contains: q, mode: "insensitive" as const } },
          { description: { contains: q, mode: "insensitive" as const } },
          { aliases: { some: { alias: { contains: q, mode: "insensitive" as const } } } },
          { carModels: { some: { carModel: { name: { contains: q, mode: "insensitive" as const } } } } },
          { carModels: { some: { carModel: { carBrand: { name: { contains: q, mode: "insensitive" as const } } } } } },
          { category: { name: { contains: q, mode: "insensitive" as const } } },
          { brand: { name: { contains: q, mode: "insensitive" as const } } },
        ],
      }
    : {};

  const categoryWhere = category ? { category: { name: category } } : {};

  const [products, categories] = await Promise.all([
    db.product.findMany({
      where: { isActive: true, ...searchWhere, ...categoryWhere },
      include: {
        category: { select: { name: true } },
        brand: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.category.findMany({ orderBy: { name: "asc" } }),
  ]);

  const buildHref = (overrides: { q?: string; category?: string }) => {
    const params = new URLSearchParams();
    const newQ = overrides.q ?? q;
    const newCat = "category" in overrides ? overrides.category : category;
    if (newQ?.trim()) params.set("q", newQ);
    if (newCat) params.set("category", newCat);
    const qs = params.toString();
    return `/products${qs ? `?${qs}` : ""}`;
  };

  return (
    <>
      <Navbar
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        lineUrl={config.shopLineUrl}
        shopPhone={config.shopPhone}
      />
      <main className="min-h-screen bg-gray-50 pt-16">
        {/* Hero bar */}
        <div className="bg-[#1e3a5f] py-10">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h1 className="font-kanit text-3xl font-bold text-white mb-5">สินค้าทั้งหมด</h1>
            <form method="GET" action="/products" className="flex gap-2 max-w-xl">
              <div className="relative flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  name="q"
                  defaultValue={q ?? ""}
                  placeholder="ค้นหาสินค้า ชื่อ รหัส ยี่ห้อรถ รุ่นรถ..."
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-white/30"
                />
                {category && <input type="hidden" name="category" value={category} />}
              </div>
              <button
                type="submit"
                className="px-5 py-2.5 bg-[#f97316] hover:bg-[#ea6c0a] text-white font-medium text-sm rounded-xl transition-colors"
              >
                ค้นหา
              </button>
            </form>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {/* Category tabs */}
          <div className="flex gap-2 flex-wrap mb-6">
            <Link
              href={buildHref({ category: undefined })}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                !category
                  ? "bg-[#1e3a5f] text-white"
                  : "bg-white text-gray-600 border border-gray-200 hover:border-[#1e3a5f] hover:text-[#1e3a5f]"
              }`}
            >
              ทั้งหมด
            </Link>
            {categories.map((cat) => (
              <Link
                key={cat.id}
                href={buildHref({ category: cat.name })}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  category === cat.name
                    ? "bg-[#1e3a5f] text-white"
                    : "bg-white text-gray-600 border border-gray-200 hover:border-[#1e3a5f] hover:text-[#1e3a5f]"
                }`}
              >
                {cat.name}
              </Link>
            ))}
          </div>

          {/* Result count */}
          <p className="text-sm text-gray-500 mb-5">
            {q || category ? (
              <>
                {q && <>ค้นหา &ldquo;{q}&rdquo;{category ? ` ใน ${category}` : ""} —{" "}</>}
                {!q && category && <>{category} — </>}
                พบ <span className="font-semibold text-gray-800">{products.length}</span> รายการ
              </>
            ) : (
              <>สินค้าทั้งหมด <span className="font-semibold text-gray-800">{products.length}</span> รายการ</>
            )}
          </p>

          {/* Products grid */}
          {products.length === 0 ? (
            <div className="text-center py-24 text-gray-400">
              <p className="text-lg mb-2">ไม่พบสินค้าที่ค้นหา</p>
              <Link href="/products" className="text-[#1e3a5f] text-sm underline">
                ดูสินค้าทั้งหมด
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} lineUrl={config.shopLineUrl} />
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer config={config} />
      <FloatingLine lineUrl={config.shopLineUrl} />
    </>
  );
};

export default ProductsPage;
