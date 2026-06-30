import { readFile } from "node:fs/promises";
import path from "node:path";
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
// Read the bundled Thai fonts straight off the filesystem. `fetch(new URL(...,
// import.meta.url))` does not work on Vercel: the .ttf is emitted as a static
// asset and import.meta.url resolves to a relative path (/_next/static/media/...)
// with no origin, so fetch throws ERR_INVALID_URL. `process.cwd()` + a project
// path is the standard next/og pattern and needs no origin/env.
const FONT_DIR = path.join(
  process.cwd(),
  "app",
  "product",
  "[productSlug]",
  "fonts",
);

const loadFonts = async (): Promise<
  { name: string; data: Buffer; weight: 400 | 700; style: "normal" }[]
> => {
  const [kanitBold, sarabunRegular] = await Promise.all([
    readFile(path.join(FONT_DIR, "Kanit-Bold.ttf")),
    readFile(path.join(FONT_DIR, "Sarabun-Regular.ttf")),
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

  // Load fonts up front so the fallback can reuse them. Passing an explicit font
  // to the fallback is essential: with no `fonts`, satori tries to fetch a default
  // font from fonts.googleapis.com at render time — that outbound request was
  // failing in production and turned the "safe" fallback into a 500 as well.
  const fonts = await loadFonts();

  try {
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
    // Fall back to a minimal plain image using the already-loaded fonts.
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
            fontFamily: "Sarabun",
          }}
        >
          www.sriwanparts.com
        </div>
      ),
      { ...size, fonts },
    );
  }
}
