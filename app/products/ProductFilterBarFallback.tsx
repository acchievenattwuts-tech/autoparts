const ProductFilterBarFallback = () => (
  <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
    <div className="flex items-center justify-between px-5 py-4">
      <div className="flex items-center gap-3">
        <span className="rounded-xl bg-[#1e3a5f]/10 p-2 text-[#1e3a5f]">
          <span className="block h-4 w-4 rounded bg-[#1e3a5f]/20" />
        </span>
        <div>
          <p className="text-sm font-semibold text-gray-800">ตัวกรองสินค้า</p>
          <p className="text-xs text-gray-400">เปิดเพื่อเลือกยี่ห้อรถ รุ่นรถ และหมวดสินค้า</p>
        </div>
      </div>
      <span className="block h-4 w-4 rounded-full bg-gray-200" />
    </div>
  </div>
);

export default ProductFilterBarFallback;
