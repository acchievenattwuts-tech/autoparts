"use client";

import { useRouter } from "next/navigation";
import type SignaturePad from "signature_pad";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  Camera,
  Eraser,
  Image as ImageIcon,
  Loader2,
  PenLine,
  Save,
  StickyNote,
  UserRound,
  X,
} from "lucide-react";

import {
  getLatestDeliveryProof,
  saveDeliveryProof,
  type DeliveryProofDetail,
} from "../../sales/actions";
import { formatDateThai } from "@/lib/th-date";

export type DeliveryProofSheetSale = {
  saleId:      string;
  saleNo:      string;
  customerName: string;
  proofCount:  number;
};

type Props = {
  selectedSale: DeliveryProofSheetSale | null;
  canUpdate: boolean;
  onClose:      () => void;
};

const SIGNATURE_CANVAS_MIN_WIDTH = 320;
const SIGNATURE_CANVAS_MIN_HEIGHT = 180;
const DELIVERY_PHOTO_MAX_SIZE_MB = 1.5;
const DELIVERY_PHOTO_MAX_DIMENSION = 1600;
const BYTES_PER_MB = 1024 * 1024;

const canvasToPngFile = (canvas: HTMLCanvasElement): Promise<File> =>
  new Promise((resolve, reject) => {
    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = canvas.width;
    outputCanvas.height = canvas.height;
    const context = outputCanvas.getContext("2d");
    if (!context) {
      reject(new Error("signature-export-failed"));
      return;
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
    context.drawImage(canvas, 0, 0);

    outputCanvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("signature-export-failed"));
        return;
      }
      resolve(new File([blob], "delivery-signature.png", { type: "image/png" }));
    }, "image/png");
  });

const formatFileSize = (size: number) => {
  if (size < BYTES_PER_MB) {
    return `${Math.max(1, Math.round(size / 1024)).toLocaleString("th-TH")} KB`;
  }

  return `${(size / BYTES_PER_MB).toLocaleString("th-TH", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  })} MB`;
};

const DeliveryProofSheet = ({ selectedSale, canUpdate: _canUpdate, onClose }: Props) => {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const signaturePadRef = useRef<SignaturePad | null>(null);
  const [receiverName, setReceiverName] = useState("");
  const [note, setNote] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoCompressionLabel, setPhotoCompressionLabel] = useState("");
  const [isCompressingPhoto, setIsCompressingPhoto] = useState(false);
  const [photoCompressionProgress, setPhotoCompressionProgress] = useState(0);
  const [isSignatureEmpty, setIsSignatureEmpty] = useState(true);
  const [error, setError] = useState("");
  const [latestProof, setLatestProof] = useState<DeliveryProofDetail | null>(null);
  const [isLoadingProof, setIsLoadingProof] = useState(false);
  const [isPending, startTransition] = useTransition();
  const isOpen = Boolean(selectedSale);

  useEffect(() => {
    if (!selectedSale) {
      setLatestProof(null);
      setIsLoadingProof(false);
      return;
    }

    let ignore = false;
    setReceiverName("");
    setNote("");
    setPhotoFile(null);
    setPhotoCompressionLabel("");
    setPhotoCompressionProgress(0);
    setIsSignatureEmpty(true);
    setLatestProof(null);
    setError("");
    setIsLoadingProof(true);

    startTransition(async () => {
      const result = await getLatestDeliveryProof(selectedSale.saleId);
      if (ignore) return;
      setIsLoadingProof(false);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setLatestProof(result.proof ?? null);
    });

    return () => {
      ignore = true;
    };
  }, [selectedSale]);

  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let activeSignaturePad: SignaturePad | null = null;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(SIGNATURE_CANVAS_MIN_WIDTH, Math.round(rect.width));
      const height = Math.max(SIGNATURE_CANVAS_MIN_HEIGHT, Math.round(rect.height));
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      signaturePadRef.current?.clear();
      setIsSignatureEmpty(true);
    };

    resizeCanvas();
    const handleEndStroke = () => {
      if (activeSignaturePad) {
        setIsSignatureEmpty(activeSignaturePad.isEmpty());
      }
    };

    void import("signature_pad").then(({ default: SignaturePadCtor }) => {
      if (disposed) return;
      activeSignaturePad = new SignaturePadCtor(canvas, {
        backgroundColor: "#ffffff",
        penColor: "#111827",
        minWidth: 0.8,
        maxWidth: 2.8,
        throttle: 16,
        minDistance: 3,
      });
      signaturePadRef.current = activeSignaturePad;
      activeSignaturePad.addEventListener("endStroke", handleEndStroke);
    });

    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas);
    return () => {
      disposed = true;
      observer.disconnect();
      activeSignaturePad?.removeEventListener("endStroke", handleEndStroke);
      activeSignaturePad?.off();
      signaturePadRef.current = null;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreviewUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [photoFile]);

  const handleClearSignature = () => {
    signaturePadRef.current?.clear();
    setIsSignatureEmpty(true);
  };

  const resetForm = () => {
    setReceiverName("");
    setNote("");
    setPhotoFile(null);
    setPhotoCompressionLabel("");
    setPhotoCompressionProgress(0);
    setError("");
    handleClearSignature();
  };

  const handlePhotoChange = async (file: File | null) => {
    setError("");
    setPhotoCompressionLabel("");
    setPhotoCompressionProgress(0);

    if (!file) {
      setPhotoFile(null);
      return;
    }

    setIsCompressingPhoto(true);
    try {
      const { default: imageCompression } = await import("browser-image-compression");
      const compressedFile = await imageCompression(file, {
        maxSizeMB: DELIVERY_PHOTO_MAX_SIZE_MB,
        maxWidthOrHeight: DELIVERY_PHOTO_MAX_DIMENSION,
        useWebWorker: true,
        libURL: "/vendor/browser-image-compression.js",
        initialQuality: 0.82,
        fileType: file.type || undefined,
        onProgress: (progress) => setPhotoCompressionProgress(progress),
      });

      setPhotoFile(compressedFile);
      if (compressedFile.size < file.size) {
        setPhotoCompressionLabel(
          `ปรับรูปจาก ${formatFileSize(file.size)} เหลือ ${formatFileSize(compressedFile.size)}`,
        );
      } else {
        setPhotoCompressionLabel(`รูปพร้อมอัปโหลด ${formatFileSize(compressedFile.size)}`);
      }
    } catch (err) {
      console.error("[compressDeliveryPhoto]", err);
      setPhotoFile(file);
      setPhotoCompressionLabel(`ใช้ไฟล์ต้นฉบับ ${formatFileSize(file.size)}`);
    } finally {
      setIsCompressingPhoto(false);
      setPhotoCompressionProgress(0);
    }
  };

  const handleOpenCamera = () => {
    cameraInputRef.current?.click();
  };

  const handleOpenGallery = () => {
    galleryInputRef.current?.click();
  };

  const handleSubmit = () => {
    if (!selectedSale) return;
    setError("");
    startTransition(async () => {
      const formData = new FormData();
      formData.set("saleId", selectedSale.saleId);
      formData.set("receiverName", receiverName);
      formData.set("note", note);

      try {
        const canvas = canvasRef.current;
        if (canvas && !isSignatureEmpty) {
          formData.set("signatureImage", await canvasToPngFile(canvas));
        }
      } catch {
        setError("ไม่สามารถบันทึกลายเซ็นได้ กรุณาลองใหม่");
        return;
      }

      if (photoFile) {
        formData.set("deliveryPhoto", photoFile);
      }

      const result = await saveDeliveryProof(formData);
      if (result?.error) {
        setError(result.error);
        return;
      }

      resetForm();
      onClose();
      router.refresh();
    });
  };

  if (!selectedSale) return null;

  return (
    <>
      {isOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm">
          <div className="flex min-h-dvh items-end justify-center sm:items-center">
            <section className="max-h-[96dvh] w-full overflow-y-auto rounded-t-[28px] bg-slate-50 shadow-2xl dark:bg-slate-950 sm:max-w-lg sm:rounded-[28px]">
              <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-slate-900/95">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm font-semibold text-[#1e3a5f] dark:text-sky-300">
                      {selectedSale.saleNo}
                    </p>
                    <h2 className="mt-0.5 truncate font-kanit text-xl font-bold text-gray-900 dark:text-slate-100">
                      หลักฐานรับของ
                    </h2>
                    <p className="truncate text-xs text-gray-500 dark:text-slate-400">
                      {selectedSale.customerName}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-600 active:scale-95 dark:border-white/10 dark:bg-slate-800 dark:text-slate-200"
                    aria-label="ปิด"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              <div className="space-y-4 px-4 py-4">
                {isLoadingProof ? (
                  <div className="rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-500 shadow-sm dark:border-white/10 dark:bg-slate-900 dark:text-slate-400">
                    <Loader2 size={16} className="mr-2 inline animate-spin" />
                    กำลังโหลดหลักฐานล่าสุด...
                  </div>
                ) : null}

                {latestProof ? (
                  <div className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm dark:border-emerald-400/20 dark:bg-slate-900">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-200">
                          หลักฐานล่าสุด
                        </p>
                        <p className="text-xs text-gray-500 dark:text-slate-400">
                          {formatDateThai(latestProof.capturedAt)}
                        </p>
                      </div>
                      <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200">
                        {selectedSale.proofCount.toLocaleString("th-TH")} รายการ
                      </span>
                    </div>
                    <div className="grid gap-3">
                      {latestProof.receiverName ? (
                        <p className="text-sm text-gray-700 dark:text-slate-200">
                          ผู้รับ: <span className="font-semibold">{latestProof.receiverName}</span>
                        </p>
                      ) : null}
                      {latestProof.signatureImageUrl ? (
                        <div className="rounded-2xl border border-gray-200 bg-white p-2">
                          <img
                            src={latestProof.signatureImageUrl}
                            alt="ลายเซ็นผู้รับ"
                            loading="lazy"
                            className="h-28 w-full rounded-xl object-contain"
                          />
                        </div>
                      ) : null}
                      {latestProof.deliveryPhotoUrl ? (
                        <img
                          src={latestProof.deliveryPhotoUrl}
                          alt="รูปหลักฐานการส่ง"
                          loading="lazy"
                          className="max-h-56 w-full rounded-2xl object-cover"
                        />
                      ) : null}
                      {latestProof.note ? (
                        <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-white/5 dark:text-slate-300">
                          {latestProof.note}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
                  <label className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-slate-100">
                    <UserRound size={16} /> ชื่อผู้รับ
                  </label>
                  <input
                    type="text"
                    value={receiverName}
                    onChange={(event) => setReceiverName(event.target.value)}
                    placeholder="เช่น คุณสมชาย, ฝาก รปภ., ลูกค้าไม่สะดวกเซ็น"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/15 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                    maxLength={100}
                  />
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <label className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-slate-100">
                      <PenLine size={16} /> ลายเซ็นผู้รับ
                    </label>
                    <button
                      type="button"
                      onClick={handleClearSignature}
                      className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 active:scale-95 dark:border-white/10 dark:text-slate-300"
                    >
                      <Eraser size={13} /> ล้าง
                    </button>
                  </div>
                  <canvas
                    ref={canvasRef}
                    className="h-48 w-full rounded-2xl border border-gray-300 bg-white [touch-action:none]"
                    aria-label="พื้นที่เซ็นชื่อ"
                  />
                  <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
                    ช่องเซ็นเป็นพื้นขาวเสมอ เพื่อให้รูปย้อนหลังอ่านได้ชัดทั้ง light/dark mode
                  </p>
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
                  <label className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-slate-100">
                    <Camera size={16} /> รูปหน้าบ้านหรือจุดวางของ
                  </label>
                  <div className="flex min-h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-center dark:border-white/15 dark:bg-white/5">
                    {photoPreviewUrl ? (
                      <img
                        src={photoPreviewUrl}
                        alt="ตัวอย่างรูปหลักฐาน"
                        className="max-h-64 w-full rounded-xl object-cover"
                      />
                    ) : isCompressingPhoto ? (
                      <>
                        <Loader2 size={28} className="animate-spin text-gray-400 dark:text-slate-500" />
                        <span className="mt-2 text-sm font-medium text-gray-700 dark:text-slate-200">
                          กำลังปรับขนาดรูป {photoCompressionProgress.toLocaleString("th-TH", { maximumFractionDigits: 0 })}%
                        </span>
                      </>
                    ) : (
                      <>
                        <ImageIcon size={28} className="text-gray-400 dark:text-slate-500" />
                        <span className="mt-2 text-sm font-medium text-gray-700 dark:text-slate-200">
                          แตะเพื่อถ่ายรูปหรือเลือกรูป
                        </span>
                        <span className="mt-1 text-xs text-gray-400 dark:text-slate-500">
                          รองรับ JPEG, PNG, WebP สูงสุด 5MB
                        </span>
                      </>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={handleOpenCamera}
                      disabled={isCompressingPhoto}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1e3a5f] px-3 py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-60 dark:bg-sky-600"
                    >
                      <Camera size={16} />
                      ถ่ายรูป
                    </button>
                    <button
                      type="button"
                      onClick={handleOpenGallery}
                      disabled={isCompressingPhoto}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-semibold text-gray-700 transition active:scale-[0.98] disabled:opacity-60 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200"
                    >
                      <ImageIcon size={16} />
                      เลือกรูป
                    </button>
                  </div>
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="sr-only"
                    onChange={(event) => {
                      void handlePhotoChange(event.target.files?.[0] ?? null);
                      event.currentTarget.value = "";
                    }}
                  />
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => {
                      void handlePhotoChange(event.target.files?.[0] ?? null);
                      event.currentTarget.value = "";
                    }}
                  />
                  {photoCompressionLabel ? (
                    <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-300">
                      {photoCompressionLabel}
                    </p>
                  ) : null}
                  {photoFile ? (
                    <button
                      type="button"
                      onClick={() => void handlePhotoChange(null)}
                      className="mt-2 rounded-full border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 dark:border-white/10 dark:text-slate-300"
                    >
                      ลบรูปนี้
                    </button>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
                  <label className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-slate-100">
                    <StickyNote size={16} /> หมายเหตุ
                  </label>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="เช่น ฝากไว้หน้าบ้าน, ลูกค้าไม่อยู่, ลูกค้าไม่สะดวกเซ็น"
                    className="min-h-24 w-full resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-base text-gray-900 outline-none focus:border-[#1e3a5f] focus:ring-2 focus:ring-[#1e3a5f]/15 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
                    maxLength={500}
                  />
                </div>

                {error ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/20 dark:bg-red-500/5 dark:text-red-300">
                    {error}
                  </div>
                ) : null}

                <div className="sticky bottom-0 -mx-4 border-t border-gray-200 bg-slate-50/95 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-slate-950/95">
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isPending || isCompressingPhoto}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#1e3a5f] px-4 py-4 text-base font-bold text-white shadow-lg shadow-slate-900/10 transition active:scale-[0.98] disabled:opacity-60 dark:bg-sky-600"
                  >
                    {isPending ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                    บันทึกหลักฐาน
                  </button>
                </div>
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </>
  );
};

export default DeliveryProofSheet;
