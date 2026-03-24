"use client";

import { useState } from "react";
import { X } from "lucide-react";

const LINE_OA_URL = "https://lin.ee/18P0SqG";

const FloatingLine = () => {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {/* Tooltip */}
      <div className="flex items-center gap-2 bg-white shadow-lg rounded-full pl-4 pr-2 py-2 border border-gray-100">
        <p className="text-sm font-medium text-gray-700">สอบถามผ่าน LINE</p>
        <button
          onClick={() => setDismissed(true)}
          className="w-5 h-5 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
          aria-label="ปิด"
        >
          <X className="w-3 h-3 text-gray-500" />
        </button>
      </div>

      {/* LINE Button */}
      <a
        href={LINE_OA_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="ติดต่อทาง LINE OA"
        className="w-16 h-16 bg-[#06C755] hover:bg-[#05a847] rounded-full flex items-center justify-center shadow-xl shadow-green-500/30 transition-all hover:scale-110"
      >
        <svg viewBox="0 0 24 24" className="w-9 h-9 fill-white">
          <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.630 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.630 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
        </svg>
      </a>
    </div>
  );
};

export default FloatingLine;
