import type { PrintDocumentVerifyBadge } from "@/lib/verify-token";

const getVerifyDisplayUrl = (verifyUrl: string) => {
  try {
    const url = new URL(verifyUrl);
    return `${url.hostname}/verify`;
  } catch {
    return "srivarnparts.com/verify";
  }
};

/**
 * ป้าย QR ตรวจสอบเอกสาร — เรนเดอร์เป็น "ช่องหนึ่ง" ในตารางลายเซ็น
 * (PrintSignatureGrid) ไม่ใช่ overlay ลอยทับกระดาษอีกต่อไป
 *
 * เดิมป้ายนี้เป็น absolute อยู่มุมขวาล่าง ทำให้ตารางลายเซ็นต้องเว้น margin-right
 * ไว้หลบ ขอบขวาของเอกสารเลยเป็นขั้นบันไดเทียบกับกรอบอื่นในหน้าเดียวกัน
 * พอย้ายเข้ามาเป็นช่องในตาราง ขอบขวาและความสูงตรงกันเองโดยไม่ต้องตั้งค่าชดเชย
 */
export default function PrintDocumentVerifyMark({
  verify,
}: {
  verify: PrintDocumentVerifyBadge;
}) {
  const displayUrl = getVerifyDisplayUrl(verify.verifyUrl);

  return (
    <div className="print-document-verify-badge flex flex-col items-center justify-center px-2 py-2 text-center text-[9px] leading-tight text-gray-900">
      <div
        className="print-document-verify-qr h-[84px] w-[84px]"
        aria-hidden="true"
        // Safe: verify.qrSvg มาจาก lib/verify-token ฝั่ง server ที่สร้าง SVG เอง — ไม่ใช่ user input
        dangerouslySetInnerHTML={{ __html: verify.qrSvg }}
      />
      <p className="mt-1 font-semibold text-gray-900">ตรวจสอบเอกสาร</p>
      <p className="mt-0.5 font-mono text-[7px] text-gray-800">{displayUrl}</p>
    </div>
  );
}
