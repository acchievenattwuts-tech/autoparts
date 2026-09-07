export const dynamic = "force-dynamic";

import {
  getAuditActorFromSession,
  getRequestContextFromHeaders,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import { getSiteConfig } from "@/lib/site-config";
import {
  buildFormat20File,
  buildRdPrepFile,
  toPayConditionCode,
  type WhtExportPayee,
} from "@/lib/wht-export";

/**
 * ดาวน์โหลดไฟล์นำส่งของรอบยื่นแบบ
 *  - `?format=format20` → ไฟล์ Format กลาง 2.0 สำหรับฝากไฟล์ผ่านโปรแกรม SWC / SWC-UI
 *  - `?format=rdprep`   → ไฟล์ pipe-txt 18 คอลัมน์สำหรับโปรแกรม RD Prep
 *
 * เข้าถึงผ่าน AdminExportLink เท่านั้น (anchor จริง ไม่ prefetch) ตามกฎ repo
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("wht_filings.view");
  const requestContext = getRequestContextFromHeaders(request.headers);

  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") === "rdprep" ? "rdprep" : "format20";

  const [filing, config] = await Promise.all([
    db.whtFiling.findUnique({
      where: { id },
      select: {
        filingNo: true,
        formType: true,
        taxMonth: true,
        taxYear: true,
        submissionType: true,
        additionalSeq: true,
        surchargeAmount: true,
        status: true,
        certificates: {
          where: { status: "ACTIVE" },
          orderBy: [{ payDate: "asc" }, { certNo: "asc" }],
          select: {
            payeeTaxId13: true,
            payeeTaxId10: true,
            payeeBranchNo: true,
            payeeTitleName: true,
            payeeFirstName: true,
            payeeLastName: true,
            payeeAddrNo: true,
            payeeAddrRoad: true,
            payeeAddrSubdistrict: true,
            payeeAddrDistrict: true,
            payeeAddrProvince: true,
            payeeAddrPostcode: true,
            lines: {
              orderBy: { lineNo: "asc" },
              select: {
                payDate: true,
                rate: true,
                baseAmount: true,
                taxAmount: true,
                incomeLabelSnapshot: true,
                payCondition: true,
              },
            },
          },
        },
      },
    }),
    getSiteConfig(),
  ]);

  if (!filing) {
    return new Response("ไม่พบรอบยื่นแบบ", { status: 404 });
  }
  if (filing.formType !== "PND3" && filing.formType !== "PND53") {
    return new Response("รองรับเฉพาะแบบ ภ.ง.ด.3 และ ภ.ง.ด.53", { status: 400 });
  }
  if (!config.taxPayerId) {
    return new Response(
      "ยังไม่ได้ตั้งค่าเลขประจำตัวผู้เสียภาษีของกิจการ — กรอกที่หน้าตั้งค่าข้อมูลกิจการก่อนสร้างไฟล์นำส่ง",
      { status: 400 },
    );
  }

  const payees: WhtExportPayee[] = filing.certificates.map((certificate) => ({
    taxId13: certificate.payeeTaxId13,
    taxId10: certificate.payeeTaxId10,
    branchNo: certificate.payeeBranchNo,
    titleName: certificate.payeeTitleName,
    firstName: certificate.payeeFirstName,
    lastName: certificate.payeeLastName,
    addrNo: certificate.payeeAddrNo,
    moo: null,
    soi: null,
    road: certificate.payeeAddrRoad,
    subdistrict: certificate.payeeAddrSubdistrict,
    district: certificate.payeeAddrDistrict,
    province: certificate.payeeAddrProvince,
    postcode: certificate.payeeAddrPostcode,
    lines: certificate.lines.map((line) => ({
      payDate: line.payDate,
      rate: Number(line.rate),
      baseAmount: Number(line.baseAmount),
      taxAmount: Number(line.taxAmount),
      incomeLabel: line.incomeLabelSnapshot,
      payConditionCode: toPayConditionCode(line.payCondition),
    })),
  }));

  const file =
    format === "rdprep"
      ? {
          ...buildRdPrepFile(payees),
          fileName: `${filing.formType}_RDPrep_${filing.taxYear}${String(filing.taxMonth).padStart(2, "0")}.txt`,
        }
      : buildFormat20File(
          {
            taxType: filing.formType,
            payerTaxId13: config.taxPayerId,
            payerBranchNo: config.taxBranchNo || "000000",
            departmentName: config.shopName,
            taxMonth: filing.taxMonth,
            taxYear: filing.taxYear,
            formTypeCode:
              filing.submissionType === "ADDITIONAL" ? String(filing.additionalSeq).padStart(2, "0") : "00",
            surchargeAmount: Number(filing.surchargeAmount),
            userId: config.taxEfilingUserId,
            formFlag: "1",
          },
          payees,
        );

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    ...requestContext,
    action: AuditAction.EXPORT,
    entityType: "WhtFiling",
    entityId: id,
    entityRef: filing.filingNo,
    meta: { format, fileName: file.fileName, records: payees.length },
  });

  return new Response(file.content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
