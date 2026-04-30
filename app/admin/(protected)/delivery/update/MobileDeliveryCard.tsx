"use client";

import { useState, useTransition } from "react";
import {
  Phone,
  MapPin,
  Truck,
  CheckCircle2,
  PackageCheck,
  Hourglass,
  RotateCcw,
  Save,
  Copy,
  Check,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { updateShippingStatus } from "../../sales/actions";
import {
  SHIPPING_STATUS_LABEL,
  SHIPPING_STATUS_BADGE,
  SHIPPING_METHOD_LABEL,
  SHIPPING_METHOD_OPTIONS,
} from "@/lib/shipping";
import { formatDateThai } from "@/lib/th-date";

type ShippingStatus = "PENDING" | "OUT_FOR_DELIVERY" | "DELIVERED";

type Props = {
  saleId:          string;
  saleNo:          string;
  saleDate:        string;
  customerName:    string;
  customerPhone:   string | null;
  shippingAddress: string | null;
  shippingStatus:  ShippingStatus;
  shippingMethod:  string;
  trackingNo:      string | null;
  netAmount:       number;
  paymentType:     string;
  amountRemain:    number;
};

type StatusActionLabel = {
  label:   string;
  Icon:    typeof Truck;
  variant: "primary" | "success" | "secondary";
};

const STATUS_LABEL_MAP: Record<ShippingStatus, StatusActionLabel> = {
  PENDING:          { label: "รอจัดส่ง", Icon: Hourglass,    variant: "secondary" },
  OUT_FOR_DELIVERY: { label: "กำลังส่ง", Icon: Truck,        variant: "primary"   },
  DELIVERED:        { label: "ส่งแล้ว",  Icon: PackageCheck, variant: "success"   },
};

const VARIANT_CLASS: Record<StatusActionLabel["variant"], string> = {
  primary:
    "bg-[#1e3a5f] text-white hover:bg-[#162d4a] active:scale-[0.98]",
  success:
    "bg-emerald-600 text-white hover:bg-emerald-700 active:scale-[0.98]",
  secondary:
    "bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 active:scale-[0.98] dark:bg-amber-400/10 dark:text-amber-200 dark:border-amber-400/30",
};

const isExternalCarrier = (method: string) =>
  method !== "NONE" && method !== "SELF";

const MobileDeliveryCard = ({
  saleId,
  saleNo,
  saleDate,
  customerName,
  customerPhone,
  shippingAddress,
  shippingStatus,
  shippingMethod,
  trackingNo,
  netAmount,
  paymentType,
  amountRemain,
}: Props) => {
  const [isPending, startTransition]       = useTransition();
  const [trackingInput, setTrackingInput]  = useState(trackingNo ?? "");
  const [error, setError]                  = useState("");
  const [copied, setCopied]                = useState(false);

  const requiresTracking = isExternalCarrier(shippingMethod);
  const trackingChanged  = trackingInput.trim() !== (trackingNo ?? "");

  const otherStatuses = (Object.keys(STATUS_LABEL_MAP) as ShippingStatus[]).filter(
    (s) => s !== shippingStatus,
  );

  const mapsHref = shippingAddress
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shippingAddress)}`
    : null;

  const handleSaveTracking = () => {
    setError("");
    startTransition(async () => {
      const result = await updateShippingStatus(saleId, {
        shippingStatus,
        trackingNo:     trackingInput.trim(),
        shippingMethod,
      });
      if (result?.error) setError(result.error);
    });
  };

  const handleStatusChange = (next: ShippingStatus) => {
    if (
      requiresTracking &&
      (next === "OUT_FOR_DELIVERY" || next === "DELIVERED") &&
      !trackingInput.trim()
    ) {
      setError("กรุณากรอกเลขติดตามสำหรับขนส่งภายนอกก่อนเปลี่ยนสถานะ");
      return;
    }

    const isForward =
      (shippingStatus === "PENDING" && next !== "PENDING") ||
      (shippingStatus === "OUT_FOR_DELIVERY" && next === "DELIVERED");
    const isBackward = !isForward;

    const confirmText =
      next === "DELIVERED"
        ? `ยืนยันว่าส่ง ${saleNo} ถึงลูกค้าแล้วใช่หรือไม่?`
        : isBackward
        ? `ยืนยันการย้อนสถานะ ${saleNo} กลับเป็น "${STATUS_LABEL_MAP[next].label}"?`
        : null;

    if (confirmText && !window.confirm(confirmText)) return;

    setError("");
    startTransition(async () => {
      const result = await updateShippingStatus(saleId, {
        shippingStatus: next,
        trackingNo:     trackingInput.trim(),
        shippingMethod,
      });
      if (result?.error) setError(result.error);
    });
  };

  const handleCopyTracking = async () => {
    if (!trackingInput.trim()) return;
    try {
      await navigator.clipboard.writeText(trackingInput.trim());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable - silently ignore
    }
  };

  const phoneDigits = customerPhone?.replace(/[^0-9+]/g, "") ?? "";

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-900">
      {/* Header: saleNo + status badge */}
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3 dark:border-white/10">
        <div className="min-w-0">
          <p className="font-mono text-base font-semibold text-[#1e3a5f] dark:text-sky-300">
            {saleNo}
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            {formatDateThai(saleDate)}
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${SHIPPING_STATUS_BADGE[shippingStatus]}`}
        >
          {SHIPPING_STATUS_LABEL[shippingStatus]}
        </span>
      </div>

      {/* Customer + address */}
      <div className="space-y-2 px-4 py-3 text-sm">
        <p className="font-medium text-gray-900 dark:text-slate-100">
          {customerName}
        </p>

        {phoneDigits && (
          <a
            href={`tel:${phoneDigits}`}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-400/10 dark:text-blue-300"
          >
            <Phone size={14} />
            {customerPhone}
          </a>
        )}

        {shippingAddress && mapsHref && (
          <a
            href={mapsHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-400/10 dark:text-emerald-300"
          >
            <MapPin size={14} className="mt-0.5 shrink-0" />
            <span className="break-words">{shippingAddress}</span>
          </a>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="text-base font-semibold text-gray-900 dark:text-slate-100">
            ฿{netAmount.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
          </span>
          {paymentType === "CASH_SALE" ? (
            <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-200">
              ชำระแล้ว
            </span>
          ) : (
            <span className="inline-flex rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-400/15 dark:text-orange-200">
              COD ฿{amountRemain.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
            </span>
          )}
        </div>
      </div>

      {/* Method (read-only) + tracking */}
      <div className="space-y-2 border-t border-gray-100 bg-gray-50/50 px-4 py-3 dark:border-white/10 dark:bg-slate-800/30">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-slate-400">วิธีจัดส่ง</span>
          <span className="text-sm font-medium text-gray-700 dark:text-slate-200">
            {SHIPPING_METHOD_OPTIONS[shippingMethod] ??
              SHIPPING_METHOD_LABEL[shippingMethod] ??
              "-"}
          </span>
        </div>

        {isExternalCarrier(shippingMethod) || trackingInput ? (
          <div>
            <label className="mb-1 block text-xs text-gray-500 dark:text-slate-400">
              เลขติดตาม{requiresTracking ? " *" : ""}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                inputMode="text"
                value={trackingInput}
                onChange={(e) => {
                  setTrackingInput(e.target.value);
                  setError("");
                }}
                placeholder={requiresTracking ? "กรอกเลขติดตาม" : "(ไม่บังคับ)"}
                className={`flex-1 rounded-lg border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:bg-slate-900 dark:text-slate-100 ${
                  error ? "border-red-400 bg-red-50 dark:bg-red-500/5" : "border-gray-300 dark:border-white/10"
                }`}
              />
              {trackingInput.trim() && (
                <button
                  type="button"
                  onClick={handleCopyTracking}
                  title="คัดลอกเลขติดตาม"
                  className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300"
                >
                  {copied ? <Check size={16} className="text-emerald-600" /> : <Copy size={16} />}
                </button>
              )}
            </div>
            {trackingChanged && (
              <button
                type="button"
                onClick={handleSaveTracking}
                disabled={isPending}
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-white/10 dark:bg-slate-900 dark:text-slate-200"
              >
                <Save size={13} /> บันทึกเลขติดตาม
              </button>
            )}
          </div>
        ) : null}

        <p className="text-[11px] text-gray-400 dark:text-slate-500">
          เปลี่ยนวิธีจัดส่งได้ที่หน้าบันทึกการขาย
        </p>
      </div>

      {/* Status action buttons */}
      <div className="space-y-2 border-t border-gray-100 px-4 py-3 dark:border-white/10">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-400/20 dark:bg-red-500/5 dark:text-red-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {otherStatuses.map((next) => {
            const meta = STATUS_LABEL_MAP[next];
            const isBackward =
              (shippingStatus === "OUT_FOR_DELIVERY" && next === "PENDING") ||
              (shippingStatus === "DELIVERED" && next !== "DELIVERED");
            const Icon = isBackward ? RotateCcw : meta.Icon;
            return (
              <button
                key={next}
                type="button"
                onClick={() => handleStatusChange(next)}
                disabled={isPending}
                className={`inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
                  isBackward ? VARIANT_CLASS.secondary : VARIANT_CLASS[meta.variant]
                }`}
              >
                {isPending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Icon size={16} />
                )}
                {isBackward ? `ย้อนกลับเป็น "${meta.label}"` : `เปลี่ยนเป็น "${meta.label}"`}
                {next === "DELIVERED" && !isBackward && (
                  <CheckCircle2 size={14} className="opacity-70" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MobileDeliveryCard;
