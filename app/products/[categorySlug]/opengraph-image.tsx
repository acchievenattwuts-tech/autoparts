import { notFound } from "next/navigation";
import OgImageTemplate from "@/components/seo/OgImageTemplate";
import { renderOgCard, stripOgEmoji } from "@/lib/og-render";
import { getActiveStorefrontCategoryBySlug } from "@/lib/storefront-category";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

interface Props {
  params: Promise<{
    categorySlug: string;
  }>;
}

export default async function CategoryOpenGraphImage({ params }: Props): Promise<Response> {
  const { categorySlug } = await params;
  const category = await getActiveStorefrontCategoryBySlug(categorySlug).catch(() => null);

  if (!category) {
    notFound();
  }

  // Bundled Thai fonts + containment via the shared OG renderer (lib/og-render.tsx):
  // a Thai category name no longer depends on a render-time Google Fonts fetch,
  // and a rasterization failure degrades to a fallback card instead of a 500.
  return renderOgCard(
    (
      <OgImageTemplate
        eyebrow="หมวดสินค้าอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์"
        title={stripOgEmoji(category.name)}
        description="ร้านอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์ในนครสวรรค์ พร้อมค้นหาและสอบถามร้านผ่าน LINE OA"
      />
    ),
    "opengraph-image:category",
  );
}
