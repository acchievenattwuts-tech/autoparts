import Image from "next/image";
import { Phone, MapPin, Clock, ExternalLink } from "lucide-react";
import type { SiteConfig } from "@/lib/site-config";

interface FooterProps {
  config?: Partial<SiteConfig>;
}

const Footer = ({ config }: FooterProps) => {
  const shopName = config?.shopName ?? "ศรีวรรณ อะไหล่แอร์";
  const shopSlogan = config?.shopSlogan ?? "อะไหล่แอร์และหม้อน้ำรถยนต์";
  const shopPhone = config?.shopPhone ?? "";
  const shopPhoneSecondary = config?.shopPhoneSecondary ?? "";
  const shopAddress = config?.shopAddress ?? "กรุณาติดต่อทาง LINE\nเพื่อนัดรับสินค้า";
  const shopLogoUrl = config?.shopLogoUrl ?? "";
  const lineUrl = config?.shopLineUrl ?? "https://lin.ee/18P0SqG";
  const shopBusinessHours = config?.shopBusinessHours ?? "";
  const shopHolidayNote = config?.shopHolidayNote ?? "";
  const shopContactNote = config?.shopContactNote ?? "";
  const shopGoogleMapUrl = config?.shopGoogleMapUrl ?? "";
  const shopGoogleMapEmbedUrl = config?.shopGoogleMapEmbedUrl ?? "";
  const facebookUrl = config?.shopFacebookUrl ?? "";
  const facebookEnabled = config?.shopFacebookEnabled ?? false;
  const tiktokUrl = config?.shopTiktokUrl ?? "";
  const tiktokEnabled = config?.shopTiktokEnabled ?? false;
  const shopeeUrl = config?.shopShopeeUrl ?? "";
  const shopeeEnabled = config?.shopShopeeEnabled ?? false;
  const lazadaUrl = config?.shopLazadaUrl ?? "";
  const lazadaEnabled = config?.shopLazadaEnabled ?? false;

  return (
    <footer className="bg-gray-900 text-white">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <div className="mb-4 flex items-center gap-3">
              <div className="relative flex h-12 w-28 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white shadow-sm">
                {shopLogoUrl ? (
                  <Image src={shopLogoUrl} alt={`${shopName} logo`} fill sizes="112px" className="object-contain p-2" />
                ) : (
                  <span className="text-sm font-bold text-[#1e3a5f]">ศว</span>
                )}
              </div>
              <div>
                <p className="font-bold text-white">{shopName}</p>
                <p className="text-xs text-[#f97316]">{shopSlogan}</p>
              </div>
            </div>
            <p className="max-w-xs text-sm leading-relaxed text-gray-400">
              ร้านอะไหล่แอร์และหม้อน้ำรถยนต์ครบวงจร พร้อมข้อมูลติดต่อและลิงก์หน้าร้านที่อัปเดตจากหลังบ้านโดยตรง
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <a href={lineUrl} target="_blank" rel="noopener noreferrer" className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#06C755] transition-opacity hover:opacity-80" aria-label="LINE OA">
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white"><path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" /></svg>
              </a>
              {facebookEnabled && facebookUrl && <a href={facebookUrl} target="_blank" rel="noopener noreferrer" className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#1877F2] transition-opacity hover:opacity-80" aria-label="Facebook"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg></a>}
              {tiktokEnabled && tiktokUrl && <a href={tiktokUrl} target="_blank" rel="noopener noreferrer" className="flex h-9 w-9 items-center justify-center rounded-lg bg-black transition-opacity hover:opacity-80" aria-label="TikTok"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-white"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.2 8.2 0 0 0 4.78 1.52V6.74a4.85 4.85 0 0 1-1.01-.05z" /></svg></a>}
              {shopeeEnabled && shopeeUrl && <a href={shopeeUrl} target="_blank" rel="noopener noreferrer" className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#EE4D2D] transition-opacity hover:opacity-80" aria-label="Shopee"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-white"><path d="M12 1a5.33 5.33 0 0 0-5.33 5.33H4.5L3 22h18L19.5 6.33h-2.17A5.33 5.33 0 0 0 12 1zm0 1.67a3.67 3.67 0 0 1 3.67 3.66H8.33A3.67 3.67 0 0 1 12 2.67zM9.5 11a1.5 1.5 0 0 1 1.5 1.5 1.5 1.5 0 0 1-1.5 1.5A1.5 1.5 0 0 1 8 12.5 1.5 1.5 0 0 1 9.5 11zm5 0a1.5 1.5 0 0 1 1.5 1.5 1.5 1.5 0 0 1-1.5 1.5 1.5 1.5 0 0 1-1.5-1.5A1.5 1.5 0 0 1 14.5 11z" /></svg></a>}
              {lazadaEnabled && lazadaUrl && <a href={lazadaUrl} target="_blank" rel="noopener noreferrer" className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#0F146D] transition-opacity hover:opacity-80" aria-label="Lazada"><svg viewBox="0 0 32 32" className="h-5 w-5 fill-white"><path d="M16 2C8.268 2 2 8.268 2 16s6.268 14 14 14 14-6.268 14-14S23.732 2 16 2zm5.5 20h-11v-2h4.5V12h-4.5v-2h11v2h-4v8h4v2z" /></svg></a>}
            </div>
          </div>

          <div>
            <h4 className="mb-4 font-semibold text-white">สินค้า</h4>
            <ul className="space-y-2.5">
              {["คอมเพรสเซอร์แอร์", "หม้อน้ำรถยนต์", "แผงคอนเดนเซอร์", "ท่อและสายแอร์", "อะไหล่อื่น ๆ"].map((item) => (
                <li key={item}>
                  <a href="#categories" className="text-sm text-gray-400 transition-colors hover:text-white">{item}</a>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="mb-4 font-semibold text-white">ติดต่อเรา</h4>
            <ul className="space-y-3">
              {shopPhone && (
                <li className="flex items-start gap-2.5">
                  <Phone className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                  <a href={`tel:${shopPhone}`} className="text-sm text-gray-400 transition-colors hover:text-white">{shopPhone}</a>
                </li>
              )}
              {shopPhoneSecondary && (
                <li className="flex items-start gap-2.5">
                  <Phone className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                  <a href={`tel:${shopPhoneSecondary}`} className="text-sm text-gray-400 transition-colors hover:text-white">{shopPhoneSecondary}</a>
                </li>
              )}
              <li className="flex items-start gap-2.5">
                <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                <p className="whitespace-pre-line text-sm text-gray-400">{shopAddress}</p>
              </li>
              <li className="flex items-start gap-2.5">
                <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                <div className="text-sm text-gray-400">
                  <p className="whitespace-pre-line">{shopBusinessHours || "ยังไม่ได้ระบุเวลาทำการ"}</p>
                  {shopHolidayNote && <p className="mt-1 text-xs text-amber-300">{shopHolidayNote}</p>}
                </div>
              </li>
            </ul>
          </div>
        </div>

        {(shopAddress || shopContactNote || shopHolidayNote || shopGoogleMapUrl || shopGoogleMapEmbedUrl) && (
          <div className="mt-10 grid gap-6 rounded-3xl border border-white/10 bg-white/5 p-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80">
                <MapPin className="h-3.5 w-3.5" />
                ข้อมูลหน้าร้าน
              </div>
              <p className="whitespace-pre-line text-sm leading-7 text-gray-300">{shopAddress}</p>
              {shopHolidayNote && (
                <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
                  <p className="font-semibold">วันหยุด / หมายเหตุหน้าร้าน</p>
                  <p className="mt-1 whitespace-pre-line">{shopHolidayNote}</p>
                </div>
              )}
              {shopContactNote && <p className="mt-4 text-sm leading-6 text-gray-400">{shopContactNote}</p>}
              <div className="mt-4 flex flex-wrap gap-3">
                {shopGoogleMapUrl && (
                  <a href={shopGoogleMapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#1e3a5f] transition-colors hover:bg-[#f3f4f6]">
                    เปิด Google Maps
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <a href={lineUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full bg-[#06C755] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#05a847]">
                  ติดต่อผ่าน LINE
                </a>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#111827]">
              {shopGoogleMapEmbedUrl ? (
                <iframe
                  title={`แผนที่ร้าน ${shopName}`}
                  src={shopGoogleMapEmbedUrl}
                  className="h-64 w-full border-0"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allowFullScreen
                />
              ) : (
                <div className="flex h-64 flex-col items-center justify-center bg-[linear-gradient(135deg,#1e3a5f_0%,#345b87_60%,#f97316_100%)] px-6 text-center text-white">
                  <MapPin className="mb-3 h-10 w-10" />
                  <p className="font-kanit text-xl font-bold">{shopName}</p>
                  <p className="mt-2 text-sm text-white/80">เพิ่ม Google Maps Embed URL ในแอดมินเพื่อให้แผนที่แสดงในส่วนท้ายเว็บ</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-800">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-2 px-4 py-5 sm:flex-row sm:px-6 lg:px-8">
          <p className="text-sm text-gray-500">© {new Date().getFullYear()} {shopName} สงวนลิขสิทธิ์</p>
          <p className="text-xs text-gray-600">{shopSlogan}</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;