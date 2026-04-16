import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";

const quickAnswers = [
  {
    title: "อะไหล่แอร์รถยนต์มีอะไรบ้าง",
    description:
      "เช่น คอมเพรสเซอร์ คอมแอร์ แผงคอนเดนเซอร์ คอยล์เย็น ท่อแอร์ วาล์ว และอะไหล่ระบบแอร์รถยนต์ที่เกี่ยวข้อง",
  },
  {
    title: "ถ้ายังไม่แน่ใจรุ่นต้องทำอย่างไร",
    description: "ส่งรุ่นรถ ปีรถ รหัสอะไหล่เดิม หรือรูปอะไหล่เดิมให้ร้านเช็กก่อนสั่งซื้อจริง",
  },
  {
    title: "สั่งซื้อจากต่างจังหวัดได้ไหม",
    description: "ค้นหาสินค้าและส่งข้อมูลให้ร้านตรวจสอบก่อน จากนั้นค่อยสรุปรายการและจัดส่งทั่วประเทศ",
  },
];

const nextSteps = [
  {
    title: "ค้นหาสินค้า",
    description: "เริ่มจากชื่อ รหัส หรือรุ่นรถ",
    href: "/products",
  },
  {
    title: "ดูคำถามที่พบบ่อย",
    description: "สรุปเรื่องเช็กสต็อก ความตรงรุ่น และการสั่งซื้อ",
    href: "/faq",
  },
  {
    title: "รู้จักร้าน",
    description: "ดูช่องทางติดต่อและรูปแบบการให้บริการ",
    href: "/about",
  },
];

const SeoIntentSection = () => {
  return (
    <section className="bg-white py-8 sm:py-10">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#f97316]">
                อะไหล่แอร์รถยนต์
              </p>
              <h2 className="mt-3 font-kanit text-2xl font-bold leading-tight text-[#10213d] sm:text-3xl">
                ค้นหาอะไหล่ที่ใกล้เคียงก่อน แล้วให้ร้านช่วยเช็กความตรงรุ่นอีกครั้ง
              </h2>
              <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
                ถ้ายังไม่แน่ใจชื่ออะไหล่หรือรุ่นที่ใช้ได้ ให้ใช้หน้าเว็บเป็นจุดเริ่มต้นในการค้นหา แล้วค่อยส่งรุ่นรถ ปีรถ
                หรือรูปอะไหล่เดิมให้ร้านตรวจสอบก่อนสั่งซื้อจริง
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:w-[360px] lg:grid-cols-1">
              {nextSteps.map((step) => (
                <Link
                  key={step.title}
                  href={step.href}
                  className="flex items-start justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 transition hover:-translate-y-0.5 hover:shadow-sm"
                >
                  <div>
                    <h3 className="font-kanit text-lg font-semibold text-[#10213d]">{step.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{step.description}</p>
                  </div>
                  <div className="mt-1 rounded-full bg-[#f97316]/10 p-2 text-[#f97316]">
                    <ArrowRight className="h-4 w-4" />
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {quickAnswers.map((item) => (
              <div key={item.title} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-xl bg-[#f97316]/10 p-2 text-[#f97316]">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <div>
                    <h3 className="font-kanit text-lg font-semibold text-[#10213d]">{item.title}</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{item.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default SeoIntentSection;
