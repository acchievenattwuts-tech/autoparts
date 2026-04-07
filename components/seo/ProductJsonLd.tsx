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
  categoryName?: string;
  sellerName?: string;
  additionalProperties?: Array<{
    name: string;
    value: string;
  }>;
  relatedLinks?: string[];
}

const STANDARD_SHIPPING_RATE_THB = 50;

const SHIPPING_DETAILS = {
  "@type": "OfferShippingDetails",
  shippingDestination: {
    "@type": "DefinedRegion",
    addressCountry: "TH",
  },
  shippingRate: {
    "@type": "MonetaryAmount",
    value: STANDARD_SHIPPING_RATE_THB,
    currency: "THB",
  },
  description: "ค่าจัดส่งคิดตามจริง ระยะเวลาจัดส่งโดยประมาณ 1-3 วันทำการ",
  deliveryTime: {
    "@type": "ShippingDeliveryTime",
    businessDays: {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: [
        "https://schema.org/Monday",
        "https://schema.org/Tuesday",
        "https://schema.org/Wednesday",
        "https://schema.org/Thursday",
        "https://schema.org/Friday",
      ],
    },
    handlingTime: {
      "@type": "QuantitativeValue",
      minValue: 0,
      maxValue: 0,
      unitCode: "DAY",
    },
    transitTime: {
      "@type": "QuantitativeValue",
      minValue: 1,
      maxValue: 3,
      unitCode: "DAY",
    },
  },
} as const;

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
          priceCurrency: currency,
          price,
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
          shippingDetails: SHIPPING_DETAILS,
          hasMerchantReturnPolicy: RETURN_POLICY,
        },
      }}
    />
  );
};

export default ProductJsonLd;
