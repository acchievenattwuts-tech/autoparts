import { Phone, MapPin, Clock } from "lucide-react";

const LINE_OA_URL = "https://lin.ee/18P0SqG";

const Footer = () => {
  return (
    <footer className="bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
          {/* Brand */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-10 h-10 rounded-lg bg-[#1e3a5f] border border-[#f97316]/40 flex items-center justify-center">
                <span className="text-white font-bold text-sm">ศว</span>
              </div>
              <div>
                <p className="font-bold text-white">ศรีวรรณ อะไหล่แอร์</p>
                <p className="text-[#f97316] text-xs">อะไหล่แอร์และหม้อน้ำรถยนต์</p>
              </div>
            </div>
            <p className="text-gray-400 text-sm leading-relaxed max-w-xs">
              ร้านอะไหล่แอร์และหม้อน้ำรถยนต์ครบวงจร ประสบการณ์กว่า 10 ปี
              บริการทั้งปลีกและส่ง ทั่วประเทศไทย
            </p>
            {/* Social */}
            <div className="flex gap-3 mt-5">
              <a
                href={LINE_OA_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 rounded-lg bg-[#06C755] flex items-center justify-center hover:opacity-80 transition-opacity"
                aria-label="LINE OA"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
                  <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.630 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.630 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
                </svg>
              </a>
              <a
                href="#"
                className="w-9 h-9 rounded-lg bg-[#1877F2] flex items-center justify-center hover:opacity-80 transition-opacity"
                aria-label="Facebook"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              </a>
            </div>
          </div>

          {/* Links */}
          <div>
            <h4 className="font-semibold text-white mb-4">สินค้า</h4>
            <ul className="space-y-2.5">
              {[
                "คอมเพรสเซอร์แอร์",
                "หม้อน้ำรถยนต์",
                "แผงคอนเดนเซอร์",
                "ท่อและสายแอร์",
                "อะไหล่อื่น ๆ",
              ].map((item) => (
                <li key={item}>
                  <a
                    href="#categories"
                    className="text-gray-400 hover:text-white text-sm transition-colors"
                  >
                    {item}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="font-semibold text-white mb-4">ติดต่อเรา</h4>
            <ul className="space-y-3">
              <li className="flex items-start gap-2.5">
                <Phone className="w-4 h-4 text-[#f97316] mt-0.5 flex-shrink-0" />
                <div>
                  <a href="tel:0800000000" className="text-gray-400 hover:text-white text-sm transition-colors">
                    080-000-0000
                  </a>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <MapPin className="w-4 h-4 text-[#f97316] mt-0.5 flex-shrink-0" />
                <p className="text-gray-400 text-sm">
                  กรุณาติดต่อทาง LINE
                  <br />เพื่อนัดรับสินค้า
                </p>
              </li>
              <li className="flex items-start gap-2.5">
                <Clock className="w-4 h-4 text-[#f97316] mt-0.5 flex-shrink-0" />
                <div className="text-gray-400 text-sm">
                  <p>จันทร์ – เสาร์</p>
                  <p>08:00 – 18:00 น.</p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-gray-500 text-sm">
            © {new Date().getFullYear()} ศรีวรรณ อะไหล่แอร์ — สงวนลิขสิทธิ์
          </p>
          <p className="text-gray-600 text-xs">
            อะไหล่แอร์และหม้อน้ำรถยนต์ทุกยี่ห้อ
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
