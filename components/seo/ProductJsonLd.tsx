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

const SHIPPING_DETAILS = {
  "@type": "OfferShippingDetails",
  shippingDestination: {
    "@type": "DefinedRegion",
    addressCountry: "TH",
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
  returnFees: "https://schema.org/ReturnShippingFees",
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
          shippingDetails: SHIPPING_DETAILS,
          hasMerchantReturnPolicy: RETURN_POLICY,
        },
      }}
    />
  );
};

export default ProductJsonLd;
