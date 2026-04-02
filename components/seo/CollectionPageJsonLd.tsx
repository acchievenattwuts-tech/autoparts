import JsonLd from "./JsonLd";

interface CollectionPageJsonLdProps {
  name: string;
  description: string;
  url: string;
}

const CollectionPageJsonLd = ({ name, description, url }: CollectionPageJsonLdProps) => {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name,
        description,
        url,
      }}
    />
  );
};

export default CollectionPageJsonLd;
