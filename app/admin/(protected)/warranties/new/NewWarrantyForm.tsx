"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createWarranty, getSaleItems } from "../actions";
import { Search, Receipt, UserPlus } from "lucide-react";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import { formatDateThai, getThailandDateKey } from "@/lib/th-date";

interface SaleOption {
  id: string;
  saleNo: string;
  saleDate: Date;
  customerName: string | null;
}

interface CustomerOption {
  id: string;
  name: string;
  code: string | null;
  phone: string | null;
}

interface ProductOption {
  id: string;
  code: string;
  name: string;
}

interface Props {
  recentSales: SaleOption[];
  customers: CustomerOption[];
  products: ProductOption[];
}

type Mode = "WITH_SALE" | "NO_SALE";

const NewWarrantyForm = ({ recentSales, customers, products }: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("WITH_SALE");

  // WITH_SALE state
  const [selectedSaleId, setSelectedSaleId] = useState("");
  const [selectedSaleItemId, setSelectedSaleItemId] = useState("");
  const [saleItems, setSaleItems] = useState<{
    id: string;
    product: { code: string; name: string };
    quantity: number;
    warranties: { id: string }[];
  }[] | null>(null);
  const [loadingItems, setLoadingItems] = useState(false);

  // NO_SALE state
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [startDate, setStartDate] = useState<string>(getThailandDateKey());

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

  const handleModeChange = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("mode", mode);
    startTransition(async () => {
      const res = await createWarranty(fd);
      if (res.error) { setError(res.error); return; }
      router.push("/admin/warranties");
    });
  };

  // Items for WITH_SALE select — show all items, disable those that already have warranty
  const saleItemOptions: SelectOption[] = (saleItems ?? []).map((item) => {
    const hasWarranty = item.warranties.length > 0;
    return {
      id: item.id,
      label: item.product.name,
      sublabel: hasWarranty
        ? `${item.product.code} × ${item.quantity} — มีประกันแล้ว`
        : `${item.product.code} × ${item.quantity}`,
      disabled: hasWarranty,
    };
  });

  const hasSelectableItem = saleItemOptions.some((o) => !o.disabled);

  const submitDisabled =
    isPending ||
    (mode === "WITH_SALE"
      ? !selectedSaleId || !selectedSaleItemId || !hasSelectableItem
      : !selectedCustomerId || !selectedProductId || !startDate);

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Mode toggle */}
      <div className="flex gap-2 p-1 bg-gray-100 dark:bg-slate-800/60 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => handleModeChange("WITH_SALE")}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            mode === "WITH_SALE"
              ? "bg-white dark:bg-slate-900 text-[#1e3a5f] dark:text-sky-300 shadow-sm"
              : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
          }`}
        >
          <Receipt size={14} />
          อ้างอิงใบขาย
        </button>
        <button
          type="button"
          onClick={() => handleModeChange("NO_SALE")}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
            mode === "NO_SALE"
              ? "bg-white dark:bg-slate-900 text-[#1e3a5f] dark:text-sky-300 shadow-sm"
              : "text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200"
          }`}
        >
          <UserPlus size={14} />
          ประกันหน้างาน (ไม่มีบิล)
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-200 text-sm px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {mode === "WITH_SALE" && (
        <>
          {/* Select Sale */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
              <Search size={14} className="inline mr-1" />
              เลือกใบขาย <span className="text-red-500">*</span>
            </label>
            <SearchableSelect
              options={recentSales.map((s): SelectOption => ({
                id: s.id,
                label: s.saleNo,
                sublabel: [
                  formatDateThai(s.saleDate),
                  s.customerName ?? "",
                ].filter(Boolean).join(" — "),
              }))}
              value={selectedSaleId}
              onChange={handleSaleSelect}
              placeholder="โปรดระบุใบขาย"
            />
            <input type="hidden" name="saleId" value={selectedSaleId} />
            <p className="text-xs text-gray-400 mt-1">แสดงรายการขาย 60 วันล่าสุด (สถานะ ACTIVE เท่านั้น)</p>
          </div>

          {loadingItems && (
            <p className="text-sm text-gray-400">กำลังโหลดรายการสินค้า...</p>
          )}

          {saleItems !== null && !loadingItems && (
            <>
              {saleItemOptions.length === 0 ? (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 text-sm px-4 py-3 rounded-lg">
                  ไม่พบรายการสินค้าในใบขายนี้
                </div>
              ) : !hasSelectableItem ? (
                <div className="bg-yellow-50 border border-yellow-200 text-yellow-700 text-sm px-4 py-3 rounded-lg">
                  รายการสินค้าในใบขายนี้มีการบันทึกประกันครบทุกรายการแล้ว
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                      เลือกรายการสินค้า <span className="text-red-500">*</span>
                    </label>
                    <SearchableSelect
                      options={saleItemOptions}
                      value={selectedSaleItemId}
                      onChange={setSelectedSaleItemId}
                      placeholder="โปรดระบุสินค้า"
                    />
                    <input type="hidden" name="saleItemId" value={selectedSaleItemId} />
                    <p className="text-xs text-gray-400 mt-1">
                      แสดงสินค้าทั้งหมดในใบขาย — รายการที่มีประกันแล้วจะถูก disable ไม่สามารถเลือกซ้ำได้
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                        ระยะเวลาประกัน (วัน) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        name="warrantyDays"
                        min="1"
                        max="36500"
                        required
                        placeholder="เช่น 365"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">หมายเหตุ</label>
                      <input
                        type="text"
                        name="note"
                        placeholder="เงื่อนไขประกัน (ถ้ามี)"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
                      />
                    </div>
                  </div>

                  <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-800/60 rounded-lg px-4 py-3 text-sm text-blue-700 dark:text-blue-200">
                    วันเริ่มต้นประกัน = วันที่ในใบขาย | วันสิ้นสุด = วันที่ขาย + จำนวนวัน
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {mode === "NO_SALE" && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
              เลือกลูกค้า <span className="text-red-500">*</span>
            </label>
            <SearchableSelect
              options={customers.map((c): SelectOption => ({
                id: c.id,
                label: c.name,
                sublabel: [c.code, c.phone].filter(Boolean).join(" — ") || undefined,
              }))}
              value={selectedCustomerId}
              onChange={setSelectedCustomerId}
              placeholder="โปรดระบุลูกค้า"
            />
            <input type="hidden" name="customerId" value={selectedCustomerId} />
            <p className="text-xs text-gray-400 mt-1">บังคับเลือกจากทะเบียนลูกค้า — ถ้าลูกค้ายังไม่อยู่ในระบบ กรุณาเพิ่มที่เมนูลูกค้าก่อน</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
              เลือกสินค้า <span className="text-red-500">*</span>
            </label>
            <SearchableSelect
              options={products.map((p): SelectOption => ({
                id: p.id,
                label: p.name,
                sublabel: p.code,
              }))}
              value={selectedProductId}
              onChange={setSelectedProductId}
              placeholder="โปรดระบุสินค้า"
            />
            <input type="hidden" name="productId" value={selectedProductId} />
            <p className="text-xs text-gray-400 mt-1">รองรับเฉพาะสินค้าที่ไม่ใช่ Lot Control</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                วันเริ่มต้นประกัน <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                name="startDate"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                lang="en-GB"
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">
                ระยะเวลาประกัน (วัน) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="warrantyDays"
                min="1"
                max="36500"
                required
                placeholder="เช่น 365"
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">หมายเหตุ</label>
              <input
                type="text"
                name="note"
                placeholder="เช่น ประกันหน้างาน, QC fail, ประกันพิเศษ"
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
              />
            </div>
          </div>

          <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-800/60 rounded-lg px-4 py-3 text-sm text-blue-700 dark:text-blue-200">
            ประกันหน้างาน — ไม่ผูกกับใบขาย วันสิ้นสุด = วันเริ่มต้น + จำนวนวัน
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button
          type="submit"
          disabled={submitDisabled}
          className="px-6 py-2 bg-[#1e3a5f] hover:bg-[#163055] disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {isPending ? "กำลังบันทึก..." : "บันทึกประกัน"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/admin/warranties")}
          className="px-6 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-200 text-sm font-medium rounded-lg transition-colors"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
};

export default NewWarrantyForm;
