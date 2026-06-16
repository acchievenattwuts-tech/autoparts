"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ScanLine, Sparkles, Upload, X } from "lucide-react";

import ProductSearchSelect from "@/components/shared/ProductSearchSelect";
import type {
  PurchaseOcrExtraction,
  PurchaseOcrMatchConfidence,
} from "@/lib/purchase-invoice-ocr-types";
import { extractPurchaseInvoiceFromImages } from "../ocr-actions";
import type { PurchaseProductOption } from "../purchase-form-data";

const MAX_IMAGES = 10;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Downscale target before upload. Server Actions cap the request body at 3mb
// (next.config.ts), so compress each photo client-side to stay well under it —
// 1280px / JPEG q0.7 keeps an invoice readable for OCR at ~150-250KB per page.
const COMPRESS_MAX_DIMENSION = 1280;
const COMPRESS_JPEG_QUALITY = 0.7;
// Leave headroom below the 3mb server limit for multipart overhead.
const TOTAL_UPLOAD_BUDGET_BYTES = Math.round(2.6 * 1024 * 1024);

/**
 * Downscales an image with a canvas and re-encodes it as JPEG so multi-megabyte
 * phone photos fit under the Server Action body limit. Falls back to the original
 * file if decoding fails or the result isn't smaller. Client-only (uses the DOM).
 */
async function compressImage(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, COMPRESS_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return file;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((result) => resolve(result), "image/jpeg", COMPRESS_JPEG_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    const baseName = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${baseName}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export interface AppliedOcrItem {
  productId: string;
  qty: number;
  unitCost: number;
}

interface Props {
  existingProducts: PurchaseProductOption[];
  onApply: (items: AppliedOcrItem[], chosenProducts: PurchaseProductOption[]) => void;
  disabled?: boolean;
}

const CONFIDENCE_BADGE: Record<
  PurchaseOcrMatchConfidence,
  { label: string; className: string }
> = {
  code: {
    label: "ตรงรหัส",
    className:
      "bg-green-50 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-400/30",
  },
  near: {
    label: "ใกล้เคียง",
    className:
      "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/30",
  },
  none: {
    label: "ไม่พบ",
    className:
      "bg-gray-100 text-gray-500 border-gray-200 dark:bg-slate-700/40 dark:text-slate-400 dark:border-white/10",
  },
};

const PurchaseInvoiceUploader = ({ existingProducts, onApply, disabled = false }: Props) => {
  const [files, setFiles] = useState<File[]>([]);
  const [extraction, setExtraction] = useState<PurchaseOcrExtraction | null>(null);
  const [selectedByLine, setSelectedByLine] = useState<Record<number, string>>({});
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Products pulled in as OCR candidates, kept so a chosen line can be resolved
  // even if the product isn't in the form's initial list.
  const [candidatePool, setCandidatePool] = useState<PurchaseProductOption[]>([]);

  const productPool = useMemo(() => {
    const map = new Map<string, PurchaseProductOption>();
    for (const product of existingProducts) map.set(product.id, product);
    for (const product of candidatePool) map.set(product.id, product);
    return map;
  }, [existingProducts, candidatePool]);

  const mergedProductList = useMemo(() => Array.from(productPool.values()), [productPool]);

  // Derive object-URL previews from files (no setState-in-effect), and revoke them
  // on change/unmount to avoid leaks.
  const previews = useMemo(() => files.map((file) => URL.createObjectURL(file)), [files]);
  useEffect(() => () => previews.forEach((url) => URL.revokeObjectURL(url)), [previews]);

  const resetReview = () => {
    setExtraction(null);
    setSelectedByLine({});
    setCandidatePool([]);
  };

  const handleFilesChosen = (fileList: FileList | null) => {
    if (!fileList) return;
    setError("");
    setInfo("");
    const incoming = Array.from(fileList);

    const invalid = incoming.find(
      (file) => !file.type.startsWith("image/") || file.size > MAX_IMAGE_BYTES,
    );
    if (invalid) {
      setError("รองรับเฉพาะไฟล์รูปภาพ ขนาดไม่เกิน 8MB ต่อรูป");
      return;
    }

    setFiles((prev) => {
      const next = [...prev, ...incoming].slice(0, MAX_IMAGES);
      if (prev.length + incoming.length > MAX_IMAGES) {
        setError(`แนบรูปได้ไม่เกิน ${MAX_IMAGES} รูปต่อครั้ง`);
      }
      return next;
    });
    resetReview();
    if (inputRef.current) inputRef.current.value = "";
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    resetReview();
  };

  const handleScan = () => {
    if (files.length === 0) {
      setError("กรุณาแนบรูปใบส่งของอย่างน้อย 1 รูป");
      return;
    }
    setError("");
    setInfo("");

    startTransition(async () => {
      const compressed = await Promise.all(files.map(compressImage));
      const totalBytes = compressed.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > TOTAL_UPLOAD_BUDGET_BYTES) {
        setError("รูปรวมกันใหญ่เกินไป กรุณาลดจำนวนรูปหรือถ่ายใหม่ให้ชัดแต่ไฟล์เล็กลง");
        return;
      }

      const formData = new FormData();
      for (const file of compressed) formData.append("images", file);

      const result = await extractPurchaseInvoiceFromImages(formData);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const pool = result.data.lines.flatMap((line) => line.candidates);
      setCandidatePool(pool);
      setExtraction(result.data);
      const defaults: Record<number, string> = {};
      result.data.lines.forEach((line, index) => {
        if (line.candidates[0]) defaults[index] = line.candidates[0].id;
      });
      setSelectedByLine(defaults);
    });
  };

  const handleApply = () => {
    if (!extraction) return;
    const items: AppliedOcrItem[] = [];
    const chosen = new Map<string, PurchaseProductOption>();

    extraction.lines.forEach((line, index) => {
      const productId = selectedByLine[index];
      if (!productId) return;
      const product = productPool.get(productId);
      if (!product) return;
      items.push({ productId, qty: line.qty, unitCost: line.unitCost });
      chosen.set(productId, product);
    });

    if (items.length === 0) {
      setError("กรุณาเลือกสินค้าให้ตรงกับรายการอย่างน้อย 1 รายการก่อนเติมลงฟอร์ม");
      return;
    }

    onApply(items, Array.from(chosen.values()));
    setFiles([]);
    resetReview();
    setInfo(
      `เติม ${items.length} รายการลงฟอร์มแล้ว — กรุณาตรวจสอบจำนวน ราคา และหน่วยนับที่ AI กรอกก่อนบันทึก`,
    );
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 dark:border-white/10 dark:bg-[#101b2e]">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100 dark:border-white/10">
        <ScanLine size={18} className="text-[#1e3a5f] dark:text-sky-300" />
        <h2 className="font-kanit text-lg font-semibold text-[#1e3a5f] dark:text-sky-300">
          สแกนใบส่งของด้วย AI
        </h2>
        <span className="text-xs text-gray-400 dark:text-slate-500">
          (ตัวช่วยกรอก — ตรวจสอบก่อนบันทึกทุกครั้ง)
        </span>
      </div>

      {/* Upload zone */}
      <div className="flex flex-wrap items-center gap-3">
        <label
          className={`inline-flex items-center gap-2 px-3 py-2 border border-dashed rounded-lg text-sm font-medium cursor-pointer transition-colors ${
            disabled
              ? "border-gray-200 text-gray-300 cursor-not-allowed dark:border-white/10 dark:text-slate-600"
              : "border-gray-300 text-gray-600 hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/20 dark:text-slate-300 dark:hover:border-sky-500 dark:hover:text-sky-300"
          }`}
        >
          <Upload size={15} />
          แนบรูป (สูงสุด {MAX_IMAGES} รูป)
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            disabled={disabled}
            className="hidden"
            onChange={(event) => handleFilesChosen(event.target.files)}
          />
        </label>

        <button
          type="button"
          onClick={handleScan}
          disabled={disabled || isPending || files.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] hover:bg-[#16304f] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed dark:bg-sky-700 dark:hover:bg-sky-600"
        >
          {isPending ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              กำลังอ่าน...
            </>
          ) : (
            <>
              <Sparkles size={15} /> อ่านด้วย AI
            </>
          )}
        </button>
      </div>

      {/* Previews */}
      {previews.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {previews.map((url, index) => (
            <div
              key={url}
              className="relative h-24 w-24 overflow-hidden rounded-lg border border-gray-200 dark:border-white/10"
            >
              {/* OCR preview only — bare img is intentional (transient object URL, not SEO content) */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`หน้า ${index + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeFile(index)}
                className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                aria-label="ลบรูป"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      )}
      {info && (
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          {info}
        </div>
      )}

      {/* Review panel */}
      {extraction && (
        <div className="mt-5 border-t border-gray-100 pt-4 dark:border-white/10">
          {(extraction.supplierName || extraction.referenceNo || extraction.invoiceDate) && (
            <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-500 dark:text-slate-400">
              {extraction.supplierName && <span>ผู้ขาย: {extraction.supplierName}</span>}
              {extraction.referenceNo && <span>เลขที่เอกสาร: {extraction.referenceNo}</span>}
              {extraction.invoiceDate && <span>วันที่: {extraction.invoiceDate}</span>}
            </div>
          )}

          <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs text-amber-700 mb-3 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300">
            AI อ่านได้ {extraction.lines.length} รายการ — โปรดจับคู่สินค้าให้ถูกต้อง
            ระบบจะไม่กรอกเลข Lot/วันผลิต/วันหมดอายุให้ ต้องกรอกเองในฟอร์ม
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-white/10">
                  <th className="text-left py-2 px-2 text-gray-500 font-medium dark:text-slate-400">ข้อความที่อ่านได้</th>
                  <th className="text-left py-2 px-2 text-gray-500 font-medium w-20 dark:text-slate-400">จำนวน</th>
                  <th className="text-left py-2 px-2 text-gray-500 font-medium w-28 dark:text-slate-400">ทุน/หน่วย</th>
                  <th className="text-left py-2 px-2 text-gray-500 font-medium w-80 dark:text-slate-400">จับคู่สินค้า</th>
                </tr>
              </thead>
              <tbody>
                {extraction.lines.map((line, index) => {
                  const badge = CONFIDENCE_BADGE[line.confidence];
                  const selectedId = selectedByLine[index] ?? "";
                  const selectedProduct = selectedId ? productPool.get(selectedId) ?? null : null;
                  return (
                    <tr key={index} className="border-b border-gray-50 align-top dark:border-white/5">
                      <td className="py-2 px-2">
                        <div className="text-gray-700 dark:text-slate-200">{line.rawText}</div>
                        <div className="mt-1 flex items-center gap-2">
                          {line.partCode && (
                            <span className="font-mono text-xs text-gray-400 dark:text-slate-500">
                              {line.partCode}
                            </span>
                          )}
                          <span className={`inline-block rounded border px-1.5 py-0.5 text-xs ${badge.className}`}>
                            {badge.label}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-2 text-gray-700 dark:text-slate-200">
                        {line.qty > 0 ? line.qty : <span className="text-gray-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="py-2 px-2 text-gray-700 dark:text-slate-200">
                        {line.unitCost > 0
                          ? line.unitCost.toLocaleString("th-TH", { minimumFractionDigits: 2 })
                          : <span className="text-gray-300 dark:text-slate-600">—</span>}
                      </td>
                      <td className="py-2 px-2">
                        <ProductSearchSelect
                          products={mergedProductList}
                          value={selectedId}
                          selectedProduct={selectedProduct}
                          onProductSelect={(product) =>
                            setSelectedByLine((prev) => ({ ...prev, [index]: product.id }))
                          }
                          onChange={(id) => {
                            if (!id) {
                              setSelectedByLine((prev) => {
                                const next = { ...prev };
                                delete next[index];
                                return next;
                              });
                            }
                          }}
                          placeholder="-- เลือก/ค้นหาสินค้า --"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={handleApply}
              className="inline-flex items-center gap-2 px-5 py-2 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Sparkles size={15} /> เติมรายการลงฟอร์ม
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default PurchaseInvoiceUploader;
