import JsonLd from "./JsonLd";

interface CollectionPageJsonLdProps {
  name: string;
  description: string;
  url: string;
  itemListElements?: Array<{
    name: string;
    url: string;
    image?: string;
  }>;
}

const CollectionPageJsonLd = ({
  name,
  description,
  url,
  itemListElements = [],
}: CollectionPageJsonLdProps) => {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name,
        description,
        url,
        mainEntity:
          itemListElements.length > 0
            ? {
                "@type": "ItemList",
                numberOfItems: itemListElements.length,
                itemListElement: itemListElements.map((item, index) => ({
                  "@type": "ListItem",
                  position: index + 1,
                  item: {
                    "@type": "WebPage",
                    name: item.name,
                    url: item.url,
                    image: item.image || undefined,
                  },
                })),
              }
            : undefined,
      }}
    />
  );
};

export default CollectionPageJsonLd;
