import type { CSSProperties } from "react";
import Image from "next/image";

type BrandLoaderSize = "sm" | "md" | "lg";
type BrandLoaderVariant = "inline" | "overlay" | "page";

// ขนาดวงแหวนแบบ fluid-responsive: clamp(ขั้นต่ำมือถือ, ลื่นตามจอ, สูงสุดเดสก์ท็อป)
// โลโก้คำนวณเป็นสัดส่วนของวงแหวน (LOGO_RATIO) จึงสเกลตามกันทุกขนาดจอ
const SIZE_RING: Record<BrandLoaderSize, string> = {
  sm: "clamp(28px, 8vw, 34px)",
  md: "clamp(44px, 12vw, 56px)",
  lg: "clamp(64px, 17vw, 92px)",
};

const LOGO_RATIO = 0.76;
const RING_THICKNESS_PX = 5;
const RING_SPIN_DURATION = "0.95s";
// ขนาดต้นทางสูงสุดที่ next/image ใช้ optimize (แสดงผลจริงคุมด้วย CSS อีกที)
const LOGO_INTRINSIC_PX = 92;

// วงแหวน gradient ฟ้า-เทอร์ควอยซ์ (เข้าชุดสีโลโก้) ทำงานด้วย CSS ล้วน ไม่มี JS
const RING_BACKGROUND =
  "conic-gradient(from 0deg, rgba(56,189,248,0) 0deg, rgba(56,189,248,0) 60deg, #38bdf8 190deg, #0e7490 330deg, #0e7490 360deg)";
const RING_MASK = `radial-gradient(farthest-side, transparent calc(100% - ${RING_THICKNESS_PX}px), #000 calc(100% - ${RING_THICKNESS_PX}px))`;

interface BrandLoaderProps {
  size?: BrandLoaderSize;
  label?: string;
  variant?: BrandLoaderVariant;
  className?: string;
}

const BrandLoader = ({
  size = "lg",
  label,
  variant = "inline",
  className,
}: BrandLoaderProps) => {
  const ring = SIZE_RING[size];
  const wrapStyle = { "--ring": ring, width: "var(--ring)", height: "var(--ring)" } as CSSProperties;
  const logoStyle: CSSProperties = {
    width: `calc(var(--ring) * ${LOGO_RATIO})`,
    height: `calc(var(--ring) * ${LOGO_RATIO})`,
  };

  const core = (
    <div className={`flex flex-col items-center justify-center gap-3 ${className ?? ""}`}>
      <div className="relative flex items-center justify-center" style={wrapStyle}>
        <div
          className="absolute inset-0 animate-spin rounded-full"
          style={{
            backgroundImage: RING_BACKGROUND,
            WebkitMaskImage: RING_MASK,
            maskImage: RING_MASK,
            animationDuration: RING_SPIN_DURATION,
          }}
        />
        <Image
          src="/logo.webp"
          alt="กำลังโหลด"
          width={LOGO_INTRINSIC_PX}
          height={LOGO_INTRINSIC_PX}
          priority
          sizes="92px"
          className="rounded-full object-contain"
          style={logoStyle}
        />
      </div>
      {label ? (
        <p className="animate-pulse font-sarabun text-xs text-gray-400 sm:text-sm dark:text-gray-500">
          {label}
        </p>
      ) : null}
    </div>
  );

  if (variant === "page") {
    return <div className="flex min-h-[60vh] items-center justify-center px-4">{core}</div>;
  }

  if (variant === "overlay") {
    // halo เรืองแสง: แสงนวลวงกลมจางๆ ฟุ้งรอบโลโก้ (ไม่มีกล่อง/การ์ด)
    // ช่วยให้ loader อ่านออกชัดเมื่อทับ skeleton โดยไม่ดู modal
    return (
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center px-4">
        <div className="rounded-full bg-[radial-gradient(closest-side,rgba(255,255,255,0.92),rgba(255,255,255,0.55)_55%,rgba(255,255,255,0))] p-10 dark:bg-[radial-gradient(closest-side,rgba(15,23,42,0.92),rgba(15,23,42,0.55)_55%,rgba(15,23,42,0))]">
          {core}
        </div>
      </div>
    );
  }

  return core;
};

export default BrandLoader;
