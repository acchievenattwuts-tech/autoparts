import type { SiteConfig } from "@/lib/site-config";

export function buildChatShopInfoMessage(config: SiteConfig): string {
  const contacts = [config.shopPhone, config.shopPhoneSecondary].filter(Boolean).join(" / ");
  const lines = [
    `🔧 ${config.shopName || "ศรีวรรณ อะไหล่แอร์"} ยินดีให้บริการค่ะ`,
    config.shopBusinessHours ? `🕐 เปิดบริการ: ${config.shopBusinessHours}` : null,
    contacts ? `📞 โทรสอบถาม: ${contacts}` : null,
    config.shopAddress ? `📍 ที่อยู่: ${config.shopAddress}` : null,
    config.shopGoogleMapUrl ? `🗺️ แผนที่ร้าน: ${config.shopGoogleMapUrl}` : null,
    config.shopHolidayNote ? `📅 หมายเหตุวันหยุด: ${config.shopHolidayNote}` : null,
    config.shopContactNote || null,
    "",
    "ถ้าต้องการให้จูนช่วยค้นหาอะไหล่แอร์หรือหม้อน้ำรถยนต์ รบกวนแจ้ง 3 อย่างนี้",
    "เดี๋ยวจูนค้นให้ทันทีเลยค่ะ 👇",
    "1️⃣ ยี่ห้อ / รุ่นรถ (เช่น Toyota Vios 2020)",
    "2️⃣ อะไหล่ที่ต้องการ (เช่น คอมเพรสเซอร์, แผงร้อน, ตู้แอร์, หม้อน้ำ)",
    "3️⃣ รูปอะไหล่เก่า (ถ้ามี จะช่วยให้ระบุรุ่นแม่นขึ้น)",
  ];
  return lines.filter((line): line is string => line !== null).join("\n").trim();
}
