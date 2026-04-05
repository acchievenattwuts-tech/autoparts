"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClaim } from "../actions";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";
import { CheckCircle } from "lucide-react";
import type { LotAvailableJSON } from "@/lib/lot-control-client";

interface SupplierOption {
  id:       string;
  name:     string;
  phone:    string | null;
  address:  string | null;
}

interface Props {
  warrantyId:             string;
  suppliers:              SupplierOption[];
  defaultSupplierId:      string;
  defaultSupplierName:    string;
  defaultSupplierPhone:   string;
  defaultSupplierAddress: string;
  isLotControl:           boolean;
  replacementLotOptions:  LotAvailableJSON[];
  defaultReplacementLotNo: string;
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-sm font-medium text-gray-700 mb-1.5";

const NewClaimForm = ({
  warrantyId,
  suppliers,
  defaultSupplierId,
  defaultSupplierName,
  defaultSupplierPhone,
  defaultSupplierAddress,
  isLotControl,
  replacementLotOptions,
  defaultReplacementLotNo,
}: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError]   = useState("");
  const [success, setSuccess] = useState("");

  const [claimType, setClaimType] = useState<"REPLACE_NOW" | "CUSTOMER_WAIT">("REPLACE_NOW");
  const [supplierId, setSupplierId]         = useState(defaultSupplierId);
  const [supplierName, setSupplierName]     = useState(defaultSupplierName);
  const [supplierPhone, setSupplierPhone]   = useState(defaultSupplierPhone);
  const [supplierAddress, setSupplierAddress] = useState(defaultSupplierAddress);
  const [replacementLotNo, setReplacementLotNo] = useState(defaultReplacementLotNo);

  const handleSupplierChange = (id: string) => {
    setSupplierId(id);
    const found = suppliers.find((s) => s.id === id);
    if (found) {
      setSupplierName(found.name);
      setSupplierPhone(found.phone ?? "");
      setSupplierAddress(found.address ?? "");
    } else {
      setSupplierName("");
      setSupplierPhone("");
      setSupplierAddress("");
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    const fd = new FormData(e.currentTarget);
    fd.set("supplierId",      supplierId);
    fd.set("supplierName",    supplierName);
    fd.set("supplierPhone",   supplierPhone);
    fd.set("supplierAddress", supplierAddress);
    fd.set("claimType",       claimType);
    fd.set("replacementLotNo", replacementLotNo);

    startTransition(async () => {
      const res = await createClaim(fd);
      if (res.error) { setError(res.error); return; }
      setSuccess(`เปิดใบเคลมสำเร็จ เลขที่: ${res.claimNo}`);
      setTimeout(() => router.push("/admin/warranty-claims"), 1500);
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
      )}
      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 text-sm px-4 py-3 rounded-lg flex items-center gap-2">
          <CheckCircle size={16} /> {success}
        </div>
      )}

      <input type="hidden" name="warrantyId" value={warrantyId} />

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-5">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] pb-3 border-b border-gray-100">รายละเอียดการเคลม</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>วันที่เคลม <span className="text-red-500">*</span></label>
            <input
              type="date"
              name="claimDate"
              required
              defaultValue={new Date().toISOString().slice(0, 10)}
              className={inputCls}
            />
          </div>

          <div>
            <label className={labelCls}>ประเภทการเคลม <span className="text-red-500">*</span></label>
            <input type="hidden" name="claimType" value={claimType} />
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              <button
                type="button"
                onClick={() => setClaimType("REPLACE_NOW")}
                className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
                  claimType === "REPLACE_NOW"
                    ? "bg-[#1e3a5f] text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                เปลี่ยนของให้ทันที
              </button>
              <button
                type="button"
                onClick={() => setClaimType("CUSTOMER_WAIT")}
                className={`flex-1 px-3 py-2 text-sm font-medium transition-colors border-l border-gray-300 ${
                  claimType === "CUSTOMER_WAIT"
                    ? "bg-amber-500 text-white"
                    : "bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                ลูกค้ารอผลเคลม
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {claimType === "REPLACE_NOW"
                ? "ร้านส่งของใหม่ให้ลูกค้าทันที — stock ลด 1 ชิ้น"
                : "ลูกค้ารอผลจากซัพพลายเออร์ — stock +1 จากการรับของเสียคืน"}
            </p>
          </div>

          {claimType === "REPLACE_NOW" && isLotControl && (
            <div className="md:col-span-2">
              <label className={labelCls}>Lot สินค้าทดแทน</label>
              <input type="hidden" name="replacementLotNo" value={replacementLotNo} />
              <SearchableSelect
                options={replacementLotOptions.map(
                  (lot): SelectOption => ({
                    id: lot.lotNo,
                    label: lot.lotNo,
                    sublabel: `คงเหลือ ${lot.qtyOnHand.toLocaleString("th-TH")} | EXP ${lot.expDate ? lot.expDate.slice(0, 10) : "-"}`,
                  })
                )}
                value={replacementLotNo}
                onChange={setReplacementLotNo}
                placeholder="เลือกระบุ Lot สินค้าทดแทน"
              />
              <p className="text-xs text-gray-400 mt-1">ระบบเลือก Lot ให้อัตโนมัติก่อน แต่สามารถเปลี่ยนเองได้</p>
            </div>
          )}

          <div className="md:col-span-2">
            <label className={labelCls}>อาการเสีย / สาเหตุ</label>
            <input
              type="text"
              name="symptom"
              maxLength={500}
              placeholder="เช่น ชำรุด, ไม่ทำงาน, ผิดรุ่น..."
              className={inputCls}
            />
          </div>

          <div className="md:col-span-2">
            <label className={labelCls}>หมายเหตุ</label>
            <input
              type="text"
              name="note"
              maxLength={500}
              placeholder="หมายเหตุเพิ่มเติม"
              className={inputCls}
            />
          </div>
        </div>
      </div>

      {/* Supplier section */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] pb-3 border-b border-gray-100">ข้อมูลซัพพลายเออร์</h2>

        <div>
          <label className={labelCls}>ซัพพลายเออร์</label>
          <SearchableSelect
            options={[
              { id: "", label: "-- ไม่ระบุซัพพลายเออร์ --" },
              ...suppliers.map((s): SelectOption => ({ id: s.id, label: s.name, sublabel: s.phone ?? undefined })),
            ]}
            value={supplierId}
            onChange={handleSupplierChange}
            placeholder="เลือกซัพพลายเออร์"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>ชื่อซัพพลายเออร์ (snapshot)</label>
            <input
              type="text"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              maxLength={200}
              placeholder="ชื่อ (บันทึก ณ วันเคลม)"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>เบอร์โทร</label>
            <input
              type="text"
              value={supplierPhone}
              onChange={(e) => setSupplierPhone(e.target.value)}
              maxLength={30}
              placeholder="เบอร์โทรซัพพลายเออร์"
              className={inputCls}
            />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>ที่อยู่ซัพพลายเออร์</label>
            <input
              type="text"
              value={supplierAddress}
              onChange={(e) => setSupplierAddress(e.target.value)}
              maxLength={500}
              placeholder="ที่อยู่"
              className={inputCls}
            />
          </div>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending}
          className="px-6 py-2.5 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
        >
          {isPending ? "กำลังบันทึก..." : "เปิดใบเคลม"}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="px-6 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
};

export default NewClaimForm;
