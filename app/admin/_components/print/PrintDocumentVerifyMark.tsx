import type { PrintDocumentVerifyBadge } from "@/lib/verify-token";

const VERIFY_VARIANT_LABEL: Record<PrintDocumentVerifyBadge["variant"], string> = {
  ORIGINAL: "ต้นฉบับ",
  LIFF_COPY: "สำเนา (LIFF)",
};

const getVerifyDisplayUrl = (verifyUrl: string) => {
  try {
    const url = new URL(verifyUrl);
    return `${url.hostname}/verify`;
  } catch {
    return "srivarnparts.com/verify";
  }
};

export default function PrintDocumentVerifyMark({
  verify,
}: {
  verify: PrintDocumentVerifyBadge;
}) {
  const displayUrl = getVerifyDisplayUrl(verify.verifyUrl);

  return (
    <div className="print-document-verify-mark pointer-events-none hidden print:block">
      <div className="print-document-verify-watermark absolute inset-0 z-0 flex items-center justify-center">
        <div className="rotate-[-28deg] select-none font-kanit text-7xl font-black tracking-[0.16em] text-slate-900/10">
          {VERIFY_VARIANT_LABEL[verify.variant]}
        </div>
      </div>
      <div className="print-document-verify-badge absolute bottom-8 right-8 z-10 w-28 rounded-md border border-gray-500 bg-white/90 p-2 text-center text-[9px] leading-tight text-gray-900">
        <div
          className="print-document-verify-qr mx-auto mb-1 h-[84px] w-[84px]"
          aria-hidden="true"
          // Safe: verify.qrSvg มาจาก lib/verify-token ฝั่ง server ที่สร้าง SVG เอง — ไม่ใช่ user input
          dangerouslySetInnerHTML={{ __html: verify.qrSvg }}
        />
        <p className="font-semibold text-gray-900">ตรวจสอบเอกสาร</p>
        <p className="mt-0.5 font-mono text-[7px] text-gray-800">{displayUrl}</p>
      </div>
    </div>
  );
}
