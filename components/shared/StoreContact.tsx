import { Clock, ExternalLink, Mail, MapPin, Phone } from "lucide-react";
import type { SiteConfig } from "@/lib/site-config";

interface StoreContactProps {
  config: SiteConfig;
}

const StoreContact = ({ config }: StoreContactProps) => {
  const contactItems = [
    {
      key: "phone",
      icon: Phone,
      label: "โทรศัพท์",
      value: config.shopPhone,
      href: config.shopPhone ? `tel:${config.shopPhone}` : "",
    },
    {
      key: "phone-secondary",
      icon: Phone,
      label: "เบอร์สำรอง",
      value: config.shopPhoneSecondary,
      href: config.shopPhoneSecondary ? `tel:${config.shopPhoneSecondary}` : "",
    },
    {
      key: "email",
      icon: Mail,
      label: "อีเมล",
      value: config.shopEmail,
      href: config.shopEmail ? `mailto:${config.shopEmail}` : "",
    },
    {
      key: "hours",
      icon: Clock,
      label: "เวลาทำการ",
      value: config.shopBusinessHours,
      href: "",
    },
  ].filter((item) => item.value);

  return (
    <section id="contact" className="bg-[#f8fafc] py-20">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8">
        <div>
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-[#1e3a5f]/8 px-4 py-1.5 text-sm font-medium text-[#1e3a5f]">
            <MapPin className="h-4 w-4" />
            ข้อมูลหน้าร้าน
          </div>
          <h2 className="font-kanit text-3xl font-bold text-gray-900 sm:text-4xl">
            ติดต่อร้านและเช็กเส้นทางได้ทันที
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-gray-600">
            รวมข้อมูลติดต่อหลักของร้าน สำหรับลูกค้าที่ต้องการเช็กเบอร์โทร เวลาทำการ แผนที่
            และหมายเหตุการเดินทางก่อนเข้าร้าน
          </p>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {contactItems.map(({ key, icon: Icon, label, value, href }) => (
              <div key={key} className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#1e3a5f] text-white">
                  <Icon className="h-5 w-5" />
                </div>
                <p className="text-sm font-semibold text-gray-500">{label}</p>
                {href ? (
                  <a href={href} className="mt-1 block text-base font-medium text-gray-900 hover:text-[#1e3a5f]">
                    {value}
                  </a>
                ) : (
                  <p className="mt-1 whitespace-pre-line text-base font-medium text-gray-900">{value}</p>
                )}
              </div>
            ))}
          </div>

          {(config.shopAddress || config.shopHolidayNote || config.shopContactNote || config.shopGoogleMapUrl) && (
            <div className="mt-6 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
              {config.shopAddress && (
                <div className="flex items-start gap-3">
                  <MapPin className="mt-1 h-5 w-5 flex-shrink-0 text-[#f97316]" />
                  <div>
                    <p className="text-sm font-semibold text-gray-500">ที่อยู่ร้าน</p>
                    <p className="mt-1 whitespace-pre-line text-base text-gray-800">{config.shopAddress}</p>
                  </div>
                </div>
              )}

              {config.shopHolidayNote && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
                  <p className="font-semibold">วันหยุด / หมายเหตุหน้าร้าน</p>
                  <p className="mt-1 whitespace-pre-line">{config.shopHolidayNote}</p>
                </div>
              )}

              {config.shopContactNote && (
                <p className="mt-4 border-t border-dashed border-gray-200 pt-4 text-sm leading-6 text-gray-600">
                  {config.shopContactNote}
                </p>
              )}

              <div className="mt-5 flex flex-wrap gap-3">
                {config.shopGoogleMapUrl && (
                  <a
                    href={config.shopGoogleMapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full border border-[#1e3a5f]/15 bg-white px-4 py-2 text-sm font-medium text-[#1e3a5f] transition-colors hover:border-[#1e3a5f] hover:bg-[#1e3a5f] hover:text-white"
                  >
                    เปิด Google Maps
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                {config.shopLineUrl && (
                  <a
                    href={config.shopLineUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-full bg-[#06C755] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#05a847]"
                  >
                    ติดต่อผ่าน LINE
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-[2rem] border border-gray-200 bg-white p-3 shadow-xl shadow-[#1e3a5f]/10">
          {config.shopGoogleMapEmbedUrl ? (
            <iframe
              title={`แผนที่ร้าน ${config.shopName}`}
              src={config.shopGoogleMapEmbedUrl}
              className="h-[420px] w-full rounded-[1.4rem] border-0"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          ) : (
            <div className="flex h-[420px] flex-col items-center justify-center rounded-[1.4rem] bg-[linear-gradient(135deg,#1e3a5f_0%,#345b87_60%,#f97316_100%)] p-8 text-center text-white">
              <MapPin className="mb-4 h-12 w-12" />
              <p className="font-kanit text-2xl font-bold">{config.shopName}</p>
              <p className="mt-3 max-w-sm text-sm leading-6 text-white/80">
                เพิ่ม Google Maps Embed URL เมื่อต้องการให้แผนที่แสดงบนหน้าบ้านตรงนี้
              </p>
              {config.shopGoogleMapUrl && (
                <a
                  href={config.shopGoogleMapUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#1e3a5f]"
                >
                  เปิดเส้นทาง
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default StoreContact;
