import JsonLd from "./JsonLd";

interface ProductJsonLdProps {
  name: string;
  description: string;
  imageUrl?: string | null;
  brandName?: string | null;
  sku: string;
  url: string;
  /** ราคา — ส่ง null/undefined เพื่อซ่อนราคาออกจาก structured data */
  price?: number | null;
  currency?: string;
  inStock: boolean;
  categoryName?: string;
  sellerName?: string;
  additionalProperties?: Array<{
    name: string;
    value: string;
  }>;
  relatedLinks?: string[];
}

const ProductJsonLd = ({
  name,
  description,
  imageUrl,
  brandName,
  sku,
  url,
  price,
  currency = "THB",
  inStock,
  categoryName,
  sellerName,
  additionalProperties = [],
  relatedLinks = [],
}: ProductJsonLdProps) => {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "Product",
        name,
        description,
        sku,
        image: imageUrl || undefined,
        category: categoryName,
        itemCondition: "https://schema.org/NewCondition",
        brand: brandName
          ? {
              "@type": "Brand",
              name: brandName,
            }
          : undefined,
        additionalProperty:
          additionalProperties.length > 0
            ? additionalProperties.map((property) => ({
                "@type": "PropertyValue",
                name: property.name,
                value: property.value,
              }))
            : undefined,
        isRelatedTo:
          relatedLinks.length > 0
            ? relatedLinks.map((link) => ({
                "@type": "WebPage",
                url: link,
              }))
            : undefined,
        offers: {
          "@type": "Offer",
          priceCurrency: price != null ? currency : undefined,
          price: price != null ? price : undefined,
          availability: inStock
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          url,
          itemCondition: "https://schema.org/NewCondition",
          seller: sellerName
            ? {
                "@type": "AutoPartsStore",
                name: sellerName,
              }
            : undefined,
        },
      }}
    />
  );
};

export default ProductJsonLd;
