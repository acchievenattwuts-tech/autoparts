import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";

import { db } from "@/lib/db";
import { formatDateThai } from "@/lib/th-date";
import { verifyDocumentToken, type VerifyDocumentType } from "@/lib/verify-token";

export const dynamic = "force-dynamic";

const DOCUMENT_TYPE_LABEL: Record<VerifyDocumentType, string> = {
  sale: "ใบขาย / ใบแจ้งหนี้ / ใบส่งของ",
  receipt: "ใบเสร็จรับเงิน",
};

function isVerifyDocumentType(value: string): value is VerifyDocumentType {
  return value === "sale" || value === "receipt";
}

export default async function VerifyDocumentPage({
  params,
}: {
  params: Promise<{ type: string; docNo: string; token: string }>;
}) {
  const { type, docNo, token } = await params;
  const decodedDocNo = decodeURIComponent(docNo);
  const documentType = isVerifyDocumentType(type) ? type : null;
  const tokenValid = documentType
    ? verifyDocumentToken({ type: documentType, docNo: decodedDocNo, token })
    : false;
  const document = documentType && tokenValid
    ? await loadVerifyDocument({ type: documentType, docNo: decodedDocNo })
    : null;
  const isValid = Boolean(tokenValid && document);

  return (
    <main className="min-h-dvh bg-slate-100 px-5 py-8">
      <section className="mx-auto max-w-lg rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        {isValid ? (
          <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
        ) : (
          <XCircle className="mx-auto h-14 w-14 text-rose-600" />
        )}
        <h1 className="mt-4 font-kanit text-2xl font-bold text-slate-950">
          {isValid ? "เอกสารถูกต้อง" : "ตรวจสอบเอกสารไม่สำเร็จ"}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {isValid
            ? "QR นี้ออกโดยระบบศรีวรรณ อะไหล่แอร์"
            : "ลิงก์ตรวจสอบไม่ถูกต้อง หมดอายุ หรือไม่พบเอกสารในระบบ"}
        </p>

        <dl className="mt-6 space-y-3 rounded-2xl bg-slate-50 p-4 text-left text-sm">
          <div>
            <dt className="text-slate-500">ประเภทเอกสาร</dt>
            <dd className="font-semibold text-slate-950">
              {documentType ? DOCUMENT_TYPE_LABEL[documentType] : "-"}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">เลขที่เอกสาร</dt>
            <dd className="font-mono font-semibold text-slate-950">{decodedDocNo}</dd>
          </div>
          {document ? (
            <>
              <div>
                <dt className="text-slate-500">วันที่เอกสาร</dt>
                <dd className="font-semibold text-slate-950">{formatDateThai(document.date)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">ลูกค้า</dt>
                <dd className="font-semibold text-slate-950">{document.customerName ?? "-"}</dd>
              </div>
              <div>
                <dt className="text-slate-500">ยอดเอกสาร</dt>
                <dd className="font-semibold text-slate-950">
                  {Number(document.amount).toLocaleString("th-TH", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}{" "}
                  บาท
                </dd>
              </div>
            </>
          ) : null}
        </dl>

        <Link
          href="/"
          className="mt-6 inline-flex rounded-full bg-slate-950 px-5 py-2.5 text-sm font-bold text-white"
        >
          กลับหน้าแรก
        </Link>
      </section>
    </main>
  );
}

async function loadVerifyDocument({
  type,
  docNo,
}: {
  type: VerifyDocumentType;
  docNo: string;
}) {
  if (type === "sale") {
    const sale = await db.sale.findUnique({
      where: { saleNo: docNo },
      select: {
        saleDate: true,
        customerName: true,
        netAmount: true,
        customer: { select: { name: true } },
      },
    });

    return sale
      ? {
          date: sale.saleDate,
          customerName: sale.customer?.name ?? sale.customerName,
          amount: sale.netAmount,
        }
      : null;
  }

  const receipt = await db.receipt.findUnique({
    where: { receiptNo: docNo },
    select: {
      receiptDate: true,
      customerName: true,
      totalAmount: true,
      customer: { select: { name: true } },
    },
  });

  return receipt
    ? {
        date: receipt.receiptDate,
        customerName: receipt.customer?.name ?? receipt.customerName,
        amount: receipt.totalAmount,
      }
    : null;
}
