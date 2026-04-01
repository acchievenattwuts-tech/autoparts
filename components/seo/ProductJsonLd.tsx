import JsonLd from "./JsonLd";

interface ProductJsonLdProps {
  name: string;
  description: string;
  imageUrl?: string | null;
  brandName?: string | null;
  sku: string;
  url: string;
  price: number;
  currency?: string;
  inStock: boolean;
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
        brand: brandName
          ? {
              "@type": "Brand",
              name: brandName,
            }
          : undefined,
        offers: {
          "@type": "Offer",
          priceCurrency: currency,
          price,
          availability: inStock
            ? "https://schema.org/InStock"
            : "https://schema.org/OutOfStock",
          url,
        },
      }}
    />
  );
};

export default ProductJsonLd;
