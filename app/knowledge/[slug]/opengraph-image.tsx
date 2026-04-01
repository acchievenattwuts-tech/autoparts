import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import OgImageTemplate from "@/components/seo/OgImageTemplate";
import { knowledgeArticleMap, knowledgeArticles } from "@/lib/knowledge-content";

export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

interface Props {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return knowledgeArticles.map((article) => ({
    slug: article.slug,
  }));
}

export default async function OpenGraphImage({ params }: Props) {
  const { slug } = await params;
  const article = knowledgeArticleMap.get(slug);

  if (!article) {
    notFound();
  }

  return new ImageResponse(
    (
      <OgImageTemplate
        eyebrow={article.category}
        title={article.title}
        description={article.description}
        meta={`อ่าน ${article.readingMinutes} นาที`}
      />
    ),
    size,
  );
}
