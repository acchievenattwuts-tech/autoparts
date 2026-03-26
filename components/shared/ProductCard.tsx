import Image from "next/image";
import { MessageCircle } from "lucide-react";

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

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden hover:shadow-lg hover:border-gray-200 transition-all duration-300 group flex flex-col">
      {/* Image */}
      <div className="relative h-44 bg-gradient-to-br from-gray-100 to-gray-50 shrink-0">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            className="object-cover"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-5xl opacity-20">📦</span>
          </div>
        )}
        {!inStock && (
          <span className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-0.5 rounded-full">
            สินค้าหมด
          </span>
        )}
      </div>

      {/* Content */}
      <div className="p-4 flex flex-col flex-1">
        <span className="text-xs text-[#1e3a5f] font-medium bg-[#1e3a5f]/10 px-2 py-0.5 rounded-full self-start">
          {product.category.name}
        </span>
        <h3 className="mt-2 font-bold text-gray-900 text-sm leading-snug group-hover:text-[#1e3a5f] transition-colors line-clamp-2 flex-1">
          {product.name}
        </h3>
        {product.brand && (
          <p className="text-xs text-gray-400 mt-0.5">{product.brand.name}</p>
        )}

        {product.carModels && product.carModels.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {/* Group by brand, show brand name + model names */}
            {(() => {
              const brandMap = new Map<string, string[]>();
              for (const { carModel } of product.carModels) {
                const b = carModel.carBrand.name;
                if (!brandMap.has(b)) brandMap.set(b, []);
                brandMap.get(b)!.push(carModel.name);
              }
              const entries = Array.from(brandMap.entries());
              return entries.map(([brandName, models]) => (
                <span
                  key={brandName}
                  className="inline-flex items-center gap-1 text-[10px] bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full font-medium"
                >
                  🚗 {brandName}
                  {models.length <= 2
                    ? ` › ${models.join(", ")}`
                    : ` › ${models.slice(0, 2).join(", ")} +${models.length - 2}`}
                </span>
              ));
            })()}
          </div>
        )}

        <div className="mt-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">ราคา</p>
            <p className="text-lg font-bold text-[#f97316]">
              ฿{Number(product.salePrice).toLocaleString("th-TH")}
            </p>
          </div>
          <a
            href={lineUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 bg-[#06C755] hover:bg-[#05a847] text-white text-xs font-semibold px-3 py-2 rounded-full transition-all hover:scale-105"
          >
            <MessageCircle size={12} />
            สอบถาม
          </a>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
