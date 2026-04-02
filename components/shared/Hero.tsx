import Image from "next/image";
import { ArrowRight, Clock, Search, Truck } from "lucide-react";

const badges = [
  { icon: Truck, label: "ส่งทั่วประเทศ" },
  { icon: Clock, label: "บริการรวดเร็ว" },
];

interface HeroProps {
  heroTitle?: string;
  heroSubtitle?: string;
  lineUrl?: string;
}

const Hero = ({
  heroTitle = "ศรีวรรณ อะไหล่แอร์",
  heroSubtitle = "อะไหล่แอร์และหม้อน้ำรถยนต์ทุกยี่ห้อ คุณภาพดี ราคายุติธรรม",
  lineUrl = "https://lin.ee/18P0SqG",
}: HeroProps) => {
  const [titleMain, titleSub] = heroTitle.includes(" ")
    ? [heroTitle.split(" ").slice(0, -1).join(" "), heroTitle.split(" ").slice(-1)[0]]
    : [heroTitle, ""];

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
              <span className="text-sm font-medium text-white/90">อะไหล่แอร์และหม้อน้ำรถยนต์</span>
            </div>

            <h1 className="font-kanit text-4xl font-bold leading-[0.95] text-white sm:text-5xl lg:text-7xl">
              {titleMain}
              {titleSub && (
                <>
                  <br />
                  <span className="text-[#f97316]">{titleSub}</span>
                </>
              )}
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/75 sm:text-lg lg:text-xl">
              {heroSubtitle}
            </p>

            <div className="mt-8 rounded-[28px] border border-white/15 bg-white/10 p-4 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-5">
              <div className="mb-3 flex items-start gap-3">
                <div className="mt-0.5 rounded-2xl bg-[#f97316]/15 p-2 text-[#f97316]">
                  <Search className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-kanit text-xl font-semibold text-white sm:text-2xl">
                    ค้นหาอะไหล่แบบเต็มระบบ
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-white/70 sm:text-base">
                    ค้นได้จากชื่อสินค้า รหัสอะไหล่ รุ่นรถ ยี่ห้อรถ หมวดสินค้า และคำที่ลูกค้าใช้เรียก
                  </p>
                </div>
              </div>

              <form action="/products" method="GET" className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row">
                  <label className="sr-only" htmlFor="hero-search">
                    ค้นหาสินค้า
                  </label>
                  <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <input
                      id="hero-search"
                      type="text"
                      name="q"
                      placeholder="เช่น คอมแอร์ Denso, Toyota Camry, แผงคอนเดนเซอร์..."
                      className="h-14 w-full rounded-2xl border border-white/20 bg-white px-12 text-[15px] text-slate-900 shadow-sm outline-none transition focus:border-[#f97316] focus:ring-4 focus:ring-[#f97316]/15"
                    />
                  </div>
                  <button
                    type="submit"
                    className="inline-flex h-14 items-center justify-center gap-2 rounded-2xl bg-[#f97316] px-6 font-semibold text-white transition hover:bg-[#ea6c0a] sm:min-w-[164px]"
                  >
                    ค้นหาสินค้า
                    <ArrowRight className="h-4 w-4" />
                  </button>
                </div>

                <p className="px-1 text-xs text-white/60 sm:text-sm">
                  ลูกค้าค้นหาเองได้ทันที แล้วกดติดต่อร้านผ่าน LINE OA หรือโทรเพื่อเช็กของและปิดการสั่งซื้อได้เลย
                </p>
              </form>
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <a
                href="/products"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#f97316] px-6 py-3.5 font-semibold text-white transition-all hover:scale-[1.02] hover:bg-[#ea6c0a] shadow-lg shadow-orange-500/30"
              >
                ดูสินค้าทั้งหมด
                <ArrowRight className="h-4 w-4" />
              </a>
              <a
                href={lineUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full bg-[#06C755] px-6 py-3.5 font-semibold text-white transition-all hover:scale-[1.02] hover:bg-[#05a847] shadow-lg shadow-green-500/30"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.630 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.630 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                </svg>
                สั่งซื้อผ่าน LINE OA
              </a>
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
            <div className="ml-auto max-w-md rounded-[32px] border border-white/15 bg-white/10 p-6 shadow-2xl shadow-black/20 backdrop-blur-xl">
              <p className="font-kanit text-2xl font-semibold text-white">
                ค้นหาเองได้เร็ว แล้วคุยกับร้านได้ต่อทันที
              </p>
              <p className="mt-3 text-sm leading-7 text-white/70">
                หน้าเว็บถูกออกแบบมาเพื่อช่วยลูกค้าหาสินค้าให้เจอเร็วที่สุด ก่อนต่อไปยังช่องทางติดต่อหลักของร้านอย่าง LINE OA และโทรศัพท์
              </p>
              <div className="mt-6 space-y-3">
                <div className="rounded-2xl border border-white/10 bg-[#1b3357]/55 px-4 py-3">
                  <p className="text-sm font-medium text-white">ค้นจากชื่อหรือรหัสอะไหล่</p>
                  <p className="mt-1 text-sm text-white/60">เหมาะกับลูกค้าที่มีข้อมูลสินค้าอยู่แล้ว</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
                  <p className="text-sm font-medium text-white">ค้นจากยี่ห้อรถและรุ่นรถ</p>
                  <p className="mt-1 text-sm text-white/60">ช่วยลดเวลาถามตอบและพาลูกค้าไปหาสินค้าที่เกี่ยวข้องได้เร็ว</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/8 px-4 py-3">
                  <p className="text-sm font-medium text-white">ปิดการขายผ่าน LINE OA</p>
                  <p className="mt-1 text-sm text-white/60">เหมาะกับ workflow ร้านที่ต้องการความสะดวกและรวดเร็ว</p>
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
