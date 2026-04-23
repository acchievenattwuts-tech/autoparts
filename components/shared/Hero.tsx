import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock, Phone, Truck } from "lucide-react";

const badges = [
  { icon: Truck, label: "ส่งทั่วประเทศ" },
  { icon: Clock, label: "เช็กราคาเร็ว" },
];

const orderSteps = [
  {
    title: "ส่งรุ่นรถ ปีรถ หรือรูปอะไหล่",
    detail: "ถ้าไม่รู้ชื่ออะไหล่ ส่งรูปเดิมหรืออาการเสียมาได้",
  },
  {
    title: "ร้านเช็กความตรงรุ่นและแจ้งราคา",
    detail: "ยืนยันข้อมูลให้ก่อนทุกครั้ง เพื่อช่วยลดการสั่งผิดรุ่น",
  },
  {
    title: "ยืนยันรายการแล้วค่อยชำระเงิน",
    detail: "เมื่อสรุปรายการเรียบร้อย ร้านจะแจ้งการชำระเงินและจัดส่งสินค้า",
  },
];

const prepItems = ["รุ่นรถ / ปีรถ", "ชื่ออะไหล่หรืออาการเสีย", "รูปอะไหล่เดิม", "รหัสอะไหล่ (ถ้ามี)"];

interface HeroProps {
  lineUrl?: string;
  shopPhone?: string;
  shopName?: string;
}

const Hero = ({
  lineUrl = "https://lin.ee/18P0SqG",
  shopPhone,
  shopName = "ศรีวรรณ อะไหล่แอร์",
}: HeroProps) => {
  return (
    <section id="home" className="relative min-h-screen overflow-hidden">
      <Image
        src="/hero-banner2.jpg"
        alt="hero background"
        fill
        sizes="100vw"
        fetchPriority="high"
        loading="eager"
        className="object-cover object-center"
      />
      <div className="absolute inset-0 bg-[#0f2140]/65" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.22),transparent_32%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.1),transparent_28%)]" />

      <div className="relative mx-auto flex min-h-screen max-w-7xl items-center px-4 pb-16 pt-24 sm:px-6 lg:px-8">
        <div className="grid w-full items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)] lg:gap-12">
          <div className="max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-1.5 backdrop-blur-md">
              <span className="h-2 w-2 rounded-full bg-[#f97316]" />
              <span className="text-sm font-medium text-white/90">เช็กความตรงรุ่นก่อนสั่งทุกครั้ง</span>
            </div>

            <h1 className="font-kanit text-4xl font-bold leading-[0.98] text-white sm:text-5xl lg:text-7xl">
              สั่งอะไหล่แอร์รถยนต์ง่าย ๆ
              <br />
              <span className="text-[#f97316]">ไม่แน่ใจรุ่นก็ทักมาถามได้</span>
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/78 sm:text-lg lg:text-xl">
              เริ่มจากส่งรุ่นรถ ปีรถ หรือรูปอะไหล่มาให้ร้านเช็กก่อน แล้วร้านจะแจ้งรุ่นที่ตรง ราคา และขั้นตอนจัดส่งให้ทันที
            </p>

            <div className="mt-4 rounded-2xl border border-white/12 bg-[#13284a]/45 px-4 py-3 shadow-lg shadow-black/10 backdrop-blur-sm lg:hidden">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#f7a35e] sm:text-xs">
                ร้านพร้อมให้คำแนะนำ
              </p>
              <p className="mt-1 font-kanit text-xl font-bold leading-tight text-[#ffe1bf] sm:text-2xl">
                {shopName}
              </p>
              <p className="mt-1 text-xs leading-5 text-white/72 sm:text-sm">
                เช็กความตรงรุ่น แจ้งราคา และช่วยยืนยันก่อนสั่งทุกครั้ง
              </p>
            </div>

            <div className="mt-5 rounded-3xl border border-white/12 bg-white/8 p-4 backdrop-blur-sm lg:hidden">
              <p className="text-sm font-semibold text-white">วิธีสั่งซื้อ</p>
              <div className="mt-3 space-y-2.5">
                {orderSteps.map((step, index) => (
                  <div key={step.title} className="rounded-2xl border border-white/10 bg-[#1b3357]/45 px-4 py-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#f97316]">
                      Step {index + 1}
                    </p>
                    <p className="mt-1 text-sm font-medium text-white">{step.title}</p>
                    <p className="mt-1 text-xs leading-6 text-white/65">{step.detail}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <a
                href={lineUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#06C755] px-6 py-3.5 font-semibold text-white transition-all hover:scale-[1.02] hover:bg-[#05a847] shadow-lg shadow-green-500/30"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.630 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.630 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                </svg>
                ส่งข้อมูลให้ร้านเช็กทาง LINE
              </a>
              <Link
                href="/products"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#f97316] px-6 py-3.5 font-semibold text-white transition-all hover:scale-[1.02] hover:bg-[#ea6c0a] shadow-lg shadow-orange-500/30"
              >
                ดูสินค้าทั้งหมด
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-5 rounded-3xl border border-white/12 bg-white/8 p-4 backdrop-blur-sm">
              <p className="text-sm font-semibold text-white">ก่อนทักร้าน เตรียมข้อมูลเหล่านี้ได้เลย</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {prepItems.map((item) => (
                  <span
                    key={item}
                    className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#1b3357]/45 px-3 py-2 text-sm text-white/82"
                  >
                    <CheckCircle2 className="h-4 w-4 text-[#f97316]" />
                    {item}
                  </span>
                ))}
              </div>
              {shopPhone && (
                <p className="mt-3 flex items-center gap-2 text-sm text-white/72">
                  <Phone className="h-4 w-4 text-[#f97316]" />
                  ถ้าพิมพ์ไม่สะดวก โทรสอบถามร้านได้ที่ {shopPhone}
                </p>
              )}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              {badges.map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 backdrop-blur-sm"
                >
                  <Icon className="h-4 w-4 text-[#f97316]" />
                  <span className="text-sm text-white/80">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="hidden lg:block">
            <div className="ml-auto max-w-md">
              <div className="mb-5 rounded-[28px] border border-white/12 bg-[#13284a]/52 px-6 py-5 shadow-xl shadow-black/15 backdrop-blur-md">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#f7a35e]">
                  ร้านพร้อมให้คำแนะนำ
                </p>
                <p className="mt-2 font-kanit text-3xl font-bold leading-tight text-[#ffe1bf] xl:text-[2.35rem]">
                  {shopName}
                </p>
                <p className="mt-2 text-sm leading-6 text-white/72">
                  เช็กความตรงรุ่น แจ้งราคา และช่วยยืนยันก่อนสั่งทุกครั้ง
                </p>
              </div>

              <div className="rounded-[32px] border border-white/15 bg-white/10 p-6 shadow-2xl shadow-black/20 backdrop-blur-xl">
                <p className="font-kanit text-2xl font-semibold text-white">วิธีสั่งซื้อ</p>
                <p className="mt-3 text-sm leading-7 text-white/70">
                  ถ้าไม่แน่ใจว่าต้องใช้รุ่นไหน ไม่จำเป็นต้องเดาเอง ส่งข้อมูลมาให้ร้านเช็กก่อนแล้วค่อยสั่งซื้อ
                </p>
                <div className="mt-6 space-y-3">
                  {orderSteps.map((step, index) => (
                    <div
                      key={step.title}
                      className={`rounded-2xl border border-white/10 px-4 py-3 ${
                        index === 0 ? "bg-[#1b3357]/55" : "bg-white/8"
                      }`}
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#f97316]">
                        Step {index + 1}
                      </p>
                      <p className="mt-1 text-sm font-medium text-white">{step.title}</p>
                      <p className="mt-1 text-sm text-white/60">{step.detail}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 hidden -translate-x-1/2 animate-bounce flex-col items-center gap-1 lg:flex">
        <div className="h-8 w-0.5 rounded-full bg-white/30" />
      </div>
    </section>
  );
};

export default Hero;
