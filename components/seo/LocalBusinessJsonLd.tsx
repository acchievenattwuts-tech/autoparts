import type { SiteConfig } from "@/lib/site-config";
import { LOCAL_SEO_KEYWORDS, SITE_NAME, SITE_URL } from "@/lib/seo";
import JsonLd from "./JsonLd";

interface LocalBusinessJsonLdProps {
  config: Partial<SiteConfig>;
}

const LocalBusinessJsonLd = ({ config }: LocalBusinessJsonLdProps) => {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "AutoPartsStore",
        name: config.shopName || SITE_NAME,
        url: SITE_URL,
        image: config.shopLogoUrl || undefined,
        logo: config.shopLogoUrl || undefined,
        telephone: config.shopPhone || undefined,
        email: config.shopEmail || undefined,
        address: config.shopAddress
          ? {
              "@type": "PostalAddress",
              streetAddress: config.shopAddress,
              addressCountry: "TH",
            }
          : undefined,
        openingHours: config.shopBusinessHours || undefined,
        hasMap: config.shopGoogleMapUrl || undefined,
        areaServed: ["นครสวรรค์", "จังหวัดนครสวรรค์", "Thailand"],
        description:
          config.heroSubtitle ||
          "ร้านอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์ในนครสวรรค์ พร้อมบริการค้นหาสินค้าและติดต่อร้านผ่าน LINE OA หรือโทรศัพท์",
        keywords: LOCAL_SEO_KEYWORDS.join(", "),
      }}
    />
  );
};

export default LocalBusinessJsonLd;
