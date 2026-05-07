import type { ReactNode } from "react";

import PrintToPdfButton from "@/components/liff/PrintToPdfButton";

export const EXTERNAL_A4_PRINT_ROOT_CLASS =
  "mx-auto flex h-[285mm] w-[198mm] max-w-none flex-col overflow-hidden bg-white p-[6mm] text-[10px] leading-tight text-gray-900";

export default function ExternalPrintShell({
  buttonLabel,
  preloadImageUrls,
  children,
}: {
  buttonLabel: string;
  preloadImageUrls?: (string | null | undefined)[];
  children: ReactNode;
}) {
  const preloadList = (preloadImageUrls ?? []).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return (
    <>
      {preloadList.map((url) => (
        <link key={url} rel="preload" as="image" href={url} fetchPriority="high" />
      ))}
      <style>{`
        @page { size: A4; margin: 6mm; }
        :root,
        html,
        body {
          background: #ffffff !important;
          color: #111827 !important;
          color-scheme: only light !important;
        }
        body {
          margin: 0 !important;
          min-height: 100%;
        }
        * {
          color-scheme: only light !important;
        }
        @media print {
          html, body {
            height: 285mm !important;
            max-height: 285mm !important;
            overflow: hidden !important;
          }
          body * { visibility: hidden; }
          #receipt, #receipt * { visibility: visible; }
          #receipt, #receipt * {
            color-scheme: only light !important;
            forced-color-adjust: none !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          #receipt {
            position: absolute;
            left: 0;
            top: 0;
            width: 198mm !important;
            height: 285mm !important;
            min-height: 285mm !important;
            max-height: 285mm !important;
            overflow: hidden !important;
            display: flex;
            flex-direction: column;
            background: #ffffff !important;
            color: #111827 !important;
            box-sizing: border-box;
            page-break-after: avoid !important;
            page-break-inside: avoid !important;
            break-after: avoid !important;
            break-inside: avoid !important;
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
            width: 198mm;
            min-width: 198mm;
            min-height: 285mm;
            max-height: 285mm;
            background: #ffffff !important;
            color: #111827 !important;
          }
        }
      `}</style>

      <main className="min-h-dvh bg-white text-slate-950 [color-scheme:light]">
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
