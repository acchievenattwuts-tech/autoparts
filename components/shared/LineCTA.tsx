import Image from "next/image";

interface LineCTAProps {
  lineUrl?: string;
  lineId?: string;
}

const LineCTA = ({ lineUrl = "https://lin.ee/18P0SqG", lineId = "@435adwz" }: LineCTAProps) => {
  const LINE_OA_URL = lineUrl;
  const LINE_ID = lineId;
  return (
    <section id="contact" className="py-20 bg-[#1e3a5f] relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-80 h-80 bg-[#f97316] rounded-full opacity-10 blur-3xl translate-x-1/2 -translate-y-1/2" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-[#06C755] rounded-full opacity-10 blur-3xl -translate-x-1/2 translate-y-1/2" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col lg:flex-row items-center justify-between gap-12">
          {/* Left content */}
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 bg-[#06C755]/20 border border-[#06C755]/30 rounded-full px-4 py-1.5 mb-6">
              <span className="w-2 h-2 rounded-full bg-[#06C755] animate-pulse" />
              <span className="text-[#06C755] text-sm font-medium">พร้อมให้บริการทุกวัน</span>
            </div>

            <h2 className="font-kanit text-3xl sm:text-4xl font-bold text-white mb-4 leading-tight">
              สั่งซื้อง่าย ๆ
              <br />
              <span className="text-[#06C755]">ผ่าน LINE OA</span>
            </h2>
            <p className="text-white/70 text-lg mb-8 max-w-md">
              แจ้งยี่ห้อ รุ่น และปีรถ เราจะหาอะไหล่ที่ใช่ให้คุณ พร้อมแจ้งราคาและจัดส่งทันที
            </p>

            <div className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start">
              <a
                href={LINE_OA_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-[#06C755] hover:bg-[#05a847] text-white font-bold px-8 py-4 rounded-full text-lg transition-all hover:scale-105 shadow-lg shadow-green-900/40"
              >
                <svg viewBox="0 0 24 24" className="w-6 h-6 fill-white">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.630 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.630 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                </svg>
                เพิ่มเพื่อนทาง LINE
              </a>
              <a
                href="tel:0800000000"
                className="flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 text-white font-semibold px-8 py-4 rounded-full text-lg transition-all"
              >
                โทรสอบถาม
              </a>
            </div>

            {/* LINE ID */}
            <p className="text-white/50 text-sm mt-4">
              LINE ID: <span className="text-[#06C755] font-medium">{LINE_ID}</span>
            </p>
          </div>

          {/* Right — QR Card */}
          <div className="flex-shrink-0">
            <div className="bg-white rounded-3xl p-8 text-center shadow-2xl w-64">
              {/* QR Code */}
              <div className="w-44 h-44 mx-auto mb-4 relative">
                <Image
                  src="/qr-line.png"
                  alt="QR Code LINE OA ศรีวรรณ อะไหล่แอร์"
                  fill
                  sizes="176px"
                  className="object-contain rounded-xl"
                />
              </div>

              <p className="font-bold text-gray-900 text-sm">ศรีวรรณ อะไหล่แอร์</p>
              <p className="text-[#06C755] text-sm font-medium">{LINE_ID}</p>
              <p className="text-gray-400 text-xs mt-2">สแกน QR เพิ่มเพื่อนทาง LINE</p>
            </div>
          </div>
        </div>

        {/* Steps */}
        <div className="mt-16 grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[
            { step: "1", title: "แจ้งรุ่นรถ", desc: "บอกยี่ห้อ รุ่น และปีรถของคุณ" },
            { step: "2", title: "รับใบเสนอราคา", desc: "เราเช็คสต็อกและส่งราคาให้ทันที" },
            { step: "3", title: "จัดส่งรวดเร็ว", desc: "ชำระเงิน แล้วรอรับสินค้าได้เลย" },
          ].map(({ step, title, desc }) => (
            <div key={step} className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[#f97316] flex items-center justify-center text-white font-bold">
                {step}
              </div>
              <div>
                <p className="text-white font-semibold mb-1">{title}</p>
                <p className="text-white/60 text-sm">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default LineCTA;
