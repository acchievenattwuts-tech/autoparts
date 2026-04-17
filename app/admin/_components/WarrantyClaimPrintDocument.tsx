import PrintDocumentHeader from "@/app/admin/_components/print/PrintDocumentHeader";
import PrintDocumentRoot from "@/app/admin/_components/print/PrintDocumentRoot";
import PrintSignatureGrid from "@/app/admin/_components/print/PrintSignatureGrid";
import {
  PRINT_BODY_BORDER_CLASS,
  PRINT_HEADER_CELL_CLASS,
  PRINT_SECTION_BORDER_CLASS,
  PRINT_SECTION_TOP_BORDER_CLASS,
  PRINT_TABLE_CELL_CLASS,
  formatPrintDate,
  type PrintShopConfig,
} from "@/app/admin/_components/print/shared";

type WarrantyClaimPrintDocumentProps = {
  claim: {
    claimNo: string;
    claimDate: Date | string;
    status: string;
    claimType: string;
    symptom?: string | null;
    note?: string | null;
    signerName?: string | null;
    signerSignatureUrl?: string | null;
    signedAt?: Date | string | null;
    sentAt?: Date | string | null;
    resolvedAt?: Date | string | null;
    returnedAt?: Date | string | null;
    outcome?: string | null;
    warranty: {
      lotNo?: string | null;
      unitSeq: number;
      warrantyDays: number;
      startDate: Date | string;
      endDate: Date | string;
      product: {
        code: string;
        name: string;
      };
      sale: {
        saleNo: string;
        saleDate: Date | string;
        customerName?: string | null;
        customerPhone?: string | null;
      };
    };
  };
  shopConfig: PrintShopConfig;
  statusLabel: Record<string, string>;
  claimTypeLabel: Record<string, string>;
  outcomeLabel: Record<string, string>;
  rootId?: string;
  rootClassName?: string;
};

const WarrantyClaimPrintDocument = ({
  claim,
  shopConfig,
  statusLabel,
  claimTypeLabel,
  outcomeLabel,
  rootId,
  rootClassName,
}: WarrantyClaimPrintDocumentProps) => {
  const customerName = claim.warranty.sale.customerName ?? "-";
  const customerPhone = claim.warranty.sale.customerPhone ?? null;
  const claimSignerName = claim.signerName ?? null;
  const claimSignerSignatureUrl = claim.signerSignatureUrl ?? null;
  const claimSignedDateText = claim.signedAt ? `วันที่ ${formatPrintDate(claim.signedAt)}` : "วันที่ ................................................";

  return (
    <PrintDocumentRoot rootId={rootId} rootClassName={rootClassName}>
      <PrintDocumentHeader shopConfig={shopConfig} title="ใบเคลมสินค้า" />

      <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
        <div className={`space-y-0.5 rounded ${PRINT_SECTION_BORDER_CLASS} p-2`}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">ข้อมูลลูกค้า</p>
          <p>
            <span className="text-gray-500">ชื่อ: </span>
            <span className="font-semibold">{customerName}</span>
          </p>
          {customerPhone ? (
            <p>
              <span className="text-gray-500">โทร: </span>
              {customerPhone}
            </p>
          ) : null}
          <p>
            <span className="text-gray-500">เลขที่ใบขาย: </span>
            <span className="font-mono">{claim.warranty.sale.saleNo}</span>
          </p>
          <p>
            <span className="text-gray-500">วันที่ขาย: </span>
            {formatPrintDate(claim.warranty.sale.saleDate)}
          </p>
        </div>

        <div className={`rounded ${PRINT_SECTION_BORDER_CLASS} p-2`}>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400">ข้อมูลเอกสาร</p>
          <table className="w-full text-xs">
            <tbody>
              <tr>
                <td className="whitespace-nowrap py-0.5 pr-2 text-gray-500">เลขที่ใบเคลม</td>
                <td className="font-mono font-semibold">{claim.claimNo}</td>
              </tr>
              <tr>
                <td className="whitespace-nowrap py-0.5 pr-2 text-gray-500">วันที่เอกสาร</td>
                <td>{formatPrintDate(claim.claimDate)}</td>
              </tr>
              <tr>
                <td className="whitespace-nowrap py-0.5 pr-2 text-gray-500">สถานะ</td>
                <td>{statusLabel[claim.status] ?? claim.status}</td>
              </tr>
              <tr>
                <td className="whitespace-nowrap py-0.5 pr-2 text-gray-500">ประเภทเคลม</td>
                <td>{claimTypeLabel[claim.claimType] ?? claim.claimType}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="bg-gray-100 text-gray-700">
            <th className={`w-7 ${PRINT_HEADER_CELL_CLASS} text-center`}>#</th>
            <th className={`w-24 ${PRINT_HEADER_CELL_CLASS} text-left`}>รหัสสินค้า</th>
            <th className={`${PRINT_HEADER_CELL_CLASS} text-left`}>รายละเอียด</th>
            <th className={`w-16 ${PRINT_HEADER_CELL_CLASS} text-center`}>ลำดับชิ้น</th>
            <th className={`w-20 ${PRINT_HEADER_CELL_CLASS} text-center`}>ประกัน</th>
            <th className={`w-24 ${PRINT_HEADER_CELL_CLASS} text-center`}>หมดประกัน</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className={`${PRINT_TABLE_CELL_CLASS} text-center text-gray-500`}>1</td>
            <td className={`whitespace-nowrap ${PRINT_TABLE_CELL_CLASS} font-mono text-gray-500`}>
              {claim.warranty.product.code}
            </td>
            <td className={PRINT_TABLE_CELL_CLASS}>
              <div className="font-medium text-gray-900">{claim.warranty.product.name}</div>
              <div className="text-[11px] text-gray-500">Lot No: {claim.warranty.lotNo ?? "-"}</div>
            </td>
            <td className={`${PRINT_TABLE_CELL_CLASS} text-center`}>#{claim.warranty.unitSeq}</td>
            <td className={`${PRINT_TABLE_CELL_CLASS} text-center`}>{claim.warranty.warrantyDays} วัน</td>
            <td className={`${PRINT_TABLE_CELL_CLASS} text-center`}>{formatPrintDate(claim.warranty.endDate)}</td>
          </tr>
        </tbody>
      </table>

      <div className="mb-4 grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] text-xs">
        <div className={`border-x border-b ${PRINT_BODY_BORDER_CLASS} p-2`}>
          <p className="mb-1 text-gray-400">อาการ / รายละเอียดการเคลม:</p>
          <p className="min-h-[4rem] text-gray-700">{claim.symptom ?? "-"}</p>
          {claim.note ? (
            <>
              <p className={`mt-3 pt-2 text-gray-400 ${PRINT_SECTION_TOP_BORDER_CLASS}`}>หมายเหตุ:</p>
              <p className="min-h-[2rem] text-gray-700">{claim.note}</p>
            </>
          ) : null}
        </div>
        <div className={`border-r border-b ${PRINT_BODY_BORDER_CLASS} p-2`}>
          <div className="flex justify-between gap-3">
            <span className="text-gray-500">วันที่เริ่มประกัน</span>
            <span>{formatPrintDate(claim.warranty.startDate)}</span>
          </div>
          {claim.sentAt ? (
            <div className="flex justify-between gap-3 pt-1">
              <span className="text-gray-500">วันที่ส่งเคลม</span>
              <span>{formatPrintDate(claim.sentAt)}</span>
            </div>
          ) : null}
          {claim.resolvedAt ? (
            <div className="flex justify-between gap-3 pt-1">
              <span className="text-gray-500">วันที่ปิดเคลม</span>
              <span>{formatPrintDate(claim.resolvedAt)}</span>
            </div>
          ) : null}
          {claim.returnedAt ? (
            <div className="flex justify-between gap-3 pt-1">
              <span className="text-gray-500">วันที่ส่งคืนลูกค้า</span>
              <span>{formatPrintDate(claim.returnedAt)}</span>
            </div>
          ) : null}
          {claim.outcome ? (
            <div className={`mt-2 flex justify-between gap-3 pt-2 ${PRINT_SECTION_TOP_BORDER_CLASS}`}>
              <span className="font-medium text-gray-900">ผลการเคลม</span>
              <span className="font-medium text-[#1e3a5f]">{outcomeLabel[claim.outcome] ?? claim.outcome}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="claim-footer mt-auto">
        <PrintSignatureGrid
          columns={[
            {
              label: "ผู้รับเคลม / เจ้าหน้าที่ร้าน",
              nameText: claimSignerName,
              showNameLine: true,
              dateText: claimSignedDateText,
              signatureUrl: claimSignerSignatureUrl,
              signatureAlt: claimSignerName ? `ลายเซ็น ${claimSignerName}` : "ลายเซ็นผู้รับเคลม",
            },
            {
              label: "ลูกค้า",
              nameText: "\u00A0",
              showNameLine: true,
              dateText: "วันที่ ................................................",
            },
          ]}
          className="text-center text-xs"
        />
      </div>
    </PrintDocumentRoot>
  );
};

export default WarrantyClaimPrintDocument;
