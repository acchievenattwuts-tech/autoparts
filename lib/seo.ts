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
      google: "qHx1Nuwk_fvdAKZ3ulesjza07_2-lYSgzlKabJLOTyg",
    },
    icons: {
      icon: "/icon",
      shortcut: "/icon",
      apple: "/icon",
    },
  };
}
