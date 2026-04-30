"use client";

import { useEffect, useRef, useState, useTransition, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
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
  onClose:      () => void;
};

const drawCanvasPaper = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext("2d");
  if (!context) return;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.restore();
};

const canvasToPngFile = (canvas: HTMLCanvasElement): Promise<File> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("signature-export-failed"));
        return;
      }
      resolve(new File([blob], "delivery-signature.png", { type: "image/png" }));
    }, "image/png");
  });

const DeliveryProofSheet = ({ selectedSale, onClose }: Props) => {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [receiverName, setReceiverName] = useState("");
  const [note, setNote] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
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

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(320, Math.round(rect.width));
      const height = Math.max(180, Math.round(rect.height));
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 3;
      context.strokeStyle = "#111827";
      drawCanvasPaper(canvas);
      setIsSignatureEmpty(true);
    };

    resizeCanvas();
    const observer = new ResizeObserver(resizeCanvas);
    observer.observe(canvas);
    return () => observer.disconnect();
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

  const getPoint = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) return;
    const point = getPoint(event);
    drawingRef.current = true;
    canvas.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(point.x, point.y);
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    const point = getPoint(event);
    context.lineTo(point.x, point.y);
    context.stroke();
    setIsSignatureEmpty(false);
  };

  const handlePointerEnd = (event: PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleClearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawCanvasPaper(canvas);
    const context = canvas.getContext("2d");
    if (context) {
      const scale = window.devicePixelRatio || 1;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.lineCap = "round";
      context.lineJoin = "round";
      context.lineWidth = 3;
      context.strokeStyle = "#111827";
    }
    setIsSignatureEmpty(true);
  };

  const resetForm = () => {
    setReceiverName("");
    setNote("");
    setPhotoFile(null);
    setError("");
    handleClearSignature();
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
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerEnd}
                    onPointerCancel={handlePointerEnd}
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
                  <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-center active:scale-[0.99] dark:border-white/15 dark:bg-white/5">
                    {photoPreviewUrl ? (
                      <img
                        src={photoPreviewUrl}
                        alt="ตัวอย่างรูปหลักฐาน"
                        className="max-h-64 w-full rounded-xl object-cover"
                      />
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
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="sr-only"
                      onChange={(event) => {
                        setPhotoFile(event.target.files?.[0] ?? null);
                      }}
                    />
                  </label>
                  {photoFile ? (
                    <button
                      type="button"
                      onClick={() => setPhotoFile(null)}
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
                    disabled={isPending}
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
