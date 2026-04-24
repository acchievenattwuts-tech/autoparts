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
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-6">
        <div className="max-w-4xl">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-white/12 p-3 text-white">
              <Search className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-kanit text-2xl font-bold leading-tight text-white sm:text-3xl lg:text-4xl">
                ค้นหาอะไหล่แอร์รถยนต์ แล้วให้ร้านเช็กความตรงรุ่นต่อได้ทันที
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/72 sm:text-base">
                หน้านี้เป็นศูนย์รวมอะไหล่แอร์รถยนต์ของร้าน ใช้ค้นหาจากชื่อสินค้า รหัสสินค้า ยี่ห้อรถ รุ่นรถ หรือหมวดสินค้า แล้วค่อยส่งข้อมูลให้ร้านยืนยันก่อนสั่งซื้อจริง
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
);

export default ProductsHero;
