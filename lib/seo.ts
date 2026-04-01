import type { Metadata } from "next";

export const SITE_URL = "https://www.sriwanparts.com";
export const SITE_NAME = "ศรีวรรณ อะไหล่แอร์";
export const DEFAULT_TITLE = `${SITE_NAME} | อะไหล่แอร์และหม้อน้ำรถยนต์ครบวงจร`;
export const DEFAULT_DESCRIPTION =
  "ร้านอะไหล่แอร์และหม้อน้ำรถยนต์ทุกยี่ห้อ คอมเพรสเซอร์ หม้อน้ำ แผงคอนเดนเซอร์ ท่อแอร์ ราคายุติธรรม ส่งทั่วประเทศ สั่งซื้อผ่าน LINE OA ได้เลย";

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
    alternates: {
      canonical: absoluteUrl("/"),
    },
    openGraph: {
      type: "website",
      locale: "th_TH",
      url: absoluteUrl("/"),
      siteName: SITE_NAME,
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
    },
    twitter: {
      card: "summary_large_image",
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
    },
    icons: {
      icon: "/icon",
      shortcut: "/icon",
      apple: "/icon",
    },
  };
}
