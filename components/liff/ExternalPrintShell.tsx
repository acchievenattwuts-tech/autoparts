import type { ReactNode } from "react";

import PrintToPdfButton from "@/components/liff/PrintToPdfButton";

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
        @page { margin: 0; }
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
            background: #ffffff !important;
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
            width: 210mm !important;
            display: flex;
            flex-direction: column;
            min-height: 100vh;
            background-color: #ffffff !important;
            background-image: linear-gradient(#ffffff, #ffffff) !important;
            color: #111827 !important;
            page-break-after: avoid !important;
            break-after: avoid !important;
          }
          .no-print { display: none !important; }
          .receipt-footer { margin-top: auto; }
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
