import type { ProductZoomImage } from "@/components/shared/ProductImageZoomLightbox";

/**
 * รวมรูปหลัก (Product.imageUrl) เข้ากับรูปในแกลเลอรี (Product.images) ให้เป็นชุดเดียว
 * สำหรับส่งเข้า ProductImageZoomLightbox — ใช้ร่วมกันทุกหน้าที่เปิด popup รูปสินค้า
 * เพื่อให้ลำดับรูปและการกันรูปซ้ำเหมือนกันทั้งระบบ
 */
export function buildProductZoomImages(
  imageUrl: string | null | undefined,
  images: { url: string; alt: string | null }[] | undefined,
  fallbackAlt: string,
): ProductZoomImage[] {
  const gallery: ProductZoomImage[] =
    images?.map((image) => ({ url: image.url, alt: image.alt ?? fallbackAlt })) ?? [];

  if (!imageUrl) return gallery;
  if (gallery.some((image) => image.url === imageUrl)) return gallery;

  return [{ url: imageUrl, alt: fallbackAlt }, ...gallery];
}
