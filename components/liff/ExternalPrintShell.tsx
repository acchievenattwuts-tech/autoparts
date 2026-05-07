import type { ReactNode } from "react";

import PrintToPdfButton from "@/components/liff/PrintToPdfButton";

export const EXTERNAL_A4_PRINT_ROOT_CLASS =
  "mx-auto flex h-[297mm] w-[210mm] max-w-none flex-col overflow-hidden bg-white p-[6mm] text-[9.5px] leading-tight text-gray-900";

export default function ExternalPrintShell({
  buttonLabel,
  children,
}: {
  buttonLabel: string;
  children: ReactNode;
}) {
  return (
    <>
      <style>{`
        @page { size: A4; margin: 0; }
        :root,
        html,
        body {
          background-color: #ffffff !important;
          background-image: linear-gradient(#ffffff, #ffffff) !important;
          color: #111827 !important;
          color-scheme: light only !important;
          forced-color-adjust: none !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
          -webkit-text-size-adjust: 100% !important;
          text-size-adjust: 100% !important;
        }
        body {
          margin: 0 !important;
          min-height: 100%;
        }
        * {
          color-scheme: light only !important;
          forced-color-adjust: none !important;
        }
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 210mm !important;
            height: 297mm !important;
            min-height: 0 !important;
            max-height: 297mm !important;
            overflow: hidden !important;
            background: #ffffff !important;
          }
          main, [data-liff-print="true"] {
            height: 297mm !important;
            min-height: 0 !important;
            max-height: 297mm !important;
            overflow: hidden !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          body * { visibility: hidden !important; }
          #receipt, #receipt * { visibility: visible !important; }
          #receipt, #receipt * {
            color-scheme: only light !important;
            forced-color-adjust: none !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #receipt {
            position: fixed !important;
            left: 0 !important;
            top: 0 !important;
            width: 210mm !important;
            height: 297mm !important;
            min-height: 0 !important;
            max-height: 297mm !important;
            overflow: hidden !important;
            clip-path: inset(0 0 0 0) !important;
            contain: size paint !important;
            display: flex !important;
            flex-direction: column;
            background-color: #ffffff !important;
            background-image: linear-gradient(#ffffff, #ffffff) !important;
            color: #111827 !important;
            box-sizing: border-box;
            page-break-inside: avoid !important;
            page-break-after: avoid !important;
            break-inside: avoid !important;
            break-after: avoid !important;
          }
          #receipt > *:last-child {
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
          #receipt :is(.bg-white, .bg-white\\/95, .bg-white\\/90, .bg-white\\/80) { background-color: #ffffff !important; }
          #receipt :is(.bg-gray-50, .hover\\:bg-gray-50:hover) { background-color: #f9fafb !important; }
          #receipt :is(.bg-gray-100, .hover\\:bg-gray-100:hover, .bg-gray-200, .hover\\:bg-gray-200:hover) { background-color: #f3f4f6 !important; }
          #receipt :is(.text-gray-950, .text-gray-900, .text-gray-800, .text-gray-700) { color: #111827 !important; }
          #receipt :is(.text-gray-600, .text-gray-500, .text-gray-400) { color: #6b7280 !important; }
          #receipt .text-\\[\\#1e3a5f\\] { color: #1e3a5f !important; }
          .no-print { display: none !important; }
          .receipt-footer { margin-top: auto; }
        }
        @media screen {
          #receipt {
            width: 210mm;
            min-width: 210mm;
            min-height: 297mm;
            max-height: 297mm;
            background-color: #ffffff !important;
            background-image: linear-gradient(#ffffff, #ffffff) !important;
            color: #111827 !important;
          }
        }
      `}</style>

      <main className="min-h-dvh bg-white text-slate-950 [color-scheme:light]" style={{ colorScheme: "only light", backgroundColor: "#ffffff" }}>
        <div className="no-print sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur">
          <div className="mx-auto flex max-w-[900px] flex-col items-end gap-2">
            <PrintToPdfButton label={buttonLabel} />
            <details className="w-full max-w-[420px] rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-900">
              <summary className="cursor-pointer font-medium">หาก PDF มีพื้นหลังสีดำ ให้ปิด Dark Mode</summary>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-[11px] text-amber-800">
                <li>
                  <span className="font-semibold">Chrome (Android):</span> ตั้งค่า → ธีม → เลือก <span className="font-semibold">สว่าง</span>
                </li>
                <li>
                  <span className="font-semibold">Samsung Internet:</span> ตั้งค่า → เลย์เอาต์และเมนู → ปิด <span className="font-semibold">โหมดมืด</span>
                </li>
                <li>
                  <span className="font-semibold">iPhone Safari:</span> ปกติแสดงสีถูกต้อง — ถ้าผิดปกติให้ปิด Dark Mode ของเครื่องชั่วคราว
                </li>
              </ul>
            </details>
          </div>
        </div>
        <div className="overflow-x-auto bg-white px-3 py-3 [color-scheme:light]">{children}</div>
      </main>
    </>
  );
}
