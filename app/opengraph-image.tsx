import { ImageResponse } from "next/og";
import OgImageTemplate from "@/components/seo/OgImageTemplate";

export const alt = "ศรีวรรณ อะไหล่แอร์";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <OgImageTemplate
        eyebrow="ศรีวรรณ อะไหล่แอร์"
        title="อะไหล่แอร์และหม้อน้ำรถยนต์"
        description="ค้นหาสินค้าได้เร็ว แล้วติดต่อร้านผ่าน LINE OA หรือโทรศัพท์เพื่อเช็กของและสั่งซื้อ"
        meta="หน้าร้านและคลังความรู้"
      />
    ),
    size,
  );
}
