import type { Metadata } from "next";

export const SITE_URL = "https://www.sriwanparts.com";
export const ROOT_CANONICAL_URL = SITE_URL;
export const SITE_NAME = "ศรีวรรณ อะไหล่แอร์";
export const LOCAL_SEO_KEYWORDS = [
  "อะไหล่แอร์รถยนต์",
  "ร้านอะไหล่แอร์รถยนต์",
  "ร้านอะไหล่แอร์รถยนต์ นครสวรรค์",
  "หม้อน้ำรถยนต์",
  "อะไหล่หม้อน้ำรถยนต์",
  "ร้านหม้อน้ำรถยนต์",
  "ขายหม้อน้ำรถยนต์",
  "หม้อน้ำรถยนต์ นครสวรรค์",
  "ฝาหม้อน้ำรถยนต์",
  "อะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์",
  "คอมแอร์รถยนต์",
  "คอมเพรสเซอร์แอร์รถยนต์",
  "แผงคอนเดนเซอร์",
  "คอยล์เย็นรถยนต์",
  "ร้านอะไหล่รถยนต์ นครสวรรค์",
  "อะไหล่แอร์รถยนต์ นครสวรรค์",
  "ร้านอะไหล่แอร์ นครสวรรค์",
  "ร้านหม้อน้ำรถยนต์ นครสวรรค์",
  "นครสวรรค์",
  "จังหวัดนครสวรรค์",
];
export const DEFAULT_TITLE = `${SITE_NAME} | อะไหล่แอร์และหม้อน้ำรถยนต์ครบวงจร`;
export const DEFAULT_DESCRIPTION =
  "ร้านอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์ในนครสวรรค์ จำหน่ายคอมเพรสเซอร์ คอมแอร์ แผงคอนเดนเซอร์ ท่อแอร์ และอะไหล่ที่เกี่ยวข้อง พร้อมส่งทั่วประเทศและสั่งซื้อผ่าน LINE OA ได้เลย";

export function absoluteUrl(path = "/"): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  return new URL(path, SITE_URL).toString();
}

// Every satori-generated share card is rendered at exactly this size (the
// `size` export in each opengraph-image route).
export const OG_CARD_WIDTH = 1200;
export const OG_CARD_HEIGHT = 630;

/**
 * Build an `openGraph.images` entry for a satori card route.
 *
 * Declaring width/height matters: pages that set `openGraph.images` themselves
 * override the file-convention metadata Next would otherwise derive from the
 * route's `size` export, so without these the tags ship with no dimensions and
 * a crawler cannot lay the preview out until it has fetched the image.
 *
 * Only use this for the 1200x630 card routes — never for a stored product
 * photo, whose dimensions are whatever was uploaded.
 */
export function buildOgCardImage(
  path: string,
  alt?: string,
): { url: string; width: number; height: number; alt?: string } {
  return {
    url: absoluteUrl(path),
    width: OG_CARD_WIDTH,
    height: OG_CARD_HEIGHT,
    ...(alt ? { alt } : {}),
  };
}

export function buildDefaultMetadataBase(): Metadata {
  return {
    metadataBase: new URL(SITE_URL),
    applicationName: SITE_NAME,
    title: {
      default: DEFAULT_TITLE,
      template: `%s | ${SITE_NAME}`,
    },
    description: DEFAULT_DESCRIPTION,
    keywords: LOCAL_SEO_KEYWORDS,
    alternates: {
      canonical: ROOT_CANONICAL_URL,
    },
    openGraph: {
      type: "website",
      locale: "th_TH",
      url: ROOT_CANONICAL_URL,
      siteName: SITE_NAME,
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
    },
    twitter: {
      card: "summary_large_image",
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
    },
    verification: {
      google: [
        "qHx1Nuwk_fvdAKZ3ulesjza07_2-lYSgzlKabJLOTyg",
        "f0zRvyf1swymzgKQJ1lS9h8BHykmoaO2G8FMNlycIiM",
      ],
    },
    icons: {
      icon: "/icon",
      shortcut: "/icon",
      apple: "/icon",
    },
  };
}
