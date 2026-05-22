import { Search } from "lucide-react";
import AuroraBackdrop from "@/components/shared/AuroraBackdrop";

const ProductsHero = () => (
  <section className="relative overflow-hidden bg-[#10213d]">
    <AuroraBackdrop
      blobs={[
        {
          color: "#f97316",
          position: "-left-24 -top-24",
          size: "h-[280px] w-[280px] sm:h-[360px] sm:w-[360px]",
          opacity: 22,
        },
        {
          color: "#4d6fba",
          position: "-right-20 -bottom-24",
          size: "h-[260px] w-[260px] sm:h-[340px] sm:w-[340px]",
          opacity: 24,
          alt: true,
        },
      ]}
    />
    <div className="relative bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.22),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_32%)]">
      <div className="mx-auto max-w-7xl px-4 py-3 sm:px-6 lg:px-8 lg:py-4">
        <div className="flex items-center gap-2.5">
          <div className="shrink-0 rounded-xl bg-white/12 p-2 text-white">
            <Search className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h1 className="font-kanit text-base font-bold leading-snug text-white sm:text-lg lg:text-xl">
              ค้นหาอะไหล่แอร์รถยนต์ แล้วให้ร้านเช็กความตรงรุ่นต่อได้ทันที
            </h1>
            <p className="mt-0.5 text-xs leading-5 text-white/65 sm:text-sm">
              ใช้ค้นหาจากชื่อสินค้า รหัสสินค้า ยี่ห้อรถ รุ่นรถ หรือหมวดสินค้า แล้วค่อยส่งข้อมูลให้ร้านยืนยันก่อนสั่งซื้อจริง
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
);

export default ProductsHero;
