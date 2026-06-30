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
//
// Fonts live OUTSIDE this `[productSlug]` route folder on purpose: the square
// brackets are glob character-class syntax, so an `outputFileTracingIncludes`
// glob pointing into `app/product/[productSlug]/fonts/**` never matches and the
// .ttf files are silently dropped from the lambda (ENOENT at runtime). A
// bracket-free path (lib/og-fonts) lets the trace include actually bundle them.
const FONT_DIR = path.join(process.cwd(), "lib", "og-fonts");

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

  // Track fonts outside the try so the fallback can reuse them when they did load.
  // Passing an explicit font to the rasterizer is essential: with no `fonts`, satori
  // tries to fetch a default font from fonts.googleapis.com at render time — that
  // outbound request has failed in production before.
  let fonts: Awaited<ReturnType<typeof loadFonts>> | undefined;

  try {
    // Load fonts inside the try so any failure (e.g. ENOENT if the .ttf is not
    // bundled into the lambda) flows into the containment fallback below instead
    // of escaping as a 500.
    fonts = await loadFonts();

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
    // Containment: never return a 500 to crawlers if font loading or rasterization
    // fails. Fall back to a minimal plain ASCII image. Reuse the fonts when they
    // loaded; only when font loading itself failed do we omit them (and the text is
    // ASCII-only so satori's default suffices).
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
            fontFamily: fonts ? "Sarabun" : undefined,
          }}
        >
          www.sriwanparts.com
        </div>
      ),
      fonts ? { ...size, fonts } : size,
    );
  }
}
