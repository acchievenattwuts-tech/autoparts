import type { PrintDocumentVerifyBadge } from "@/lib/verify-token";

const VERIFY_VARIANT_LABEL: Record<PrintDocumentVerifyBadge["variant"], string> = {
  ORIGINAL: "ต้นฉบับ",
  LIFF_COPY: "สำเนา (LIFF)",
};

export default function PrintDocumentVerifyMark({
  verify,
}: {
  verify: PrintDocumentVerifyBadge;
}) {
  return (
    <div className="pointer-events-none hidden print:block">
      <div className="absolute inset-0 z-0 flex items-center justify-center">
        <div className="rotate-[-28deg] select-none font-kanit text-7xl font-black tracking-[0.16em] text-slate-900/5">
          {VERIFY_VARIANT_LABEL[verify.variant]}
        </div>
      </div>
      <div className="absolute bottom-8 right-8 z-10 w-32 rounded-md border border-gray-300 bg-white/90 p-2 text-center text-[9px] leading-tight text-gray-600">
        <div
          className="mx-auto mb-1 h-[92px] w-[92px]"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: verify.qrSvg }}
        />
        <p className="font-semibold text-gray-900">ตรวจสอบเอกสาร</p>
        <p className="mt-0.5 break-all font-mono text-[7px] text-gray-500">{verify.verifyUrl}</p>
      </div>
    </div>
  );
}
