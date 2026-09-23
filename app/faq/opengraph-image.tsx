import OgImageTemplate from "@/components/seo/OgImageTemplate";
import { renderOgCard } from "@/lib/og-render";

export const alt = "คำถามที่พบบ่อย ศรีวรรณ อะไหล่แอร์";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

// Bundled Thai fonts + containment via the shared OG renderer (lib/og-render.tsx).
export default function OpenGraphImage(): Promise<Response> {
  return renderOgCard(
    (
      <OgImageTemplate
        eyebrow="FAQ"
        title="คำถามที่ลูกค้ามักสงสัย"
        description="รวมคำถามเรื่องการค้นหาอะไหล่ วิธีสั่งซื้อ การเช็กสต็อก การจัดส่ง และช่องทางติดต่อร้าน"
        meta="FAQ"
      />
    ),
    "opengraph-image:faq",
  );
}
