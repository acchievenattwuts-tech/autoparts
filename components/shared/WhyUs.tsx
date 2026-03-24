import { ShieldCheck, BadgeCheck, Truck, HeadphonesIcon, Tag, Clock } from "lucide-react";

const reasons = [
  {
    icon: ShieldCheck,
    title: "อะไหล่แท้ 100%",
    description: "คัดสรรสินค้าคุณภาพจากโรงงานผู้ผลิตโดยตรง รับประกันทุกชิ้น",
    color: "bg-blue-50 text-blue-600",
  },
  {
    icon: Tag,
    title: "ราคายุติธรรม",
    description: "ราคาหน้าร้านและออนไลน์เดียวกัน ไม่บวกเพิ่ม สามารถต่อราคาได้",
    color: "bg-orange-50 text-orange-500",
  },
  {
    icon: Truck,
    title: "ส่งทั่วประเทศ",
    description: "จัดส่งผ่าน Kerry / Flash / J&T พร้อมเลขพัสดุทันที",
    color: "bg-green-50 text-green-600",
  },
  {
    icon: HeadphonesIcon,
    title: "ปรึกษาผู้เชี่ยวชาญ",
    description: "ทีมงานมีความรู้เรื่องอะไหล่แอร์รถยนต์โดยเฉพาะ พร้อมให้คำแนะนำ",
    color: "bg-purple-50 text-purple-600",
  },
  {
    icon: BadgeCheck,
    title: "มีสต็อกพร้อมส่ง",
    description: "สินค้าพร้อมส่งมากกว่า 500 รายการ ไม่ต้องรอนาน",
    color: "bg-yellow-50 text-yellow-600",
  },
  {
    icon: Clock,
    title: "บริการรวดเร็ว",
    description: "รับออเดอร์ ตอบกลับ และจัดส่งภายในวันเดียวกัน (สั่งก่อนเที่ยง)",
    color: "bg-red-50 text-red-500",
  },
];

const WhyUs = () => {
  return (
    <section id="why-us" className="py-20 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <span className="inline-block bg-[#f97316]/10 text-[#f97316] text-sm font-semibold px-4 py-1.5 rounded-full mb-3">
            ทำไมต้องเลือกเรา?
          </span>
          <h2 className="font-kanit text-3xl sm:text-4xl font-bold text-gray-900 mb-3">
            จุดเด่นของ ศรีวรรณ อะไหล่แอร์
          </h2>
          <p className="text-gray-500 text-lg max-w-xl mx-auto">
            เราให้ความสำคัญกับคุณภาพสินค้าและความพึงพอใจของลูกค้าเป็นอันดับหนึ่ง
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {reasons.map(({ icon: Icon, title, description, color }) => (
            <div
              key={title}
              className="group flex gap-4 p-6 rounded-2xl border border-gray-100 hover:border-gray-200 hover:shadow-md transition-all duration-300"
            >
              <div className={`flex-shrink-0 w-12 h-12 rounded-xl ${color} flex items-center justify-center`}>
                <Icon className="w-6 h-6" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 mb-1">{title}</h3>
                <p className="text-gray-500 text-sm leading-relaxed">{description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom stat bar */}
        <div className="mt-14 grid grid-cols-2 sm:grid-cols-4 gap-6 bg-[#1e3a5f] rounded-2xl p-8">
          {[
            { value: "500+", label: "รายการสินค้า" },
            { value: "1,000+", label: "ลูกค้าทั่วประเทศ" },
            { value: "10+", label: "ปีประสบการณ์" },
            { value: "99%", label: "ความพึงพอใจ" },
          ].map(({ value, label }) => (
            <div key={label} className="text-center">
              <p className="text-3xl font-bold text-[#f97316]">{value}</p>
              <p className="text-white/70 text-sm mt-1">{label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default WhyUs;
