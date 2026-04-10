export const dynamic = "force-dynamic";

import { Suspense } from "react";
import Image from "next/image";
import { notFound } from "next/navigation";

import AutoPrint from "@/components/shared/AutoPrint";
import PrintButton from "./PrintButton";
import { db } from "@/lib/db";
import { buildPromptPayQrDataUrl, getPrimaryTransferAccount, getTransferDocumentState } from "@/lib/payment-qr";
import { requirePermission } from "@/lib/require-auth";
import { SHIPPING_METHOD_LABEL } from "@/lib/shipping";

const fmtDate = (d: Date | string) =>
  new Date(d).toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const fmtNum = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PAYMENT_PRINT_LABELS: { key: string; label: string }[] = [
  { key: "CASH", label: "เงินสด" },
  { key: "TRANSFER", label: "เงินโอน" },
];

const DeliveryPrintPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) => {
  await requirePermission("delivery.view");
  const { ids } = await searchParams;

  if (!ids) notFound();

  const idList = ids.split(",").filter(Boolean).slice(0, 100);
  if (idList.length === 0) notFound();

  const [sales, contents, primaryTransferAccount] = await Promise.all([
    db.sale.findMany({
      where: { id: { in: idList }, fulfillmentType: "DELIVERY", status: "ACTIVE" },
      orderBy: [{ saleDate: "asc" }, { saleNo: "asc" }],
      select: {
        id: true,
        saleNo: true,
        saleDate: true,
        customerName: true,
        customerPhone: true,
        shippingAddress: true,
        shippingMethod: true,
        trackingNo: true,
        totalAmount: true,
        discount: true,
        netAmount: true,
        shippingFee: true,
        paymentType: true,
        paymentMethod: true,
        amountRemain: true,
        creditTerm: true,
        note: true,
        customer: { select: { name: true, phone: true, address: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            salePrice: true,
            totalAmount: true,
            lotItems: { select: { lotNo: true, qty: true } },
            product: {
              select: { code: true, name: true, reportUnitName: true },
            },
          },
        },
      },
    }),
    db.siteContent.findMany({
      where: { key: { in: ["shopName", "shopPhone", "shopAddress"] } },
    }),
    getPrimaryTransferAccount(),
  ]);

  if (sales.length === 0) notFound();

  const cfg = Object.fromEntries(contents.map((c) => [c.key, c.value]));

  return (
    <>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .slip { page-break-after: always; }
          .slip:last-child { page-break-after: avoid; }
        }
        @media screen {
          body { background: #f3f4f6; }
          .slip {
            max-width: 900px;
            margin: 24px auto;
            background: white;
            padding: 32px;
            border-radius: 8px;
            box-shadow: 0 1px 4px rgba(0,0,0,0.1);
          }
        }
      `}</style>

      <div className="no-print flex items-center justify-between p-4 bg-white border-b sticky top-0 z-10">
        <span className="font-medium text-gray-700">ใบส่งของ {sales.length} ใบ</span>
        <PrintButton />
      </div>

      <Suspense fallback={null}>
        <AutoPrint />
      </Suspense>

      {await Promise.all(
        sales.map(async (sale) => {
          const customerName = sale.customer?.name ?? sale.customerName ?? "-";
          const customerPhone = sale.customer?.phone ?? sale.customerPhone ?? "-";
          const transferDocumentState = getTransferDocumentState({
            paymentType: sale.paymentType,
            netAmount: Number(sale.netAmount),
            primaryTransferAccount,
          });
          const transferPrimaryAccount = transferDocumentState.shouldShowTransferSection
            ? primaryTransferAccount
            : null;
          const promptPayQrDataUrl = transferDocumentState.shouldGenerateQr
            ? await buildPromptPayQrDataUrl(primaryTransferAccount?.promptPayId, transferDocumentState.qrAmount)
            : null;

          return (
            <div key={sale.id} className="slip">
              <div className="flex justify-between items-start mb-4 pb-3 border-b-2 border-gray-800">
                <div className="text-xs text-gray-600 space-y-0.5">
                  {cfg.shopName && <p className="text-sm font-semibold text-gray-800">{cfg.shopName}</p>}
                  {cfg.shopAddress && <p>{cfg.shopAddress}</p>}
                  {cfg.shopPhone && <p>โทร: {cfg.shopPhone}</p>}
                </div>
                <div className="text-right">
                  <p className="text-base font-bold border border-gray-700 px-6 py-1.5 inline-block">
                    {sale.paymentType === "CREDIT_SALE" ? "ใบแจ้งหนี้ / ใบส่งของ" : "ใบเสร็จรับเงิน"}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">หน้า 1/1</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4 text-xs">
                <div className="border border-gray-400 rounded p-2 space-y-0.5">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">ข้อมูลลูกค้า</p>
                  <p>
                    <span className="text-gray-500">ชื่อ: </span>
                    <span className="font-semibold">{customerName}</span>
                  </p>
                  {sale.customer?.address && (
                    <p>
                      <span className="text-gray-500">ที่อยู่: </span>
                      {sale.customer.address}
                    </p>
                  )}
                  {customerPhone !== "-" && (
                    <p>
                      <span className="text-gray-500">โทร: </span>
                      {customerPhone}
                    </p>
                  )}
                  {sale.shippingAddress && (
                    <p>
                      <span className="text-gray-500">ที่อยู่จัดส่ง: </span>
                      {sale.shippingAddress}
                    </p>
                  )}
                </div>

                <div className="border border-gray-400 rounded p-2">
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mb-1">ข้อมูลเอกสาร</p>
                  <table className="w-full text-xs">
                    <tbody>
                      <tr>
                        <td className="text-gray-500 pr-2 py-0.5 whitespace-nowrap">เลขที่เอกสาร</td>
                        <td className="font-mono font-semibold">{sale.saleNo}</td>
                      </tr>
                      <tr>
                        <td className="text-gray-500 pr-2 py-0.5 whitespace-nowrap">วันที่เอกสาร</td>
                        <td>{fmtDate(sale.saleDate)}</td>
                      </tr>
                      <tr>
                        <td className="text-gray-500 pr-2 py-0.5 whitespace-nowrap">เงื่อนไขชำระ</td>
                        <td>{`${sale.creditTerm ?? 0} วัน`}</td>
                      </tr>
                      <tr>
                        <td className="text-gray-500 pr-2 py-0.5 whitespace-nowrap">ขนส่ง</td>
                        <td>
                          {SHIPPING_METHOD_LABEL[sale.shippingMethod ?? "NONE"]}
                          {sale.trackingNo ? ` (${sale.trackingNo})` : ""}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-100 text-gray-700">
                    <th className="border border-gray-400 px-1.5 py-1.5 text-center w-7">#</th>
                    <th className="border border-gray-400 px-1.5 py-1.5 text-left w-24">รหัสสินค้า</th>
                    <th className="border border-gray-400 px-1.5 py-1.5 text-left">รายละเอียด</th>
                    <th className="border border-gray-400 px-1.5 py-1.5 text-center w-12">จำนวน</th>
                    <th className="border border-gray-400 px-1.5 py-1.5 text-center w-12">หน่วย</th>
                    <th className="border border-gray-400 px-1.5 py-1.5 text-right w-24">ราคา/หน่วย</th>
                    <th className="border border-gray-400 px-1.5 py-1.5 text-right w-24">ยอดรวม</th>
                  </tr>
                </thead>
                <tbody>
                  {sale.items.map((item, idx) => (
                    <tr key={item.id}>
                      <td className="border border-gray-300 px-1.5 py-1.5 text-center text-gray-500">{idx + 1}</td>
                      <td className="border border-gray-300 px-1.5 py-1.5 font-mono text-gray-500 whitespace-nowrap">{item.product.code}</td>
                      <td className="border border-gray-300 px-1.5 py-1.5">
                        <div className="font-medium text-gray-900">{item.product.name}</div>
                        {item.lotItems.length > 0 && (
                          <div className="text-[11px] text-gray-400 mt-0.5">
                            Lot: {item.lotItems.map((l) => `${l.lotNo} ร—${Number(l.qty)}`).join(", ")}
                          </div>
                        )}
                      </td>
                      <td className="border border-gray-300 px-1.5 py-1.5 text-center">{item.quantity}</td>
                      <td className="border border-gray-300 px-1.5 py-1.5 text-center text-gray-500">{item.product.reportUnitName}</td>
                      <td className="border border-gray-300 px-1.5 py-1.5 text-right">{fmtNum(Number(item.salePrice))}</td>
                      <td className="border border-gray-300 px-1.5 py-1.5 text-right font-medium">{fmtNum(Number(item.totalAmount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex border-l border-r border-b border-gray-400 mb-4 text-xs">
                <div className="flex-1 border-r border-gray-400 p-2">
                  <p className="text-gray-400 mb-1">หมายเหตุ:</p>
                  <p className="text-gray-700 min-h-[2rem]">{sale.note ?? ""}</p>
                </div>
                <div className="w-56 p-2 space-y-0.5">
                  <div className="flex justify-between">
                    <span className="text-gray-500">มูลค่ารวม</span>
                    <span>{fmtNum(Number(sale.totalAmount))}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">ส่วนลด</span>
                    <span>{fmtNum(Number(sale.discount))}</span>
                  </div>
                  {Number(sale.shippingFee) > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">ค่าจัดส่ง</span>
                      <span>{fmtNum(Number(sale.shippingFee))}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-gray-400 pt-1 font-bold text-gray-900">
                    <span>ยอดสุทธิ</span>
                    <span className="text-[#1e3a5f]">{fmtNum(Number(sale.netAmount))}</span>
                  </div>
                </div>
              </div>

              {transferPrimaryAccount ? (
                <div className="mb-5 grid grid-cols-[1fr_180px] gap-4 border border-gray-400 p-3 text-xs">
                  <div className="space-y-1">
                    <p className="font-semibold text-gray-900">ข้อมูลบัญชีรับโอน</p>
                    <p className="text-gray-700">{transferPrimaryAccount.bankName || transferPrimaryAccount.name}</p>
                    <p className="font-mono text-sm text-[#1e3a5f]">{transferPrimaryAccount.accountNo || "-"}</p>
                    {transferPrimaryAccount.promptPayId ? (
                      <p className="text-gray-500">
                        PromptPay ID: <span className="font-mono">{transferPrimaryAccount.promptPayId}</span>
                      </p>
                    ) : (
                      <p className="text-gray-500">ยังไม่ได้ตั้ง PromptPay ID จึงแสดงเฉพาะข้อมูลบัญชีสำหรับโอน</p>
                    )}
                    <p className="text-gray-500">
                      ยอดสำหรับสแกน/โอน: <span className="font-semibold text-gray-900">{fmtNum(transferDocumentState.qrAmount)}</span>
                    </p>
                  </div>
                  <div className="flex items-center justify-center">
                    {promptPayQrDataUrl ? (
                      <Image src={promptPayQrDataUrl} alt={`PromptPay QR ${sale.saleNo}`} width={180} height={180} />
                    ) : (
                      <div className="flex h-[180px] w-[180px] items-center justify-center border border-dashed border-gray-300 p-4 text-center text-[11px] text-gray-400">
                        QR จะแสดงเมื่อบัญชีหลักรับโอนมี PromptPay ID
                      </div>
                    )}
                  </div>
                </div>
              ) : null}

              {sale.paymentType === "CASH_SALE" ? (
                <div className="border border-gray-400 px-3 py-2 mb-5 text-xs flex items-center gap-6">
                  <span className="text-gray-500 whitespace-nowrap">ชำระโดย:</span>
                  {PAYMENT_PRINT_LABELS.map(({ key, label }) => (
                    <span key={key} className="flex items-center gap-1.5">
                      <span className="inline-flex w-4 h-4 items-center justify-center border border-gray-500 text-[11px]">
                        {sale.paymentMethod === key ? "✓" : ""}
                      </span>
                      {label}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="grid grid-cols-2 gap-0 border border-gray-400 text-xs text-center mt-6">
                {["ผู้ส่งของ", "ผู้รับของ"].map((label, i) => (
                  <div key={label} className={`${i < 1 ? "border-r border-gray-400" : ""}`}>
                    <div className="h-16" />
                    <div className="border-t border-gray-400 py-1.5 font-medium text-gray-700">{label}</div>
                    <div className="text-gray-400 pb-2 px-4">วันที่ ................................................</div>
                  </div>
                ))}
              </div>
            </div>
          );
        }),
      )}
    </>
  );
};

export default DeliveryPrintPage;

