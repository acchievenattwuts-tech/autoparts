import JsonLd from "./JsonLd";

interface ArticleJsonLdProps {
  title: string;
  description: string;
  url: string;
  datePublished: string;
  dateModified: string;
  imageUrl?: string | null;
  authorName?: string;
  publisherName?: string;
  publisherLogoUrl?: string | null;
  about?: string[];
  mentions?: string[];
}

const ArticleJsonLd = ({
  title,
  description,
  url,
  datePublished,
  dateModified,
  imageUrl,
  authorName = "ศรีวรรณ อะไหล่แอร์",
  publisherName = "ศรีวรรณ อะไหล่แอร์",
  publisherLogoUrl,
  about = [],
  mentions = [],
}: ArticleJsonLdProps) => {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "Article",
        headline: title,
        description,
        url,
        datePublished,
        dateModified,
        image: imageUrl || undefined,
        author: {
          "@type": "Organization",
          name: authorName,
        },
        about:
          about.length > 0
            ? about.map((item) => ({
                "@type": "Thing",
                name: item,
              }))
            : undefined,
        mentions:
          mentions.length > 0
            ? mentions.map((item) => ({
                "@type": "Thing",
                name: item,
              }))
            : undefined,
        publisher: {
          "@type": "Organization",
          name: publisherName,
          logo: publisherLogoUrl
            ? {
                "@type": "ImageObject",
                url: publisherLogoUrl,
              }
            : undefined,
        },
      }}
    />
  );
};

export default ArticleJsonLd;
