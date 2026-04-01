import Image from "next/image";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { getProductPath } from "@/lib/product-slug";

type ProductForCard = {
  id: string;
  name: string;
  code: string;
  imageUrl: string | null;
  salePrice: { toString(): string } | number;
  stock: number;
  reportUnitName: string;
  category: { name: string };
  brand: { name: string } | null;
  carModels?: { carModel: { name: string; carBrand: { name: string } } }[];
};

interface Props {
  product: ProductForCard;
  lineUrl: string;
}

const ProductCard = ({ product, lineUrl }: Props) => {
  const inStock = product.stock > 0;
  const productPath = getProductPath({
    categoryName: product.category.name,
    productName: product.name,
    productId: product.id,
  });

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white transition-all duration-300 hover:border-gray-200 hover:shadow-lg">
      <Link
        href={productPath}
        className="relative h-44 shrink-0 bg-gradient-to-br from-gray-100 to-gray-50"
      >
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-5xl opacity-20">📦</span>
          </div>
        )}
        {!inStock && (
          <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
            สินค้าหมด
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-4">
        <span className="self-start rounded-full bg-[#1e3a5f]/10 px-2 py-0.5 text-xs font-medium text-[#1e3a5f]">
          {product.category.name}
        </span>

        <Link href={productPath} className="mt-2 block flex-1">
          <h3 className="line-clamp-2 text-sm font-bold leading-snug text-gray-900 transition-colors group-hover:text-[#1e3a5f]">
            {product.name}
          </h3>
        </Link>

        {product.brand && <p className="mt-0.5 text-xs text-gray-400">{product.brand.name}</p>}

        {product.carModels && product.carModels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {(() => {
              const brandMap = new Map<string, string[]>();
              for (const { carModel } of product.carModels) {
                const brandName = carModel.carBrand.name;
                if (!brandMap.has(brandName)) {
                  brandMap.set(brandName, []);
                }
                brandMap.get(brandName)?.push(carModel.name);
              }

              return Array.from(brandMap.entries()).map(([brandName, models]) => (
                <span
                  key={brandName}
                  className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700"
                >
                  🚗 {brandName}
                  {models.length <= 2
                    ? ` > ${models.join(", ")}`
                    : ` > ${models.slice(0, 2).join(", ")} +${models.length - 2}`}
                </span>
              ));
            })()}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-gray-400">ราคา</p>
            <p className="text-lg font-bold text-[#f97316]">
              ฿{Number(product.salePrice).toLocaleString("th-TH")}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href={productPath}
              className="rounded-full border border-gray-200 px-3 py-2 text-xs font-semibold text-[#1e3a5f] transition hover:border-[#1e3a5f]"
            >
              ดูรายละเอียด
            </Link>
            <a
              href={lineUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-full bg-[#06C755] px-3 py-2 text-xs font-semibold text-white transition-all hover:scale-105 hover:bg-[#05a847]"
            >
              <MessageCircle size={12} />
              สอบถาม
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
