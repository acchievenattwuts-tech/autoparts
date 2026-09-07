import PrintDocumentRoot from "@/app/admin/_components/print/PrintDocumentRoot";
import PrintDocumentStatusStamp from "@/app/admin/_components/print/PrintDocumentStatusStamp";
import {
  PRINT_BODY_BORDER_CLASS,
  PRINT_SECTION_BORDER_CLASS,
  formatPrintNumber,
  formatThaiBahtText,
} from "@/app/admin/_components/print/shared";
import { formatDateThai } from "@/lib/th-date";

/**
 * หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร
 *
 * เลย์เอาต์และถ้อยคำอ้างอิงแบบฟอร์มของกรมสรรพากร (approve_wh3) โดยตรง — หัวข้อ ลำดับข้อ
 * ตารางประเภทเงินได้ 6 ข้อ ช่องกองทุน เงื่อนไขผู้จ่ายเงิน คำเตือน และหมายเหตุท้ายฟอร์ม
 * ตั้งใจพิมพ์ลงกระดาษเปล่า ไม่ใช่พิมพ์ทับแบบฟอร์มสำเร็จรูป (ประกาศอธิบดีฯ ฉบับที่ 62
 * บังคับเฉพาะรายการที่ต้องมีและข้อความกำกับฉบับที่ 1/2 ไม่ได้บังคับชนิดกระดาษ)
 */

export type WhtCertificateCopyKind = "ORIGINAL_1" | "ORIGINAL_2" | "OFFICE_COPY";

const COPY_LABELS: Record<WhtCertificateCopyKind, string> = {
  ORIGINAL_1: "ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)",
  ORIGINAL_2: "ฉบับที่ 2 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)",
  OFFICE_COPY: "สำเนา (สำหรับผู้มีหน้าที่หักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน)",
};

/** ช่อง "ในแบบ" ของฟอร์มราชการ เรียงลำดับ (1)-(7) ตามต้นฉบับ */
const FORM_CHECKBOXES = [
  { no: "1", value: "PND1A", label: "ภ.ง.ด.1ก" },
  { no: "2", value: "PND1A_SPECIAL", label: "ภ.ง.ด.1ก พิเศษ" },
  { no: "3", value: "PND2", label: "ภ.ง.ด.2" },
  { no: "4", value: "PND3", label: "ภ.ง.ด.3" },
  { no: "5", value: "PND2A", label: "ภ.ง.ด.2ก" },
  { no: "6", value: "PND3A", label: "ภ.ง.ด.3ก" },
  { no: "7", value: "PND53", label: "ภ.ง.ด.53" },
] as const;

/** เงื่อนไขผู้จ่ายเงินตามฟอร์ม — (4) อื่น ๆ ไม่ได้ใช้ในระบบนี้ แต่คงไว้ให้ตรงต้นฉบับ */
const PAYER_CONDITIONS = [
  { no: "1", value: "WITHHELD", label: "หัก ณ ที่จ่าย" },
  { no: "2", value: "PAID_ALWAYS", label: "ออกให้ตลอดไป" },
  { no: "3", value: "PAID_ONCE", label: "ออกให้ครั้งเดียว" },
  { no: "4", value: "OTHER", label: "อื่น ๆ (ระบุ)" },
] as const;

/**
 * ประเภทเงินได้ 6 ข้อในฟอร์ม — ประเภทเงินได้ทั้งหมดที่ระบบ seed ไว้อยู่ใต้คำสั่งกรมสรรพากร
 * ตามมาตรา 3 เตรส จึงลงข้อ 5 ทั้งหมด ส่วนข้ออื่นคงไว้ให้ฟอร์มครบตามต้นฉบับ
 */
const INCOME_ROWS = [
  { key: "1", label: "1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)" },
  { key: "2", label: "2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)" },
  { key: "3", label: "3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)" },
  { key: "4A", label: "4. (ก) ดอกเบี้ย ฯลฯ ตามมาตรา 40 (4) (ก)" },
  { key: "4B", label: "     (ข) เงินปันผล เงินส่วนแบ่งกำไร ฯลฯ ตามมาตรา 40 (4) (ข)" },
  {
    key: "5",
    label:
      "5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส เช่น รางวัล ส่วนลดหรือประโยชน์ใด ๆ เนื่องจากการส่งเสริมการขาย รางวัลในการประกวด การแข่งขัน การชิงโชค ค่าแสดงของนักแสดงสาธารณะ ค่าจ้างทำของ ค่าโฆษณา ค่าเช่า ค่าขนส่ง ค่าบริการ ค่าเบี้ยประกันวินาศภัย ฯลฯ",
  },
  { key: "6", label: "6. อื่น ๆ (ระบุ) ....................................................................." },
] as const;

export interface WhtCertificatePrintLine {
  lineNo: number;
  incomeLabelSnapshot: string;
  payDate: Date | string;
  baseAmount: number;
  rate: number;
  taxAmount: number;
  payCondition: "WITHHELD" | "PAID_ALWAYS" | "PAID_ONCE";
}

export interface WhtCertificatePrintData {
  certNo: string;
  bookNo?: string | null;
  filingSequenceNo?: number | null;
  certDate: Date | string;
  formType: string;
  status: string;
  payeeName: string;
  payeeTaxId13: string;
  payeeBranchNo: string;
  payeeAddress: string;
  totalBaseAmount: number;
  totalTaxAmount: number;
  note: string | null;
  lines: WhtCertificatePrintLine[];
}

export interface WhtCertificatePayerInfo {
  name: string;
  taxId: string;
  branchNo: string;
  address: string;
}

interface Props {
  certificate: WhtCertificatePrintData;
  payer: WhtCertificatePayerInfo;
  copyKind: WhtCertificateCopyKind;
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

/** ช่องเลขประจำตัวผู้เสียภาษี 13 หลัก แบบช่องละตัวเลขตามฟอร์มราชการ */
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

const PartyBlock = ({
  title,
  name,
  taxId,
  branchNo,
  address,
}: {
  title: string;
  name: string;
  taxId: string;
  branchNo: string;
  address: string;
}) => (
  <div className="mb-2 text-[11px] leading-relaxed">
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-semibold">{title} : -</span>
      <span className="text-gray-700">เลขประจำตัวผู้เสียภาษีอากร (13 หลัก)*</span>
      <TaxIdBoxes value={taxId} />
      {branchNo ? <span className="text-gray-700">สาขาที่ {branchNo}</span> : null}
    </div>
    <p className="mt-0.5">
      <span className="text-gray-700">ชื่อ </span>
      <span className="font-semibold">{name}</span>
    </p>
    <p className="text-[9px] text-gray-500">(ให้ระบุว่าเป็น บุคคล นิติบุคคล บริษัท สมาคม หรือคณะบุคคล)</p>
    <p className="mt-0.5">
      <span className="text-gray-700">ที่อยู่ </span>
      {address || "-"}
    </p>
    <p className="text-[9px] text-gray-500">
      (ให้ระบุ ชื่ออาคาร/หมู่บ้าน ห้องเลขที่ ชั้นที่ เลขที่ ตรอก/ซอย หมู่ที่ ถนน ตำบล/แขวง อำเภอ/เขต จังหวัด)
    </p>
  </div>
);

const WhtCertificatePrintDocument = ({ certificate, payer, copyKind, rootId, rootClassName }: Props) => {
  const isCancelled = certificate.status === "CANCELLED";
  const activeCondition = certificate.lines[0]?.payCondition ?? "WITHHELD";
  const cellClass = `border-r ${PRINT_BODY_BORDER_CLASS} px-1.5 py-1 align-top`;

  return (
    <PrintDocumentRoot rootId={rootId} rootClassName={rootClassName}>
      {isCancelled ? <PrintDocumentStatusStamp label="เอกสารถูกยกเลิกแล้ว" tone="cancelled" /> : null}

      <div data-print-role="header">
        <div className="mb-1 flex items-start justify-between gap-4 text-[10px]">
          <p className="text-gray-700">{COPY_LABELS[copyKind]}</p>
          <p data-print-page-label className="whitespace-nowrap text-gray-600">
            หน้า 1/1
          </p>
        </div>

        <div className="mb-2 flex items-start justify-between gap-4">
          <div className="w-32" />
          <div className="text-center">
            <p className="font-kanit text-[15px] font-bold leading-tight">หนังสือรับรองการหักภาษี ณ ที่จ่าย</p>
            <p className="text-[11px] text-gray-700">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</p>
          </div>
          <div className="w-40 text-[11px] leading-relaxed">
            <p>เล่มที่ {certificate.bookNo ?? "-"}</p>
            <p>
              เลขที่ <span className="font-semibold">{certificate.certNo}</span>
            </p>
          </div>
        </div>

        <PartyBlock
          title="ผู้มีหน้าที่หักภาษี ณ ที่จ่าย"
          name={payer.name}
          taxId={payer.taxId}
          branchNo={payer.branchNo}
          address={payer.address}
        />
        <PartyBlock
          title="ผู้ถูกหักภาษี ณ ที่จ่าย"
          name={certificate.payeeName}
          taxId={certificate.payeeTaxId13}
          branchNo={certificate.payeeBranchNo}
          address={certificate.payeeAddress}
        />

        <div className={`mb-2 ${PRINT_SECTION_BORDER_CLASS} px-2 py-1.5 text-[11px]`}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="whitespace-nowrap">
              ลำดับที่{" "}
              <span className="font-semibold">
                {certificate.filingSequenceNo != null ? certificate.filingSequenceNo : "________"}
              </span>{" "}
              ในแบบ
            </span>
            {FORM_CHECKBOXES.map((option) => (
              <span key={option.value} className="flex items-center gap-1 whitespace-nowrap">
                <Checkbox checked={certificate.formType === option.value} />
                <span className="text-gray-700">({option.no})</span> {option.label}
              </span>
            ))}
          </div>
          <p className="mt-0.5 text-[9px] text-gray-500">
            (ให้สามารถอ้างอิงหรือสอบยันกันได้ระหว่างลำดับที่ตามหนังสือรับรองฯ กับแบบยื่นรายการภาษีหักที่จ่าย)
          </p>
        </div>
      </div>

      <table className="w-full text-[11px]">
        <thead>
          <tr className={PRINT_SECTION_BORDER_CLASS}>
            <th className={`${cellClass} text-center font-medium`}>ประเภทเงินได้พึงประเมินที่จ่าย</th>
            <th className={`${cellClass} w-24 text-center font-medium`}>
              วัน เดือน
              <br />
              หรือปีภาษี ที่จ่าย
            </th>
            <th className={`${cellClass} w-24 text-center font-medium`}>จำนวนเงินที่จ่าย</th>
            <th className="w-24 px-1.5 py-1 text-center align-top font-medium">
              ภาษีที่หัก
              <br />
              และนำส่งไว้
            </th>
          </tr>
        </thead>
        <tbody>
          {INCOME_ROWS.map((row) => {
            const isSection3Teras = row.key === "5";
            return (
              <tr key={row.key} className={`border-x border-b ${PRINT_BODY_BORDER_CLASS}`}>
                <td className={cellClass}>
                  <p className={isSection3Teras ? "" : "whitespace-pre-line"}>{row.label}</p>
                  {isSection3Teras && certificate.lines.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 pl-4">
                      {certificate.lines.map((line) => (
                        <li key={line.lineNo} className="text-gray-800">
                          • {line.incomeLabelSnapshot} (อัตราร้อยละ {formatPrintNumber(line.rate)})
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </td>
                <td className={`${cellClass} text-center`}>
                  {isSection3Teras
                    ? certificate.lines.map((line) => (
                        <p key={line.lineNo} className="whitespace-nowrap">
                          {formatDateThai(line.payDate)}
                        </p>
                      ))
                    : null}
                </td>
                <td className={`${cellClass} text-right`}>
                  {isSection3Teras
                    ? certificate.lines.map((line) => (
                        <p key={line.lineNo}>{formatPrintNumber(line.baseAmount)}</p>
                      ))
                    : null}
                </td>
                <td className="px-1.5 py-1 text-right align-top">
                  {isSection3Teras
                    ? certificate.lines.map((line) => (
                        <p key={line.lineNo}>{formatPrintNumber(line.taxAmount)}</p>
                      ))
                    : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div data-print-role="summary" className="text-[11px]">
        <table className="w-full">
          <tbody>
            <tr className={`border-x border-b ${PRINT_BODY_BORDER_CLASS} font-semibold`}>
              <td className={`${cellClass} text-right`}>รวมเงินที่จ่ายและภาษีที่หักนำส่ง</td>
              <td className={`${cellClass} w-24`} />
              <td className={`${cellClass} w-24 text-right`}>
                {formatPrintNumber(certificate.totalBaseAmount)}
              </td>
              <td className="w-24 px-1.5 py-1 text-right">{formatPrintNumber(certificate.totalTaxAmount)}</td>
            </tr>
            <tr className={`border-x border-b ${PRINT_BODY_BORDER_CLASS}`}>
              <td className="px-1.5 py-1" colSpan={4}>
                รวมเงินภาษีที่หักนำส่ง (ตัวอักษร){" "}
                <span className="font-semibold">({formatThaiBahtText(certificate.totalTaxAmount)})</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div data-print-role="footer" className="mt-auto text-[11px]">
        <p className={`mb-2 border-x border-b ${PRINT_BODY_BORDER_CLASS} px-1.5 py-1 text-gray-700`}>
          เงินที่จ่ายเข้า กบข./กสจ./กองทุนสงเคราะห์ครูโรงเรียนเอกชน .............. บาท กองทุนประกันสังคม
          .............. บาท กองทุนสำรองเลี้ยงชีพ .............. บาท
        </p>

        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="font-semibold">ผู้จ่ายเงิน</span>
          {PAYER_CONDITIONS.map((option) => (
            <span key={option.value} className="flex items-center gap-1 whitespace-nowrap">
              <Checkbox checked={activeCondition === option.value} />
              <span className="text-gray-700">({option.no})</span> {option.label}
            </span>
          ))}
        </div>

        {certificate.note ? (
          <p className="mb-2 text-gray-700">หมายเหตุ: {certificate.note}</p>
        ) : null}

        <div className="mb-2 grid grid-cols-[minmax(0,4fr)_minmax(0,6fr)] gap-4">
          <p className="text-[9px] leading-relaxed text-gray-600">
            <span className="font-semibold">คำเตือน</span> ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย
            ฝ่าฝืนไม่ปฏิบัติตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร ต้องรับโทษทางอาญาตามมาตรา 35 แห่งประมวลรัษฎากร
          </p>
          <div className="text-center">
            <p className="mb-3 text-gray-700">
              ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ
            </p>
            <p>ลงชื่อ ................................................................ ผู้จ่ายเงิน</p>
            <p className="mt-2">
              ............../.............................../..............
            </p>
            <p className="text-[9px] text-gray-500">(วัน เดือน ปี ที่ออกหนังสือรับรองฯ — {formatDateThai(certificate.certDate)})</p>
            <p className="mt-1 text-[9px] text-gray-500">ประทับตรานิติบุคคล (ถ้ามี)</p>
          </div>
        </div>

        <p className="text-[9px] leading-relaxed text-gray-600">
          <span className="font-semibold">หมายเหตุ</span> เลขประจำตัวผู้เสียภาษีอากร (13 หลัก)* หมายถึง
          1. กรณีบุคคลธรรมดาไทย ให้ใช้เลขประจำตัวประชาชนของกรมการปกครอง
          2. กรณีนิติบุคคล ให้ใช้เลขทะเบียนนิติบุคคลของกรมพัฒนาธุรกิจการค้า
          3. กรณีอื่น ๆ นอกเหนือจาก 1. และ 2. ให้ใช้เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) ของกรมสรรพากร
        </p>
      </div>
    </PrintDocumentRoot>
  );
};

export default WhtCertificatePrintDocument;
