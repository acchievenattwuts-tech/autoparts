import Image from "next/image";
import { toPublicStorageCdnPath } from "@/lib/product-image-url";
import { STOREFRONT_LINE_PRIMARY_BUTTON_CLASS } from "@/lib/storefront-line-theme";

const LINE_ICON = (
  <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 fill-white" aria-hidden="true">
    <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63.346 0 .628.285.628.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.348 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314" />
  </svg>
);

interface Props {
  shopName: string;
  lineId: string;
  lineUrl: string;
  lineQrUrl: string;
  shopPhone: string;
}

/**
 * LINE OA call-to-action, home2 edition.
 *
 * Same content and full-bleed layout as the storefront's <LineCTA/>; the
 * decorative orange glow is swapped for blue, since orange stays reserved for
 * prices. LINE green is kept, being the brand's own colour.
 */
const Home2LineCta = ({ shopName, lineId, lineUrl, lineQrUrl, shopPhone }: Props) => {
  if (!lineUrl && !lineId) return null;

  const lineQrSrc = toPublicStorageCdnPath(lineQrUrl) ?? lineQrUrl ?? "";

  // Full-bleed band: breaks out of the page's card rhythm and sits flush
  // against the footer, matching the storefront's own LINE CTA.
  return (
    <section className="mt-3 w-full">
      <div className="relative overflow-hidden bg-[#1e3a5f] px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 h-72 w-72 translate-x-1/3 -translate-y-1/3 rounded-full bg-[#2563eb] opacity-25 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-0 left-0 h-60 w-60 -translate-x-1/3 translate-y-1/3 rounded-full bg-[#06C755] opacity-10 blur-3xl"
        />

        <div className="relative mx-auto flex max-w-7xl flex-col items-center gap-10 lg:flex-row lg:justify-between">
          <div className="text-center lg:text-left">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#06C755]/30 bg-[#06C755]/15 px-3.5 py-1.5">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#06C755]" />
              <span className="text-xs font-medium text-[#06C755] sm:text-sm">
                พร้อมให้บริการทุกวัน
              </span>
            </div>

            <h2 className="mb-4 font-kanit text-3xl font-bold leading-tight text-white sm:text-4xl">
              สั่งซื้อง่าย ๆ
              <br />
              <span className="text-[#06C755]">ผ่าน LINE OA</span>
            </h2>

            <p className="max-w-md text-base text-white/70 sm:text-lg">
              แจ้งยี่ห้อ รุ่น และปีรถ เราจะช่วยหาอะไหล่ที่ใช้ได้ให้คุณ พร้อมแจ้งราคาและการจัดส่งทันที
            </p>
            <p className="mt-3 text-sm font-medium text-white/80">{shopName}</p>

            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
              {lineUrl && (
                <a
                  href={lineUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${STOREFRONT_LINE_PRIMARY_BUTTON_CLASS} px-8 py-4 text-lg font-bold`}
                >
                  {LINE_ICON}
                  เพิ่มเพื่อนทาง LINE
                </a>
              )}
              <a
                href={shopPhone ? `tel:${shopPhone}` : lineUrl}
                target={shopPhone ? undefined : "_blank"}
                rel={shopPhone ? undefined : "noopener noreferrer"}
                className="flex items-center justify-center gap-2 rounded-full border border-white/20 bg-white/10 px-8 py-4 text-lg font-semibold text-white transition-colors hover:bg-white/20"
              >
                โทรสอบถาม
              </a>
            </div>

            {lineId && (
              <p className="mt-4 text-xs text-white/50 sm:text-sm">
                LINE ID: <span className="font-medium text-[#06C755]">{lineId}</span>
              </p>
            )}
          </div>

          <div className="w-64 shrink-0 rounded-3xl bg-white p-8 text-center shadow-2xl">
            <div className="relative mx-auto mb-4 h-44 w-44">
              <Image
                src={lineQrSrc || "/qr-line.png"}
                alt={`QR Code LINE OA ${shopName}`}
                fill
                sizes="176px"
                className="rounded-xl object-contain"
              />
            </div>

            <p className="text-sm font-bold text-slate-900">{shopName}</p>
            {lineId && <p className="text-sm font-medium text-[#06C755]">{lineId}</p>}
            <p className="mt-2 text-xs text-slate-400">สแกน QR เพื่อเพิ่มเพื่อนทาง LINE</p>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Home2LineCta;
