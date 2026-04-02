import {
  ShieldCheck,
  BadgeCheck,
  Truck,
  HeadphonesIcon,
  Tag,
  Clock,
} from "lucide-react";

const reasons = [
  {
    icon: ShieldCheck,
    title: "สินค้าคัดสรรคุณภาพ",
    description:
      "คัดสรรสินค้าคุณภาพเพื่อให้เหมาะกับการใช้งาน และช่วยให้ร้านตรวจสอบรายการได้ง่ายขึ้น",
    color: "bg-blue-50 text-blue-600",
  },
  {
    icon: Tag,
    title: "ราคายุติธรรม",
    description:
      "ราคาหน้าร้านและออนไลน์เดียวกัน ไม่บวกเพิ่ม สามารถต่อราคาได้",
    color: "bg-orange-50 text-orange-500",
  },
  {
    icon: Truck,
    title: "ส่งทั่วประเทศ",
    description:
      "จัดส่งผ่าน Kerry / Flash / J&T พร้อมเลขพัสดุทันที",
    color: "bg-green-50 text-green-600",
  },
  {
    icon: HeadphonesIcon,
    title: "ปรึกษาผู้เชี่ยวชาญ",
    description:
      "ทีมงานมีความรู้เรื่องอะไหล่แอร์รถยนต์โดยเฉพาะ พร้อมให้คำแนะนำ",
    color: "bg-purple-50 text-purple-600",
  },
  {
    icon: BadgeCheck,
    title: "มีสต๊อกพร้อมส่ง",
    description:
      "สินค้าพร้อมส่งมากกว่า 500 รายการ ไม่ต้องรอนาน",
    color: "bg-yellow-50 text-yellow-600",
  },
  {
    icon: Clock,
    title: "บริการรวดเร็ว",
    description:
      "รับออเดอร์ ตอบกลับ และจัดส่งภายในวันเดียวกัน (สั่งก่อนเที่ยง)",
    color: "bg-red-50 text-red-500",
  },
];

const WhyUs = () => {
  return (
    <section id="why-us" className="bg-white py-16 sm:py-18 lg:py-20">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <span className="mb-3 inline-block rounded-full bg-[#f97316]/10 px-4 py-1.5 text-sm font-semibold text-[#f97316]">
            ทำไมต้องเลือกเรา?
          </span>
          <h2 className="mb-3 font-kanit text-3xl font-bold text-gray-900 sm:text-4xl">
            จุดเด่นของ ศรีวรรณ อะไหล่แอร์
          </h2>
          <p className="mx-auto max-w-xl text-lg text-gray-500">
            เราให้ความสำคัญกับคุณภาพสินค้าและความพึงพอใจของลูกค้าเป็นอันดับหนึ่ง
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {reasons.map(({ icon: Icon, title, description, color }) => (
            <div
              key={title}
              className="group flex gap-4 rounded-2xl border border-gray-100 p-6 transition-all duration-300 hover:border-gray-200 hover:shadow-md"
            >
              <div
                className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${color}`}
              >
                <Icon className="h-6 w-6" />
              </div>
              <div>
                <h3 className="mb-1 font-bold text-gray-900">{title}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-14 grid grid-cols-2 gap-6 rounded-2xl bg-[#1e3a5f] p-8 sm:grid-cols-4">
          {[
            { value: "500+", label: "รายการสินค้า" },
            { value: "1,000+", label: "ลูกค้าทั่วประเทศ" },
            { value: "10+", label: "ปีประสบการณ์" },
            { value: "99%", label: "ความพึงพอใจ" },
          ].map(({ value, label }) => (
            <div key={label} className="text-center">
              <p className="text-3xl font-bold text-[#f97316]">{value}</p>
              <p className="mt-1 text-sm text-white/70">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default WhyUs;
