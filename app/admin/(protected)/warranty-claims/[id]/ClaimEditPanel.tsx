"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, X, Check } from "lucide-react";
import { updateClaim } from "../actions";
import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";

interface Supplier {
  id:      string;
  name:    string;
  phone:   string | null;
  address: string | null;
}

interface Props {
  claimId:         string;
  initialSymptom:  string;
  initialNote:     string;
  initialSupplierId:   string;
  initialSupplierName: string;
  initialSupplierPhone: string;
  initialSupplierAddress: string;
  suppliers:       Supplier[];
}

const inputCls = "w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm";
const labelCls = "block text-xs text-gray-400 mb-0.5";

const ClaimEditPanel = ({
  claimId,
  initialSymptom,
  initialNote,
  initialSupplierId,
  initialSupplierName,
  initialSupplierPhone,
  initialSupplierAddress,
  suppliers,
}: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState("");

  const [symptom,         setSymptom]         = useState(initialSymptom);
  const [note,            setNote]            = useState(initialNote);
  const [supplierId,      setSupplierId]      = useState(initialSupplierId);
  const [supplierName,    setSupplierName]    = useState(initialSupplierName);
  const [supplierPhone,   setSupplierPhone]   = useState(initialSupplierPhone);
  const [supplierAddress, setSupplierAddress] = useState(initialSupplierAddress);

  const handleSupplierChange = (id: string) => {
    setSupplierId(id);
    const s = suppliers.find(s => s.id === id);
    if (s) {
      setSupplierName(s.name);
      setSupplierPhone(s.phone ?? "");
      setSupplierAddress(s.address ?? "");
    } else {
      setSupplierName("");
      setSupplierPhone("");
      setSupplierAddress("");
    }
  };

  const handleSave = () => {
    setError("");
    startTransition(async () => {
      const fd = new FormData();
      fd.set("symptom",         symptom);
      fd.set("note",            note);
      fd.set("supplierId",      supplierId);
      fd.set("supplierName",    supplierName);
      fd.set("supplierPhone",   supplierPhone);
      fd.set("supplierAddress", supplierAddress);
      const res = await updateClaim(claimId, fd);
      if (res.error) { setError(res.error); return; }
      setIsOpen(false);
      router.push("/admin/warranty-claims");
    });
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-2 border border-gray-300 hover:border-[#1e3a5f] text-gray-600 hover:text-[#1e3a5f] text-sm rounded-lg transition-colors"
      >
        <Pencil size={14} /> แก้ไข
      </button>
    );
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-kanit text-base font-semibold text-amber-800">แก้ไขรายละเอียด</h2>
        <button onClick={() => setIsOpen(false)} className="text-amber-600 hover:text-amber-800">
          <X size={18} />
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2 rounded-lg">{error}</div>
      )}

      <div>
        <label className={labelCls}>อาการ / สาเหตุ</label>
        <input type="text" value={symptom} onChange={e => setSymptom(e.target.value)}
          maxLength={500} placeholder="อาการ (ถ้ามี)" className={inputCls} />
      </div>

      <div>
        <label className={labelCls}>หมายเหตุ</label>
        <input type="text" value={note} onChange={e => setNote(e.target.value)}
          maxLength={500} placeholder="หมายเหตุ (ถ้ามี)" className={inputCls} />
      </div>

      <div className="border-t border-amber-200 pt-3">
        <p className="text-xs font-semibold text-amber-700 mb-2">ซัพพลายเออร์</p>
        <div className="space-y-2">
          <div>
            <label className={labelCls}>เลือกซัพพลายเออร์</label>
            <SearchableSelect
              options={suppliers.map((s): SelectOption => ({ id: s.id, label: s.name }))}
              value={supplierId}
              onChange={handleSupplierChange}
              placeholder="เลือกซัพพลายเออร์..."
            />
          </div>
          <div>
            <label className={labelCls}>ชื่อ (กรอกเองได้ถ้าไม่มีในระบบ)</label>
            <input type="text" value={supplierName} onChange={e => setSupplierName(e.target.value)}
              maxLength={200} placeholder="ชื่อซัพพลายเออร์" className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>เบอร์โทร</label>
              <input type="text" value={supplierPhone} onChange={e => setSupplierPhone(e.target.value)}
                maxLength={30} placeholder="เบอร์โทร" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>ที่อยู่</label>
              <input type="text" value={supplierAddress} onChange={e => setSupplierAddress(e.target.value)}
                maxLength={500} placeholder="ที่อยู่" className={inputCls} />
            </div>
          </div>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={isPending}
        className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
      >
        <Check size={15} /> {isPending ? "กำลังบันทึก..." : "บันทึก"}
      </button>
    </div>
  );
};

export default ClaimEditPanel;
