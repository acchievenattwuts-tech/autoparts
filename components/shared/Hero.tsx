import { ArrowRight, ShieldCheck, Truck, Clock } from "lucide-react";

const LINE_OA_URL = "https://lin.ee/18P0SqG";

const badges = [
  { icon: ShieldCheck, label: "อะไหล่แท้ 100%" },
  { icon: Truck, label: "ส่งทั่วประเทศ" },
  { icon: Clock, label: "บริการรวดเร็ว" },
];

const Hero = () => {
  return (
    <section
      id="home"
      className="relative min-h-screen flex items-center bg-gradient-to-br from-[#1e3a5f] via-[#1e3a5f] to-[#0f2140] overflow-hidden"
    >
      {/* Background Pattern */}
      <div className="absolute inset-0 opacity-5">
        <div className="absolute top-0 left-0 w-full h-full"
          style={{
            backgroundImage: "radial-gradient(circle at 2px 2px, white 1px, transparent 0)",
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      {/* Orange accent blob */}
      <div className="absolute top-1/4 right-0 w-96 h-96 bg-[#f97316] rounded-full opacity-10 blur-3xl translate-x-1/2" />
      <div className="absolute bottom-0 left-1/4 w-64 h-64 bg-[#f97316] rounded-full opacity-5 blur-2xl" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left Content */}
          <div>
            {/* Tag */}
            <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/20 rounded-full px-4 py-1.5 mb-6">
              <span className="w-2 h-2 rounded-full bg-[#f97316] animate-pulse" />
              <span className="text-white/90 text-sm font-medium">อะไหล่แอร์และหม้อน้ำรถยนต์</span>
            </div>

            <h1 className="font-kanit text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-4">
              ศรีวรรณ
              <br />
              <span className="text-[#f97316]">อะไหล่แอร์</span>
            </h1>
            <p className="text-white/70 text-lg sm:text-xl leading-relaxed mb-8">
              ครบครันทุกอะไหล่แอร์และหม้อน้ำรถยนต์ทุกยี่ห้อ
              <br className="hidden sm:block" />
              ราคายุติธรรม สินค้าแท้ ส่งตรงถึงมือคุณ
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 mb-10">
              <a
                href="#categories"
                className="flex items-center justify-center gap-2 bg-[#f97316] hover:bg-[#ea6c0a] text-white font-semibold px-6 py-3.5 rounded-full transition-all hover:scale-105 shadow-lg shadow-orange-500/30"
              >
                ดูสินค้าทั้งหมด
                <ArrowRight className="w-4 h-4" />
              </a>
              <a
                href={LINE_OA_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-[#06C755] hover:bg-[#05a847] text-white font-semibold px-6 py-3.5 rounded-full transition-all hover:scale-105 shadow-lg shadow-green-500/30"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.630 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.630 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                </svg>
                สั่งซื้อผ่าน LINE OA
              </a>
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-3">
              {badges.map(({ icon: Icon, label }) => (
                <div
                  key={label}
                  className="flex items-center gap-2 bg-white/10 backdrop-blur-sm border border-white/10 rounded-full px-4 py-2"
                >
                  <Icon className="w-4 h-4 text-[#f97316]" />
                  <span className="text-white/80 text-sm">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right — Stat Cards */}
          <div className="hidden lg:grid grid-cols-2 gap-4">
            <div className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl p-6 col-span-2">
              <p className="text-white/60 text-sm mb-1">สินค้าในสต็อก</p>
              <p className="text-white text-4xl font-bold">500+</p>
              <p className="text-white/60 text-sm mt-1">รายการอะไหล่</p>
            </div>
            <div className="bg-[#f97316]/20 backdrop-blur-sm border border-[#f97316]/30 rounded-2xl p-6">
              <p className="text-white/60 text-sm mb-1">ลูกค้าทั่วประเทศ</p>
              <p className="text-[#f97316] text-4xl font-bold">1K+</p>
              <p className="text-white/60 text-sm mt-1">ความไว้วางใจ</p>
            </div>
            <div className="bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl p-6">
              <p className="text-white/60 text-sm mb-1">ประสบการณ์</p>
              <p className="text-white text-4xl font-bold">10+</p>
              <p className="text-white/60 text-sm mt-1">ปีในวงการ</p>
            </div>
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 animate-bounce">
        <div className="w-0.5 h-8 bg-white/30 rounded-full" />
      </div>
    </section>
  );
};

export default Hero;
