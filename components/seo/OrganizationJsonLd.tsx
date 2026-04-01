import type { SiteConfig } from "@/lib/site-config";
import { SITE_NAME, SITE_URL } from "@/lib/seo";
import JsonLd from "./JsonLd";

interface OrganizationJsonLdProps {
  config: Partial<SiteConfig>;
}

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
        sameAs: sameAs.length > 0 ? sameAs : undefined,
      }}
    />
  );
};

export default OrganizationJsonLd;
