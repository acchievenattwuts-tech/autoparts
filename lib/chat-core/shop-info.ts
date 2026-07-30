import type { SiteConfig } from "@/lib/site-config";

export function buildChatShopInfoMessage(config: SiteConfig): string {
  const contacts = [config.shopPhone, config.shopPhoneSecondary].filter(Boolean).join(" / ");
  const lines = [
    `🔧 ${config.shopName || "ศรีวรรณ อะไหล่แอร์"} ยินดีให้บริการค่ะ`,
    config.shopAddress ? `📍 ที่อยู่: ${config.shopAddress}` : null,
    config.shopGoogleMapUrl ? `🗺️ แผนที่ร้าน: ${config.shopGoogleMapUrl}` : null,
    contacts ? `📞 โทรสอบถาม: ${contacts}` : null,
    config.shopBusinessHours ? `🕐 เวลาทำการ: ${config.shopBusinessHours}` : null,
    config.shopHolidayNote ? `📅 หมายเหตุวันหยุด: ${config.shopHolidayNote}` : null,
    config.shopContactNote || null,
    "🚚 มีบริการจัดส่งทั่วประเทศ โดยค่าจัดส่งจริงต้องให้แอดมินประเมินจากสินค้าและปลายทางค่ะ",
    "",
    "หากต้องการให้จูนช่วยค้นหาอะไหล่ กรุณาส่งยี่ห้อ/รุ่นรถ ปีรถ ชื่ออะไหล่ และรูปอะไหล่เดิม (ถ้ามี) ในแชตนี้ได้เลยค่ะ 😊",
  ];
  return lines.filter((line): line is string => line !== null).join("\n").trim();
}
