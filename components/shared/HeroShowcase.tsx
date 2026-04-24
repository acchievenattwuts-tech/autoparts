import Image from "next/image";
import Link from "next/link";
import { ArrowRight, MessageCircleMore, Phone, ShieldCheck, Truck } from "lucide-react";
import AuroraBackdrop from "@/components/shared/AuroraBackdrop";
import CharRise from "@/components/shared/CharRise";

interface HeroShowcaseProps {
  lineUrl?: string;
  shopPhone?: string;
  shopName?: string;
}

const HeroShowcase = ({
  lineUrl = "https://lin.ee/18P0SqG",
  shopPhone,
  shopName = "ศรีวรรณ อะไหล่แอร์",
}: HeroShowcaseProps) => {
  return (
    <section id="home" className="relative overflow-hidden bg-[#edf5ff]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(65,114,194,0.18),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(249,115,22,0.18),transparent_28%)]" />
      <AuroraBackdrop
        blobs={[
          {
            color: "#4d6fba",
            position: "-left-32 -top-32",
            size: "h-[380px] w-[380px] sm:h-[520px] sm:w-[520px]",
            opacity: 28,
          },
          {
            color: "#f97316",
            position: "-right-24 top-40 lg:top-24",
            size: "h-[320px] w-[320px] sm:h-[460px] sm:w-[460px]",
            opacity: 20,
            alt: true,
          },
        ]}
      />
      <Image
        src="/hero-banner2.jpg"
        alt={shopName}
        fill
        sizes="100vw"
        fetchPriority="high"
        loading="eager"
        className="object-cover object-[70%_center] opacity-30 lg:opacity-95"
      />

      <div className="absolute inset-y-0 left-0 w-full bg-[linear-gradient(90deg,rgba(237,245,255,0.98)_0%,rgba(237,245,255,0.92)_34%,rgba(237,245,255,0.34)_68%,rgba(237,245,255,0)_100%)]" />
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl items-center px-4 pb-14 pt-24 sm:px-6 lg:px-8 lg:pb-18">
        <div className="w-full">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#3d5f92]/12 bg-white/86 px-4 py-1.5 shadow-sm backdrop-blur">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22c55e]/70" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#22c55e]" />
              </span>
              <span className="text-sm font-medium text-[#305182]">เช็กความตรงรุ่นก่อนสั่งทุกครั้ง</span>
            </div>

            <div className="mt-8 max-w-xl">
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#f97316]">
                ร้านอะไหล่แอร์รถยนต์
              </p>
              <div className="mt-3">
                <h1 className="font-kanit text-4xl font-bold leading-[0.96] text-[#16345d] sm:text-5xl lg:text-6xl">
                  <CharRise text={shopName} stagger={28} />
                </h1>
              </div>
              <p className="mt-5 text-lg leading-8 text-[#31507b] sm:text-xl">
                หาอะไหล่ให้ตรงรุ่น ง่ายขึ้น ไม่ต้องเดาเอง
              </p>
            </div>

            <p className="mt-6 max-w-lg text-base leading-7 text-slate-600 sm:text-lg">
              ส่งรุ่นรถ ปีรถ หรือรูปอะไหล่มาให้ร้านเช็กก่อน แล้วค่อยสรุปราคาและรายการที่ตรงรุ่นจริง
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={lineUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="sf-shine inline-flex items-center justify-center gap-2 rounded-full bg-[#4d6fba] px-6 py-3.5 font-semibold text-white shadow-lg shadow-[#4d6fba]/25 transition hover:-translate-y-0.5 hover:bg-[#3f5fa5]"
              >
                ปรึกษาทาง LINE
                <MessageCircleMore className="h-4 w-4" />
              </a>
              <Link
                href="/products"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-[#4d6fba]/18 bg-white/88 px-6 py-3.5 font-semibold text-[#16345d] shadow-sm transition hover:-translate-y-0.5 hover:border-[#4d6fba]/35 hover:bg-white"
              >
                ดูสินค้าทั้งหมด
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-3xl border border-[#3d5f92]/10 bg-white/88 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4d6fba]">
                  Step 1
                </p>
                <p className="mt-2 text-sm font-medium text-[#16345d]">ส่งข้อมูลรถหรือรูปอะไหล่</p>
              </div>
              <div className="rounded-3xl border border-[#3d5f92]/10 bg-white/88 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#f97316]">
                  Step 2
                </p>
                <p className="mt-2 text-sm font-medium text-[#16345d]">ร้านเช็กและแจ้งรายการที่ตรงรุ่น</p>
              </div>
              <div className="rounded-3xl border border-[#3d5f92]/10 bg-white/88 p-4 shadow-sm backdrop-blur">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4d6fba]">
                  Step 3
                </p>
                <p className="mt-2 text-sm font-medium text-[#16345d]">ค่อยยืนยันสั่งซื้อและจัดส่ง</p>
              </div>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              <div className="rounded-3xl border border-[#3d5f92]/10 bg-white/82 p-4 shadow-sm backdrop-blur">
                <ShieldCheck className="h-5 w-5 text-[#4d6fba]" />
                <p className="mt-3 text-sm font-semibold text-[#16345d]">เช็กก่อนสั่ง</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">ยืนยันรุ่นให้ก่อนทุกครั้ง</p>
              </div>
              <div className="rounded-3xl border border-[#3d5f92]/10 bg-white/82 p-4 shadow-sm backdrop-blur">
                <Truck className="h-5 w-5 text-[#f97316]" />
                <p className="mt-3 text-sm font-semibold text-[#16345d]">ส่งทั่วประเทศ</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">สรุปรายการแล้วจัดส่งต่อได้ทันที</p>
              </div>
              <div className="rounded-3xl border border-[#3d5f92]/10 bg-white/82 p-4 shadow-sm backdrop-blur">
                <Phone className="h-5 w-5 text-[#4d6fba]" />
                <p className="mt-3 text-sm font-semibold text-[#16345d]">ติดต่อสะดวก</p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {shopPhone ? `โทร ${shopPhone}` : "ทักแชตหรือส่งรูปอะไหล่เดิมได้"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroShowcase;
