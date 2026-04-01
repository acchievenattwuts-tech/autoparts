import { SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/seo";
import JsonLd from "./JsonLd";

const WebSiteJsonLd = () => {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: SITE_NAME,
        url: SITE_URL,
        potentialAction: {
          "@type": "SearchAction",
          target: `${absoluteUrl("/products")}?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      }}
    />
  );
};

export default WebSiteJsonLd;
