import Link from "next/link";
import { MessageCircle, RefreshCw } from "lucide-react";
import Footer from "@/components/shared/Footer";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import StorefrontNavbar from "@/components/shared/StorefrontNavbar";
import { defaultSiteConfig, type SiteConfig } from "@/lib/site-config";
import { STOREFRONT_LINE_PRIMARY_BUTTON_CLASS } from "@/lib/storefront-line-theme";

interface StorefrontTemporaryUnavailableProps {
  config?: SiteConfig | null;
  title?: string;
}

export default function StorefrontTemporaryUnavailable({
  config,
  title = "หน้าสินค้ากำลังหนาแน่นชั่วคราว",
}: StorefrontTemporaryUnavailableProps) {
  const resolvedConfig = config ?? defaultSiteConfig;

  return (
    <>
      <StorefrontNavbar
        shopName={resolvedConfig.shopName}
        shopSlogan={resolvedConfig.shopSlogan}
        shopLogoUrl={resolvedConfig.shopLogoUrl}
        lineUrl={resolvedConfig.shopLineUrl}
        shopPhone={resolvedConfig.shopPhone}
      />
      <main className="min-h-screen bg-slate-50 pt-16 text-[#10213d]">
        <section className="mx-auto flex min-h-[70vh] max-w-3xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6">
          <div className="rounded-full bg-orange-50 p-4 text-[#f97316] ring-1 ring-orange-100">
            <RefreshCw className="h-8 w-8" />
          </div>
          <h1 className="mt-6 font-kanit text-2xl font-bold sm:text-3xl">{title}</h1>
          <p className="mt-3 max-w-xl text-sm leading-7 text-slate-600 sm:text-base">
            ระบบกำลังรับคำขอจำนวนมาก กรุณาลองโหลดอีกครั้งในอีกสักครู่ หรือทัก LINE ให้ร้านช่วยเช็กสินค้าได้ทันที
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/products"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-[#10213d] shadow-sm transition hover:bg-slate-100"
            >
              ดูสินค้าทั้งหมด
            </Link>
            {resolvedConfig.shopLineUrl && (
              <a
                href={resolvedConfig.shopLineUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${STOREFRONT_LINE_PRIMARY_BUTTON_CLASS} text-sm`}
              >
                <MessageCircle className="h-4 w-4" />
                ทัก LINE ร้าน
              </a>
            )}
          </div>
        </section>
      </main>
      <Footer config={resolvedConfig} />
      <StorefrontDeferredAssets lineUrl={resolvedConfig.shopLineUrl} />
    </>
  );
}
