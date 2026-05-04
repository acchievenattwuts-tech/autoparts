import { PackageSearch, Search } from "lucide-react";

import LiffBottomNav from "@/components/liff/LiffBottomNav";
import { db } from "@/lib/db";
import { requireLiffCustomer } from "@/lib/liff-data";
import { searchProductIds, sortProductsByIds } from "@/lib/product-search";

const money = (value: unknown) =>
  Number(value ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export default async function LiffProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireLiffCustomer();
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const result = await searchProductIds({
    query,
    isActive: true,
    take: 30,
    order: "createdAtDesc",
  });
  const products = result.ids.length
    ? sortProductsByIds(
        await db.product.findMany({
          where: { id: { in: result.ids }, isActive: true },
          select: {
            id: true,
            code: true,
            name: true,
            salePrice: true,
            stock: true,
            imageUrl: true,
            category: { select: { name: true } },
            brand: { select: { name: true } },
          },
        }),
        result.ids,
      )
    : [];

  return (
    <main className="min-h-dvh pb-24">
      <section className="bg-slate-950 px-5 pb-6 pt-6 text-white">
        <p className="text-sm text-teal-100">ค้นหาสินค้า</p>
        <h1 className="mt-1 font-kanit text-2xl font-bold">อะไหล่แอร์รถยนต์</h1>
      </section>

      <section className="px-5 py-5">
        <form action="/liff/products" className="mb-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
            <input
              name="q"
              defaultValue={query}
              placeholder="ค้นหาชื่อสินค้า รุ่นรถ หรือรหัส"
              className="w-full rounded-lg border border-slate-300 bg-white py-3 pl-9 pr-3 text-sm outline-none focus:border-teal-700 focus:ring-2 focus:ring-teal-100"
            />
          </div>
          <button className="rounded-lg bg-slate-950 px-4 py-3 text-sm font-bold text-white">
            ค้นหา
          </button>
        </form>

        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-kanit text-lg font-bold text-slate-950">ผลการค้นหา</h2>
          <span className="text-xs text-slate-500">{result.total} รายการ</span>
        </div>

        <div className="space-y-3">
          {products.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-500">
              {query ? "ไม่พบสินค้าที่ตรงกับการค้นหา" : "พิมพ์ชื่อสินค้า รหัส หรือรุ่นรถเพื่อค้นหา"}
            </div>
          ) : (
            products.map((product) => (
              <article key={product.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex gap-3">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                    <PackageSearch size={24} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-slate-950">{product.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {product.code ?? "-"} · {product.category?.name ?? "ไม่ระบุหมวด"}
                    </p>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <p className="font-bold text-teal-800">{money(product.salePrice)} บาท</p>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                        คงเหลือ {Number(product.stock ?? 0).toLocaleString("th-TH")}
                      </span>
                    </div>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
      <LiffBottomNav active="/liff/products" />
    </main>
  );
}
