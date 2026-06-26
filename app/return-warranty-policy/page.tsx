export const revalidate = 3600;

import type { Metadata } from "next";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  MapPin,
  MessagesSquare,
  Phone,
  RotateCcw,
  ShieldCheck,
  Truck,
  XCircle,
} from "lucide-react";
import StorefrontNavbar from "@/components/shared/StorefrontNavbar";
import Footer from "@/components/shared/Footer";
import StorefrontDeferredAssets from "@/components/shared/StorefrontDeferredAssets";
import BreadcrumbJsonLd from "@/components/seo/BreadcrumbJsonLd";
import { LOCAL_SEO_KEYWORDS, absoluteUrl } from "@/lib/seo";
import { getPublicSiteConfig } from "@/lib/site-config";
import { STOREFRONT_LINE_PRIMARY_BUTTON_CLASS } from "@/lib/storefront-line-theme";

const SHOP_PHONE = "065-751-7873";
const SHOP_LINE_ID = "@sriwanparts";
const SHOP_ADDRESS = "118/7 หมู่ 12 ต.บางม่วง อ.เมือง จ.นครสวรรค์ 60000";
const SHOP_MAP_URL = "https://maps.app.goo.gl/3ZaXDsG7uWLKvTSE8";

const warrantyRows = [
  { product: "คอมเพรสเซอร์แอร์ (คอมแอร์)", period: "180 วัน" },
  { product: "ตู้แอร์ / คอยล์เย็น", period: "90 วัน" },
  { product: "แผงแอร์ / คอนเดนเซอร์ / คอยล์ร้อน", period: "90 วัน" },
  { product: "หม้อน้ำรถยนต์", period: "90 วัน" },
];

const covered = [
  "สินค้าชำรุดหรือบกพร่องจากกระบวนการผลิต ที่แสดงอาการขึ้นเองภายในระยะเวลารับประกัน",
  "ร้านจัดส่งสินค้าผิดรุ่นหรือผิดสเปกจากความผิดพลาดของร้านเอง (ยินดีเปลี่ยนหรือคืนเต็มจำนวน)",
];

const notCovered = [
  "ความเสียหายที่เกิดจากการติดตั้งผิดวิธี หรือติดตั้งโดยช่างที่ไม่ชำนาญ",
  "รอยขีดข่วน บุบ แตก ร้าว งอ หรือความเสียหายที่เกิดขึ้นหลังการติดตั้งหรือใช้งาน",
  "สติกเกอร์รับประกัน (Void) ฉีกขาด หลุดหาย หรือมีร่องรอยการแกะหรือถอดซ่อมเอง",
  "ความเสียหายจากอุบัติเหตุ ภัยธรรมชาติ น้ำท่วม หรือการใช้งานผิดประเภท",
  "สินค้าที่หมดระยะเวลารับประกันตามตาราง",
  "สินค้ายี่ห้อ Cool Gear และ Denso ไม่มีการรับประกันทุกกรณี",
];

const claimSteps = [
  "ติดต่อร้านพร้อมแจ้งเลขที่ใบเสร็จหรือเลขออเดอร์",
  "ส่งรูปถ่ายหรือคลิปวิดีโอ พร้อมอธิบายอาการของสินค้า",
  "รอเจ้าหน้าที่ประเมินและแจ้งผลภายใน 1–3 วันทำการ",
  "จัดส่งสินค้ากลับ และรับสินค้าใหม่",
];

export async function generateMetadata(): Promise<Metadata> {
  const config = await getPublicSiteConfig();
  const title = `นโยบายคืนสินค้า / การรับประกัน | ${config.shopName}`;
  const description =
    "เงื่อนไขการรับประกันและการคืนสินค้าของร้านศรีวรรณอะไหล่แอร์ ระยะเวลารับประกันอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์แต่ละประเภท เงื่อนไขการเคลม และวิธีแจ้งสินค้าชำรุดจากการขนส่ง";

  return {
    title,
    description,
    keywords: LOCAL_SEO_KEYWORDS,
    alternates: {
      canonical: absoluteUrl("/return-warranty-policy"),
    },
    openGraph: {
      url: absoluteUrl("/return-warranty-policy"),
      title,
      description,
    },
    twitter: {
      title,
      description,
    },
  };
}

const ReturnWarrantyPolicyPage = async () => {
  const config = await getPublicSiteConfig();

  return (
    <>
      <StorefrontNavbar
        shopName={config.shopName}
        shopSlogan={config.shopSlogan}
        shopLogoUrl={config.shopLogoUrl}
        lineUrl={config.shopLineUrl}
        shopPhone={config.shopPhone}
      />
      <main className="min-h-screen bg-slate-50 pt-16">
        <section className="relative overflow-hidden bg-[#10213d]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_26%)]" />
          <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
            <div className="max-w-3xl">
              <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-[#f97316]">
                นโยบายร้าน
              </p>
              <h1 className="font-kanit text-4xl font-bold leading-tight text-white sm:text-5xl">
                นโยบายคืนสินค้า / การรับประกัน
              </h1>
              <p className="mt-5 text-base leading-8 text-white/78 sm:text-lg">
                ทางร้าน {config.shopName} จำหน่ายอะไหล่แอร์รถยนต์และหม้อน้ำรถยนต์คุณภาพ
                คัดตรวจสภาพสินค้าทุกชิ้นก่อนจัดส่ง ทั้งนี้
                ระยะเวลาการรับประกันของสินค้าแต่ละประเภทไม่เท่ากัน ขึ้นอยู่กับชนิดของอะไหล่
                กรุณาตรวจสอบเงื่อนไขตามรายละเอียดด้านล่างก่อนสั่งซื้อ
              </p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
            <div className="space-y-6">
              {/* 1. ระยะเวลาการรับประกัน */}
              <div className="rounded-[32px] border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
                <div className="flex items-start gap-4">
                  <div className="inline-flex rounded-2xl bg-[#f97316]/10 p-3 text-[#f97316]">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">
                      1. ระยะเวลาการรับประกัน
                    </h2>
                    <p className="mt-1 text-sm leading-7 text-slate-600">
                      นับระยะประกันจากวันที่ระบุในใบเสร็จ หรือวันที่ได้รับสินค้า
                    </p>
                  </div>
                </div>

                <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-[#10213d]">
                      <tr>
                        <th className="px-4 py-3 font-semibold">ประเภทสินค้า</th>
                        <th className="px-4 py-3 text-right font-semibold sm:text-left">
                          ระยะเวลารับประกัน
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {warrantyRows.map((row) => (
                        <tr key={row.product} className="text-slate-700">
                          <td className="px-4 py-3 leading-6">{row.product}</td>
                          <td className="px-4 py-3 text-right font-semibold text-[#10213d] sm:text-left">
                            {row.period}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" />
                  <p className="text-sm leading-7 text-amber-800">
                    <span className="font-semibold">หมายเหตุ:</span> สินค้ายี่ห้อ{" "}
                    <span className="font-semibold">Cool Gear</span> และ{" "}
                    <span className="font-semibold">Denso</span> ไม่มีการรับประกันทุกกรณี
                  </p>
                </div>
              </div>

              {/* 2. สิ่งที่รับประกัน */}
              <div className="rounded-[32px] border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
                <div className="flex items-start gap-4">
                  <div className="inline-flex rounded-2xl bg-emerald-50 p-3 text-emerald-600">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div className="w-full">
                    <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">
                      2. เงื่อนไขที่อยู่ในการรับประกัน
                    </h2>
                    <ul className="mt-4 space-y-3">
                      {covered.map((item) => (
                        <li key={item} className="flex items-start gap-3 text-sm leading-7 text-slate-600">
                          <CheckCircle2 className="mt-1 h-4 w-4 flex-shrink-0 text-emerald-500" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* 3. สิ่งที่ไม่รับประกัน */}
              <div className="rounded-[32px] border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
                <div className="flex items-start gap-4">
                  <div className="inline-flex rounded-2xl bg-rose-50 p-3 text-rose-600">
                    <XCircle className="h-5 w-5" />
                  </div>
                  <div className="w-full">
                    <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">
                      3. กรณีที่ไม่อยู่ในการรับประกัน
                    </h2>
                    <ul className="mt-4 space-y-3">
                      {notCovered.map((item) => (
                        <li key={item} className="flex items-start gap-3 text-sm leading-7 text-slate-600">
                          <XCircle className="mt-1 h-4 w-4 flex-shrink-0 text-rose-400" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>

              {/* 4. ชำรุดจากการขนส่ง */}
              <div className="rounded-[32px] border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
                <div className="flex items-start gap-4">
                  <div className="inline-flex rounded-2xl bg-[#10213d]/5 p-3 text-[#10213d]">
                    <Truck className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">
                      4. กรณีสินค้าชำรุด / แตกหักจากการขนส่ง
                    </h2>
                    <p className="mt-3 text-sm leading-7 text-slate-600 sm:text-base">
                      เพื่อให้การเคลมรวดเร็วและได้รับการอนุมัติอย่างแน่นอน
                      ทางร้านแนะนำอย่างยิ่งให้ลูกค้าถ่ายคลิปวิดีโอขณะแกะกล่องพัสดุแบบต่อเนื่องไม่ตัดต่อ
                      ตั้งแต่กล่องยังปิดสนิทจนเปิดเห็นตัวสินค้า
                      คลิปนี้คือหลักฐานสำคัญที่สุดที่ช่วยให้ดำเนินการเปลี่ยนสินค้าให้ได้ทันที
                    </p>
                    <ul className="mt-4 space-y-3">
                      <li className="flex items-start gap-3 text-sm leading-7 text-slate-600">
                        <CheckCircle2 className="mt-1 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                        <span>
                          กรุณาแจ้งร้านภายใน <span className="font-semibold">24–48 ชั่วโมง</span>{" "}
                          หลังได้รับพัสดุ พร้อมแนบรูปถ่ายกล่อง ตัวสินค้า และใบจัดส่ง
                        </span>
                      </li>
                      <li className="flex items-start gap-3 text-sm leading-7 text-slate-600">
                        <CheckCircle2 className="mt-1 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                        <span>
                          ทางร้านจะประสานงานกับบริษัทขนส่ง และดำเนินการเปลี่ยนสินค้าใหม่หรือคืนเงินให้ลูกค้า
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* 5. การคืน / เปลี่ยนสินค้า */}
              <div className="rounded-[32px] border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
                <div className="flex items-start gap-4">
                  <div className="inline-flex rounded-2xl bg-[#f97316]/10 p-3 text-[#f97316]">
                    <RotateCcw className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">
                      5. การคืน / เปลี่ยนสินค้า
                    </h2>
                    <ul className="mt-4 space-y-3">
                      <li className="flex items-start gap-3 text-sm leading-7 text-slate-600">
                        <CheckCircle2 className="mt-1 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                        <span>
                          แจ้งความประสงค์ภายใน <span className="font-semibold">7 วัน</span>{" "}
                          นับจากวันที่ได้รับสินค้า
                        </span>
                      </li>
                      <li className="flex items-start gap-3 text-sm leading-7 text-slate-600">
                        <CheckCircle2 className="mt-1 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                        <span>
                          สินค้าต้องอยู่ในสภาพสมบูรณ์ ครบกล่องและอุปกรณ์ ยังไม่ผ่านการติดตั้งหรือใช้งาน
                        </span>
                      </li>
                      <li className="flex items-start gap-3 text-sm leading-7 text-slate-600">
                        <CheckCircle2 className="mt-1 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                        <span>
                          กรณีเป็นความผิดพลาดของร้าน (ส่งผิด หรือสินค้าชำรุดจากการผลิต)
                          ทางร้านรับผิดชอบค่าจัดส่งคืนให้
                        </span>
                      </li>
                      <li className="flex items-start gap-3 text-sm leading-7 text-slate-600">
                        <CheckCircle2 className="mt-1 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                        <span>
                          ทางร้านจะเปลี่ยนเป็นสินค้ารุ่นเดิม หากสินค้าหมดจะคืนเงินหรือเสนอรุ่นใกล้เคียงให้แทน
                        </span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* 6. ขั้นตอนการเคลม */}
              <div className="rounded-[32px] border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
                <div className="flex items-start gap-4">
                  <div className="inline-flex rounded-2xl bg-[#10213d]/5 p-3 text-[#10213d]">
                    <ClipboardList className="h-5 w-5" />
                  </div>
                  <div className="w-full">
                    <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">
                      6. ขั้นตอนการเคลม
                    </h2>
                    <ol className="mt-4 space-y-3">
                      {claimSteps.map((step, index) => (
                        <li key={step} className="flex items-start gap-3 text-sm leading-7 text-slate-600">
                          <span className="mt-0.5 inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#f97316] text-xs font-bold text-white">
                            {index + 1}
                          </span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </div>
            </div>

            {/* ช่องทางติดต่อ */}
            <div className="space-y-6">
              <div className="rounded-[32px] border border-slate-200 bg-white p-7 shadow-sm sm:p-8 lg:sticky lg:top-24">
                <h2 className="font-kanit text-2xl font-semibold text-[#10213d]">
                  7. ช่องทางติดต่อ / แจ้งเคลม
                </h2>
                <div className="mt-5 space-y-4 text-sm leading-7 text-slate-600">
                  <div className="flex items-start gap-3">
                    <Phone className="mt-1 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                    <a href={`tel:${SHOP_PHONE.replace(/-/g, "")}`} className="hover:text-[#10213d]">
                      {SHOP_PHONE}
                    </a>
                  </div>
                  <div className="flex items-start gap-3">
                    <MessagesSquare className="mt-1 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                    <span>LINE: {SHOP_LINE_ID}</span>
                  </div>
                  <div className="flex items-start gap-3">
                    <MapPin className="mt-1 h-4 w-4 flex-shrink-0 text-[#f97316]" />
                    <span>{SHOP_ADDRESS}</span>
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-3">
                  <a
                    href={config.shopLineUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={STOREFRONT_LINE_PRIMARY_BUTTON_CLASS}
                  >
                    คุยผ่าน LINE OA
                  </a>
                  <a
                    href={SHOP_MAP_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 font-semibold text-[#10213d] transition hover:border-[#10213d]"
                  >
                    เปิด Google Maps
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <Link
                    href="/products"
                    className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-3 font-semibold text-[#10213d] transition hover:border-[#10213d]"
                  >
                    ไปหน้าค้นหาสินค้า
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer config={config} />
      <StorefrontDeferredAssets lineUrl={config.shopLineUrl} />

      <BreadcrumbJsonLd
        items={[
          { name: "หน้าแรก", item: absoluteUrl("/") },
          { name: "นโยบายคืนสินค้า / การรับประกัน", item: absoluteUrl("/return-warranty-policy") },
        ]}
      />
    </>
  );
};

export default ReturnWarrantyPolicyPage;
