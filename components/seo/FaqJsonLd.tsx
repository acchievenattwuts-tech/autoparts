import type { FaqItem } from "@/lib/storefront-content";
import JsonLd from "./JsonLd";

interface FaqJsonLdProps {
  items: FaqItem[];
}

const FaqJsonLd = ({ items }: FaqJsonLdProps) => {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer,
          },
        })),
      }}
    />
  );
};

export default FaqJsonLd;
