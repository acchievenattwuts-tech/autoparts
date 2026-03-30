"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createWarranty, getSaleItems } from "../actions";
import { Search } from "lucide-react";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";

interface SaleOption {
  id: string;
  saleNo: string;
  saleDate: Date;
  customerName: string | null;
}

interface Props {
  recentSales: SaleOption[];
}

const NewWarrantyForm = ({ recentSales }: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [selectedSaleId, setSelectedSaleId] = useState("");
  const [selectedSaleItemId, setSelectedSaleItemId] = useState("");
  const [saleItems, setSaleItems] = useState<{
    id: string;
    product: { code: string; name: string };
    quantity: number;
    warranty: { id: string } | null;
  }[] | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);

  const handleSaleSelect = async (saleId: string) => {
    setSelectedSaleId(saleId);
    setSelectedSaleItemId("");
    setSaleItems(null);
    if (!saleId) return;
    setLoadingItems(true);
    const sale = await getSaleItems(saleId);
    setSaleItems(sale?.items ?? []);
    setLoadingItems(false);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await createWarranty(fd);
      if (res.error) { setError(res.error); return; }
      router.push("/admin/warranties");
    });
  };

  const availableItems = saleItems?.filter((i) => !i.warranty) ?? [];

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* Select Sale */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          <Search size={14} className="inline mr-1" />
          เลือกใบขาย <span className="text-red-500">*</span>
        </label>
        <SearchableSelect
          options={recentSales.map((s): SelectOption => ({
            id: s.id,
            label: s.saleNo,
            sublabel: [
              new Date(s.saleDate).toLocaleDateString("th-TH-u-ca-gregory", { day: "2-digit", month: "2-digit", year: "numeric" }),
              s.customerName ?? "",
            ].filter(Boolean).join(" — "),
          }))}
          value={selectedSaleId}
          onChange={handleSaleSelect}
          placeholder="โปรดระบุใบขาย"
        />
        <input type="hidden" name="saleId" value={selectedSaleId} />
        <p className="text-xs text-gray-400 mt-1">แสดงรายการขาย 60 วันล่าสุด</p>
      </div>

      {/* Sale items */}
      {loadingItems && (
        <p className="text-sm text-gray-400">กำลังโหลดรายการสินค้า...</p>
      )}

      {saleItems !== null && !loadingItems && (
        <>
          {availableItems.length === 0 ? (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 text-sm px-4 py-3 rounded-lg">
              รายการสินค้าในใบขายนี้มีการบันทึกประกันครบทุกรายการแล้ว
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  เลือกรายการสินค้า <span className="text-red-500">*</span>
                </label>
                <SearchableSelect
                  options={availableItems.map((item): SelectOption => ({
                    id: item.id,
                    label: item.product.name,
                    sublabel: `${item.product.code} × ${item.quantity}`,
                  }))}
                  value={selectedSaleItemId}
                  onChange={setSelectedSaleItemId}
                  placeholder="โปรดระบุสินค้า"
                />
                <input type="hidden" name="saleItemId" value={selectedSaleItemId} />
                {saleItems.some((i) => i.warranty) && (
                  <p className="text-xs text-gray-400 mt-1">
                    * แสดงเฉพาะรายการที่ยังไม่มีการบันทึกประกัน
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    ระยะเวลาประกัน (วัน) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    name="warrantyDays"
                    min="1"
                    max="36500"
                    required
                    placeholder="เช่น 365"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">หมายเหตุ</label>
                  <input
                    type="text"
                    name="note"
                    placeholder="เงื่อนไขประกัน (ถ้ามี)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
                  />
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-3 text-sm text-blue-700">
                วันเริ่มต้นประกัน = วันที่ในใบขาย | วันสิ้นสุด = วันที่ขาย + จำนวนวัน
              </div>
            </div>
          )}
        </>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={isPending || !selectedSaleId || availableItems.length === 0 || !selectedSaleItemId}
          className="px-6 py-2 bg-[#1e3a5f] hover:bg-[#163055] disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isPending ? "กำลังบันทึก..." : "บันทึกประกัน"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/warranties")}
          className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
};

export default NewWarrantyForm;
