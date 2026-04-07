import type { SiteConfig } from "@/lib/site-config";
import { LOCAL_SEO_KEYWORDS, SITE_NAME, SITE_URL } from "@/lib/seo";
import JsonLd from "./JsonLd";

interface OrganizationJsonLdProps {
  config: Partial<SiteConfig>;
}

const RETURN_POLICY = {
  "@type": "MerchantReturnPolicy",
  applicableCountry: "TH",
  returnPolicyCountry: "TH",
  returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
  merchantReturnDays: 15,
  returnMethod: "https://schema.org/ReturnByMail",
  returnFees: "https://schema.org/ReturnFeesCustomerResponsibility",
  itemCondition: "https://schema.org/NewCondition",
  description: "รับคืนภายใน 15 วัน โดยสินค้าต้องอยู่ในสภาพเดิมและลูกค้ารับผิดชอบค่าส่งคืน",
} as const;

const OrganizationJsonLd = ({ config }: OrganizationJsonLdProps) => {
  const sameAs = [
    config.shopFacebookEnabled && config.shopFacebookUrl ? config.shopFacebookUrl : null,
    config.shopTiktokEnabled && config.shopTiktokUrl ? config.shopTiktokUrl : null,
    config.shopShopeeEnabled && config.shopShopeeUrl ? config.shopShopeeUrl : null,
    config.shopLazadaEnabled && config.shopLazadaUrl ? config.shopLazadaUrl : null,
    config.shopLineUrl || null,
  ].filter(Boolean);

  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "Organization",
        name: config.shopName || SITE_NAME,
        url: SITE_URL,
        logo: config.shopLogoUrl || undefined,
        telephone: config.shopPhone || undefined,
        email: config.shopEmail || undefined,
        description:
          "ร้านอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์ในนครสวรรค์ พร้อมให้ลูกค้าค้นหาสินค้าผ่านเว็บไซต์และติดต่อร้านผ่าน LINE OA หรือโทรศัพท์",
        keywords: LOCAL_SEO_KEYWORDS.join(", "),
        sameAs: sameAs.length > 0 ? sameAs : undefined,
        hasMerchantReturnPolicy: RETURN_POLICY,
      }}
    />
  );
};

export default OrganizationJsonLd;
