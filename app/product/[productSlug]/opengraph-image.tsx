import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import OgImageTemplate from "@/components/seo/OgImageTemplate";
import { extractProductIdFromSlug } from "@/lib/product-slug";
import {
  buildStorefrontProductDescription,
  getActiveStorefrontProductById,
} from "@/lib/storefront-product";

export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

interface Props {
  params: Promise<{
    productSlug: string;
  }>;
}

// Load Thai-capable fonts so Satori/resvg can rasterize Thai glyphs.
// Without these, Thai product names produce an SVG that resvg fails to render
// ("svgload_buffer: SVG rendering failed"), causing a 500 on this route.
const loadFonts = async (): Promise<
  { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" }[]
> => {
  const [kanitBold, sarabunRegular] = await Promise.all([
    fetch(new URL("./fonts/Kanit-Bold.ttf", import.meta.url)).then((res) =>
      res.arrayBuffer(),
    ),
    fetch(new URL("./fonts/Sarabun-Regular.ttf", import.meta.url)).then((res) =>
      res.arrayBuffer(),
    ),
  ]);

  return [
    { name: "Kanit", data: kanitBold, weight: 700, style: "normal" },
    { name: "Sarabun", data: sarabunRegular, weight: 400, style: "normal" },
  ];
};

export default async function OpenGraphImage({ params }: Props) {
  const { productSlug } = await params;
  const productId = extractProductIdFromSlug(productSlug);

  if (!productId) {
    notFound();
  }

  const product = await getActiveStorefrontProductById(productId);

  if (!product) {
    notFound();
  }

  try {
    const fonts = await loadFonts();

    return new ImageResponse(
      (
        <OgImageTemplate
          eyebrow={product.category.name}
          title={product.name}
          description={buildStorefrontProductDescription(product)}
          meta={product.brand?.name || product.code}
        />
      ),
      { ...size, fonts },
    );
  } catch (error) {
    // Containment: never return a 500 to crawlers if rasterization fails.
    // Fall back to a minimal plain image (no Thai text / no gradients).
    console.error("[opengraph-image] render failed", error);

    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0f2140",
            color: "white",
            fontSize: 48,
          }}
        >
          www.sriwanparts.com
        </div>
      ),
      size,
    );
  }
}
