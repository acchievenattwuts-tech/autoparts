import { ImageResponse } from "next/og";
import OgImageTemplate from "@/components/seo/OgImageTemplate";

export const alt = "เกี่ยวกับร้านศรีวรรณ อะไหล่แอร์";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <OgImageTemplate
        eyebrow="เกี่ยวกับร้าน"
        title="ข้อมูลร้านและช่องทางติดต่อ"
        description="รู้จักรูปแบบการให้บริการ จุดเด่นของเว็บไซต์ และช่องทางติดต่อร้านเพื่อเช็กสินค้าและสั่งซื้อ"
        meta="About"
      />
    ),
    size,
  );
}
