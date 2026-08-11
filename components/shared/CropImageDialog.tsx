"use client";

import { useEffect, useRef, useState } from "react";
import ReactCrop, {
  centerCrop,
  makeAspectCrop,
  type Crop,
  type PixelCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { Loader2, X } from "lucide-react";

const OUTPUT_SIZE = 800;
const ASPECT = 1;
const JPEG_QUALITY = 0.9;
const DEFAULT_BACKGROUND_COLOR = "#ffffff";

interface Props {
  file: File | null;
  index: number;
  total: number;
  onCancel: () => void;
  onConfirm: (croppedFile: File) => void;
  /**
   * Draw the selection as a circle. The exported file stays a 1:1 square — the
   * circle is where the consumer masks it — so this only changes what the admin
   * sees while framing. Used by category thumbnails, which render in a circle.
   */
  circular?: boolean;
  /** Flat colour painted under the crop. Match the surface the image renders on. */
  backgroundColor?: string;
  /** Overrides the "รูปที่ n / m" line when a caller crops a single image. */
  subtitle?: string;
}

const CropImageDialog = ({
  file,
  index,
  total,
  onCancel,
  onConfirm,
  circular = false,
  backgroundColor = DEFAULT_BACKGROUND_COLOR,
  subtitle,
}: Props) => {
  const [src, setSrc] = useState<string>("");
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!file) {
      setSrc("");
      return;
    }
    const url = URL.createObjectURL(file);
    setSrc(url);
    setCrop(undefined);
    setCompletedCrop(null);
    setErrorMessage("");
    setIsProcessing(false);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [file, onCancel]);

  const onImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { width, height } = e.currentTarget;
    const initial = centerCrop(
      makeAspectCrop({ unit: "%", width: 90 }, ASPECT, width, height),
      width,
      height,
    );
    setCrop(initial);
  };

  const handleConfirm = async () => {
    if (!imgRef.current || !completedCrop || !file) return;
    setIsProcessing(true);
    setErrorMessage("");
    try {
      const image = imgRef.current;
      const scaleX = image.naturalWidth / image.width;
      const scaleY = image.naturalHeight / image.height;
      const sx = completedCrop.x * scaleX;
      const sy = completedCrop.y * scaleY;
      const sw = completedCrop.width * scaleX;
      const sh = completedCrop.height * scaleY;

      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT_SIZE;
      canvas.height = OUTPUT_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("ไม่สามารถสร้าง canvas context ได้");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
      );
      if (!blob) throw new Error("แปลงรูปไม่สำเร็จ");
      const safeName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
      const cropped = new File([blob], safeName, { type: "image/jpeg" });
      onConfirm(cropped);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "เกิดข้อผิดพลาด");
      setIsProcessing(false);
    }
  };

  if (!file) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-3xl rounded-2xl bg-white shadow-xl dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/10">
          <div>
            <h3 className="text-base font-semibold text-gray-900 dark:text-slate-100">
              ปรับขนาดรูปภาพ
            </h3>
            <p className="text-xs text-gray-500 dark:text-slate-400">
              {subtitle ?? `รูปที่ ${index + 1} / ${total}`} • อัตราส่วน 1:1 ({OUTPUT_SIZE}×
              {OUTPUT_SIZE})
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-800 disabled:opacity-50"
            aria-label="ปิด"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex max-h-[60vh] items-center justify-center overflow-auto bg-gray-50 p-4 dark:bg-slate-950">
          {src && (
            <ReactCrop
              crop={crop}
              onChange={(_, percentCrop) => setCrop(percentCrop)}
              onComplete={(c) => setCompletedCrop(c)}
              aspect={ASPECT}
              circularCrop={circular}
              keepSelection
              minWidth={40}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={src}
                alt="crop preview"
                onLoad={onImageLoad}
                style={{ maxHeight: "55vh" }}
              />
            </ReactCrop>
          )}
        </div>

        {errorMessage && (
          <p className="px-5 pt-3 text-xs text-red-500 dark:text-red-400">{errorMessage}</p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            ข้าม
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isProcessing || !completedCrop}
            className="inline-flex items-center gap-2 rounded-lg bg-[#1e3a5f] px-5 py-2 text-sm font-medium text-white hover:bg-[#163055] disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500"
          >
            {isProcessing && <Loader2 size={14} className="animate-spin" />}
            ยืนยัน
          </button>
        </div>
      </div>
    </div>
  );
};

export default CropImageDialog;
