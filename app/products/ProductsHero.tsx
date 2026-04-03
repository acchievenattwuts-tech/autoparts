import { Search } from "lucide-react";

interface ProductsHeroProps {
  lineUrl: string;
  searchQuery?: string;
}

const orderSteps = [
  "แจ้งรุ่นรถ ปีรถ หรือชื่อสินค้า",
  "ร้านเช็กราคาและความตรงรุ่นให้ทันที",
  "ชำระเงินและจัดส่งสินค้า",
];

const ProductsHero = ({ lineUrl }: ProductsHeroProps) => (
  <section className="overflow-hidden bg-[#10213d]">
    <div className="bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.22),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(255,255,255,0.08),transparent_32%)]">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <div className="max-w-4xl">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-white/12 p-3 text-white">
              <Search className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="font-kanit text-2xl font-bold leading-tight text-white sm:text-3xl lg:text-4xl">
                หาอะไหล่ให้เจอเร็ว แล้วให้ร้านเช็กต่อได้ทันที
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-white/72 sm:text-base">
                ค้นหาจากแถบด้านบนได้ทุกหน้า แล้วส่งข้อมูลต่อให้ร้านเช็กความตรงรุ่น ราคา และการจัดส่งได้ในขั้นตอนเดียว
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {orderSteps.map((step, index) => (
              <div key={step} className="rounded-2xl border border-white/10 bg-white/6 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#f97316]">
                  Step {index + 1}
                </p>
                <p className="mt-1 text-sm leading-6 text-white/82">{step}</p>
              </div>
            ))}
          </div>

          <a
            href={lineUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 hidden h-11 items-center justify-center rounded-2xl border border-white/14 px-5 text-sm font-semibold text-white transition hover:bg-white/10 sm:inline-flex"
          >
            ส่งรูปหรือรหัสให้ร้านช่วยเช็ก
          </a>
        </div>
      </div>
    </div>
  </section>
);

export default ProductsHero;
