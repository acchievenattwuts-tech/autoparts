import PrintDocumentRoot from "@/app/admin/_components/print/PrintDocumentRoot";
import PrintDocumentStatusStamp from "@/app/admin/_components/print/PrintDocumentStatusStamp";
import {
  PRINT_BODY_BORDER_CLASS,
  PRINT_SECTION_BORDER_CLASS,
  formatPrintNumber,
} from "@/app/admin/_components/print/shared";
import { formatDateThai } from "@/lib/th-date";

/**
 * ใบปะหน้าและใบแนบ แบบยื่นรายการภาษีเงินได้หัก ณ ที่จ่าย (ภ.ง.ด.3 / ภ.ง.ด.53)
 * ตามมาตรา 59 แห่งประมวลรัษฎากร — ถ้อยคำและลำดับหัวข้ออ้างอิงแบบฟอร์มของกรมสรรพากรโดยตรง
 *
 * ตั้งใจพิมพ์ลงกระดาษเปล่าแบบเดียวกับหนังสือรับรอง 50 ทวิ
 */

const THAI_MONTHS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];

export interface WhtFilingPrintPayeeLine {
  incomeLabel: string;
  payDate: Date | string;
  rate: number;
  baseAmount: number;
  taxAmount: number;
  payConditionCode: "1" | "2" | "3";
}

export interface WhtFilingPrintPayee {
  sequenceNo: number;
  taxId13: string;
  branchNo: string;
  titleName: string | null;
  firstName: string;
  lastName: string | null;
  address: string;
  lines: WhtFilingPrintPayeeLine[];
}

export interface WhtFilingPrintData {
  filingNo: string;
  formType: "PND3" | "PND53";
  taxMonth: number;
  taxYear: number;
  submissionType: "NORMAL" | "ADDITIONAL";
  additionalSeq: number;
  totalRecords: number;
  totalBaseAmount: number;
  totalTaxAmount: number;
  surchargeAmount: number;
  grandTotalAmount: number;
  status: string;
  filedAt: Date | string | null;
  payees: WhtFilingPrintPayee[];
}

export interface WhtFilingPayerInfo {
  name: string;
  taxId: string;
  branchNo: string;
  address: string;
}

interface Props {
  filing: WhtFilingPrintData;
  payer: WhtFilingPayerInfo;
  rootId?: string;
  rootClassName?: string;
}

const Checkbox = ({ checked }: { checked: boolean }) => (
  <span
    className={`inline-flex h-3 w-3 shrink-0 items-center justify-center ${PRINT_SECTION_BORDER_CLASS} text-[9px] leading-none`}
  >
    {checked ? "✓" : ""}
  </span>
);

const TaxIdBoxes = ({ value }: { value: string }) => {
  const digits = (value ?? "").replace(/\D/g, "").padEnd(13, " ").slice(0, 13).split("");
  return (
    <span className="inline-flex gap-[1px] align-middle">
      {digits.map((digit, index) => (
        <span
          key={index}
          className={`inline-flex h-4 w-[13px] items-center justify-center ${PRINT_SECTION_BORDER_CLASS} font-mono text-[10px] leading-none`}
        >
          {digit.trim()}
        </span>
      ))}
    </span>
  );
};

const FORM_TITLES: Record<string, { code: string; scope: string }> = {
  PND3: {
    code: "ภ.ง.ด.3",
    scope:
      "สำหรับการหักภาษี ณ ที่จ่ายตามมาตรา 3 เตรส และมาตรา 50 (3) (4) (5) กรณีการจ่ายเงินได้พึงประเมินตามมาตรา 40 (5) (6) (7) (8) และเสียภาษีตามมาตรา 48 ทวิ แห่งประมวลรัษฎากร",
  },
  PND53: {
    code: "ภ.ง.ด.53",
    scope:
      "สำหรับการหักภาษี ณ ที่จ่ายตามมาตรา 3 เตรส กรณีผู้ถูกหักภาษี ณ ที่จ่าย เป็นบริษัทหรือห้างหุ้นส่วนนิติบุคคล",
  },
};

const WhtFilingPrintDocument = ({ filing, payer, rootId, rootClassName }: Props) => {
  const form = FORM_TITLES[filing.formType] ?? FORM_TITLES.PND3;
  const isCancelled = filing.status === "CANCELLED";
  const cellClass = `border-r ${PRINT_BODY_BORDER_CLASS} px-1.5 py-1 align-top`;

  return (
    <PrintDocumentRoot rootId={rootId} rootClassName={rootClassName}>
      {isCancelled ? <PrintDocumentStatusStamp label="เอกสารถูกยกเลิกแล้ว" tone="cancelled" /> : null}

      <div data-print-role="header">
        <div className="mb-1 flex items-start justify-between text-[10px]">
          <p className="text-gray-700">เลขที่รอบยื่นในระบบ: {filing.filingNo}</p>
          <p data-print-page-label className="text-gray-600">
            หน้า 1/1
          </p>
        </div>

        <div className="mb-2 text-center">
          <p className="font-kanit text-[15px] font-bold leading-tight">
            แบบยื่นรายการภาษีเงินได้หัก ณ ที่จ่าย {form.code}
          </p>
          <p className="text-[11px] text-gray-700">ตามมาตรา 59 แห่งประมวลรัษฎากร</p>
          <p className="mx-auto mt-1 max-w-[85%] text-[9px] leading-relaxed text-gray-600">{form.scope}</p>
        </div>

        <div className={`mb-2 grid grid-cols-2 gap-3 ${PRINT_SECTION_BORDER_CLASS} p-2 text-[11px]`}>
          <div>
            <p className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-gray-700">เลขประจำตัวผู้เสียภาษีอากร</span>
              <TaxIdBoxes value={payer.taxId} />
            </p>
            <p className="text-[9px] text-gray-500">(ของผู้มีหน้าที่หักภาษี ณ ที่จ่าย)</p>
            <p className="mt-1">
              <span className="text-gray-700">ชื่อผู้มีหน้าที่หักภาษี ณ ที่จ่าย (หน่วยงาน): </span>
              <span className="font-semibold">{payer.name}</span>
            </p>
            <p>
              <span className="text-gray-700">สาขาที่: </span>
              {payer.branchNo || "000000"}
            </p>
            <p className="mt-1">
              <span className="text-gray-700">ที่อยู่: </span>
              {payer.address || "-"}
            </p>
          </div>
          <div>
            <p className="mb-1 text-gray-700">
              เดือนที่จ่ายเงินได้พึงประเมิน · พ.ศ. <span className="font-semibold">{filing.taxYear}</span>
            </p>
            <div className="grid grid-cols-4 gap-x-2 gap-y-0.5">
              {THAI_MONTHS.map((month, index) => (
                <span key={month} className="flex items-center gap-1 whitespace-nowrap text-[10px]">
                  <Checkbox checked={filing.taxMonth === index + 1} />
                  <span className="text-gray-600">({index + 1})</span> {month}
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <span className="flex items-center gap-1">
                <Checkbox checked={filing.submissionType === "NORMAL"} />
                (1) ยื่นปกติ
              </span>
              <span className="flex items-center gap-1">
                <Checkbox checked={filing.submissionType === "ADDITIONAL"} />
                (2) ยื่นเพิ่มเติมครั้งที่{" "}
                {filing.submissionType === "ADDITIONAL" ? filing.additionalSeq : "......"}
              </span>
            </div>
          </div>
        </div>

        <div className={`mb-2 ${PRINT_SECTION_BORDER_CLASS} px-2 py-1.5 text-[11px]`}>
          <p className="flex flex-wrap items-center gap-4">
            <span className="text-gray-700">นำส่งภาษีตาม</span>
            <span className="flex items-center gap-1">
              <Checkbox checked /> (1) มาตรา 3 เตรส
            </span>
            <span className="flex items-center gap-1">
              <Checkbox checked={false} /> (2) มาตรา 48 ทวิ
            </span>
            <span className="flex items-center gap-1">
              <Checkbox checked={false} /> (3) มาตรา 50 (3) (4) (5)
            </span>
          </p>
          <p className="mt-1 text-gray-700">
            มีรายละเอียดการหักเป็นรายผู้มีเงินได้ ปรากฏตามใบแนบ {form.code} ที่แนบมาพร้อมนี้ : จำนวน{" "}
            <span className="font-semibold">{filing.totalRecords}</span> ราย
          </p>
        </div>
      </div>

      <table className="mb-3 w-full text-[11px]">
        <thead>
          <tr className={PRINT_SECTION_BORDER_CLASS}>
            <th className={`${cellClass} text-left font-medium`}>สรุปรายการภาษีที่นำส่ง</th>
            <th className="w-32 px-1.5 py-1 text-right align-top font-medium">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          <tr className={`border-x border-b ${PRINT_BODY_BORDER_CLASS}`}>
            <td className={cellClass}>1. รวมยอดเงินได้ทั้งสิ้น</td>
            <td className="px-1.5 py-1 text-right">{formatPrintNumber(filing.totalBaseAmount)}</td>
          </tr>
          <tr className={`border-x border-b ${PRINT_BODY_BORDER_CLASS}`}>
            <td className={cellClass}>2. รวมยอดภาษีที่นำส่งทั้งสิ้น</td>
            <td className="px-1.5 py-1 text-right">{formatPrintNumber(filing.totalTaxAmount)}</td>
          </tr>
          <tr className={`border-x border-b ${PRINT_BODY_BORDER_CLASS}`}>
            <td className={cellClass}>3. เงินเพิ่ม (ถ้ามี)</td>
            <td className="px-1.5 py-1 text-right">{formatPrintNumber(filing.surchargeAmount)}</td>
          </tr>
          <tr className={`border-x border-b ${PRINT_BODY_BORDER_CLASS} font-semibold`}>
            <td className={cellClass}>4. รวมยอดภาษีที่นำส่งทั้งสิ้นและเงินเพิ่ม (2. + 3.)</td>
            <td className="px-1.5 py-1 text-right">{formatPrintNumber(filing.grandTotalAmount)}</td>
          </tr>
        </tbody>
      </table>

      <div data-print-role="summary" className="mb-3 text-[11px]">
        <p className="mb-3 text-gray-700">
          ข้าพเจ้าขอรับรองว่ารายการที่แจ้งไว้ข้างต้นนี้ เป็นรายการที่ถูกต้องและครบถ้วนทุกประการ
        </p>
        <div className="flex justify-end">
          <div className="w-72 text-center">
            <p>ลงชื่อ ................................................................ ผู้จ่ายเงิน</p>
            <p className="mt-1">(................................................................)</p>
            <p className="mt-1">ตำแหน่ง ................................................................</p>
            <p className="mt-1">
              ยื่นวันที่ ......... เดือน ........................ พ.ศ. ...........
              {filing.filedAt ? ` (${formatDateThai(filing.filedAt)})` : ""}
            </p>
            <p className="mt-1 text-[9px] text-gray-500">ประทับตรานิติบุคคล (ถ้ามี)</p>
          </div>
        </div>
      </div>

      {/* ใบแนบ — รายละเอียดรายผู้มีเงินได้ ลำดับที่ต่อเนื่องกันไปทุกแผ่น */}
      <div className="mb-2 mt-4 border-t border-gray-300 pt-3">
        <p className="mb-2 font-kanit text-[13px] font-bold">ใบแนบ {form.code}</p>
        <table className="w-full text-[10px]">
          <thead>
            <tr className={PRINT_SECTION_BORDER_CLASS}>
              <th className={`${cellClass} w-8 text-center font-medium`}>ลำดับที่</th>
              <th className={`${cellClass} text-left font-medium`}>
                เลขประจำตัวผู้เสียภาษีอากร (ของผู้มีเงินได้) · ชื่อ · ที่อยู่
              </th>
              <th className={`${cellClass} w-24 text-center font-medium`}>วัน เดือน ปี ที่จ่าย</th>
              <th className={`${cellClass} text-left font-medium`}>ประเภทเงินได้</th>
              <th className={`${cellClass} w-12 text-right font-medium`}>อัตรา ร้อยละ</th>
              <th className={`${cellClass} w-24 text-right font-medium`}>จำนวนเงินที่จ่าย</th>
              <th className={`${cellClass} w-24 text-right font-medium`}>ภาษีที่หักและนำส่ง</th>
              <th className="w-10 px-1.5 py-1 text-center align-top font-medium">เงื่อนไข</th>
            </tr>
          </thead>
          <tbody>
            {filing.payees.map((payee) =>
              payee.lines.map((line, lineIndex) => (
                <tr key={`${payee.sequenceNo}-${lineIndex}`} className={`border-x border-b ${PRINT_BODY_BORDER_CLASS}`}>
                  <td className={`${cellClass} text-center`}>{lineIndex === 0 ? payee.sequenceNo : ""}</td>
                  <td className={cellClass}>
                    {lineIndex === 0 ? (
                      <>
                        <p className="font-mono">{payee.taxId13}</p>
                        <p className="font-semibold">
                          {[payee.titleName, payee.firstName, payee.lastName].filter(Boolean).join(" ")}
                        </p>
                        <p className="text-gray-600">{payee.address || "-"}</p>
                      </>
                    ) : null}
                  </td>
                  <td className={`${cellClass} whitespace-nowrap text-center`}>{formatDateThai(line.payDate)}</td>
                  <td className={cellClass}>{line.incomeLabel}</td>
                  <td className={`${cellClass} text-right`}>{formatPrintNumber(line.rate)}</td>
                  <td className={`${cellClass} text-right`}>{formatPrintNumber(line.baseAmount)}</td>
                  <td className={`${cellClass} text-right`}>{formatPrintNumber(line.taxAmount)}</td>
                  <td className="px-1.5 py-1 text-center">{line.payConditionCode}</td>
                </tr>
              )),
            )}
            <tr className={`border-x border-b ${PRINT_BODY_BORDER_CLASS} font-semibold`}>
              <td className={`${cellClass} text-right`} colSpan={5}>
                รวมยอดเงินได้และภาษีที่นำส่ง
              </td>
              <td className={`${cellClass} text-right`}>{formatPrintNumber(filing.totalBaseAmount)}</td>
              <td className={`${cellClass} text-right`}>{formatPrintNumber(filing.totalTaxAmount)}</td>
              <td className="px-1.5 py-1" />
            </tr>
          </tbody>
        </table>
      </div>

      <div data-print-role="footer" className="mt-auto text-[9px] leading-relaxed text-gray-600">
        <p>
          เงื่อนไขการหักภาษีให้กรอกดังนี้ — หัก ณ ที่จ่าย กรอก 1 · ออกให้ตลอดไป กรอก 2 · ออกให้ครั้งเดียว กรอก 3
        </p>
        <p className="mt-0.5">(ให้กรอกลำดับที่ต่อเนื่องกันไปทุกแผ่น ตามเงินได้แต่ละประเภท)</p>
      </div>
    </PrintDocumentRoot>
  );
};

export default WhtFilingPrintDocument;
