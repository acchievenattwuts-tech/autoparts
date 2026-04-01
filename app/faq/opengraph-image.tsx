import { ImageResponse } from "next/og";
import OgImageTemplate from "@/components/seo/OgImageTemplate";

export const alt = "คำถามที่พบบ่อย ศรีวรรณ อะไหล่แอร์";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <OgImageTemplate
        eyebrow="FAQ"
        title="คำถามที่ลูกค้ามักสงสัย"
        description="รวมคำถามเรื่องการค้นหาอะไหล่ วิธีสั่งซื้อ การเช็กสต็อก การจัดส่ง และช่องทางติดต่อร้าน"
        meta="FAQ"
      />
    ),
    size,
  );
}
