import JsonLd from "./JsonLd";
import { toPublicStorageCdnPath } from "@/lib/product-image-url";
import { absoluteUrl } from "@/lib/seo";

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
  const articleImageUrl = imageUrl ? absoluteUrl(toPublicStorageCdnPath(imageUrl) ?? imageUrl) : undefined;
  const publisherLogoSrc = publisherLogoUrl
    ? absoluteUrl(toPublicStorageCdnPath(publisherLogoUrl) ?? publisherLogoUrl)
    : undefined;

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
        image: articleImageUrl,
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
          logo: publisherLogoSrc
            ? {
                "@type": "ImageObject",
                url: publisherLogoSrc,
              }
            : undefined,
        },
      }}
    />
  );
};

export default ArticleJsonLd;
