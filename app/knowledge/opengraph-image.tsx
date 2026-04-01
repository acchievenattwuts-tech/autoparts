import { ImageResponse } from "next/og";
import OgImageTemplate from "@/components/seo/OgImageTemplate";

export const alt = "คลังความรู้ ศรีวรรณ อะไหล่แอร์";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <OgImageTemplate
        eyebrow="คลังความรู้"
        title="บทความที่ช่วยให้หาอะไหล่ได้เร็วขึ้น"
        description="เนื้อหาความรู้เรื่องอะไหล่แอร์และหม้อน้ำรถยนต์ วิธีค้นหา และข้อมูลที่ควรเตรียมก่อนคุยกับร้าน"
        meta="Knowledge"
      />
    ),
    size,
  );
}
