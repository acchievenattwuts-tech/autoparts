import { ADMIN_NAVIGATION } from "@/lib/admin-navigation";
import { db, withDbRetry } from "@/lib/db";

/** จำนวนเมนูโปรดสูงสุดต่อผู้ใช้ — กันแถวบวมและกัน sidebar ยาวเกินจอ */
export const MAX_FAVORITE_MENUS = 20;

const KNOWN_HREFS: ReadonlySet<string> = new Set(
  ADMIN_NAVIGATION.flatMap((section) => section.items.map((item) => item.href)),
);

/** href ต้องมีอยู่จริงใน ADMIN_NAVIGATION เท่านั้น — กันข้อมูลขยะจาก client */
export const isKnownAdminHref = (href: string): boolean => KNOWN_HREFS.has(href);

/**
 * ดึงเมนูโปรดของผู้ใช้ตามลำดับที่ผู้ใช้จัดไว้
 * ตัด href ที่ไม่มีในเมนูปัจจุบันออก (เมนูถูกลบ/เปลี่ยน path) โดยไม่ลบแถวใน DB
 */
export const getFavoriteMenuHrefs = async (userId: string): Promise<string[]> => {
  const rows = await withDbRetry(() =>
    db.userFavoriteMenu.findMany({
      where: { userId },
      select: { href: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      take: MAX_FAVORITE_MENUS,
    }),
  );

  return rows.map((row) => row.href).filter(isKnownAdminHref);
};
