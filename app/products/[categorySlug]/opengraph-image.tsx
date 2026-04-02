import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import OgImageTemplate from "@/components/seo/OgImageTemplate";
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

export default async function CategoryOpenGraphImage({ params }: Props) {
  const { categorySlug } = await params;
  const category = await getActiveStorefrontCategoryBySlug(categorySlug).catch(() => null);

  if (!category) {
    notFound();
  }

  return new ImageResponse(
    (
      <OgImageTemplate
        eyebrow="หมวดสินค้าอะไหล่แอร์รถยนต์"
        title={category.name}
        description="ร้านอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์ในนครสวรรค์ พร้อมค้นหาและสอบถามร้านผ่าน LINE OA"
      />
    ),
    size,
  );
}
