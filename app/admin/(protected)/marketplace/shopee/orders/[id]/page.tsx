export const dynamic = "force-dynamic";

import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, Printer, ReceiptText, Wallet } from "lucide-react";

import { ensureAccessControlSetup, hasPermissionAccess } from "@/lib/access-control";
import { db } from "@/lib/db";
import { getLotAvailability } from "@/lib/lot-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { formatDateTimeThai } from "@/lib/th-date";
import { buildShopeeSaleDraftFromOrderImport } from "@/lib/shopee/services/create-sale";
import { buildShopeeFeeExpenseDraftFromOrderImport } from "@/lib/shopee/services/escrow";
import { getShopeeReturnReviewDetailFromOrderImport } from "@/lib/shopee/services/returns";

import CreateSaleConfirm, { type LotLine } from "./CreateSaleConfirm";
import CreateFeeExpenseButton from "./CreateFeeExpenseButton";

const LOT_BLOCKER = "มีสินค้าคุม lot ต้องเลือก lot ก่อน";

const fmt = (value: number) =>
  value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type PageProps = { params: Promise<{ id: string }> };

const ShopeeOrderPreviewPage = async ({ params }: PageProps) => {
  await ensureAccessControlSetup();
  await requirePermission("marketplace.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canManage = hasPermissionAccess(role, permissions, "marketplace.manage");
  const canCreateExpense = hasPermissionAccess(role, permissions, "expenses.create");
  const { id } = await params;

  const orderImport = await db.shopeeOrderImport.findUnique({
    where: { id },
    select: {
      id: true,
      orderSn: true,
      shopeeStatus: true,
      buyerUsername: true,
      orderCreatedAt: true,
      rawPayload: true,
      importStatus: true,
      saleId: true,
      shopRecordId: true,
      escrowLastError: true,
      returnReviewRequired: true,
      returnReviewReason: true,
      shop: { select: { settlementCashBankAccountId: true } },
      sale: {
        select: {
          id: true,
          saleNo: true,
          status: true,
          creditNotes: { where: { status: "ACTIVE" }, select: { cnNo: true } },
          receipts: {
            where: { receipt: { status: "ACTIVE" } },
            select: { receipt: { select: { receiptNo: true } } },
          },
          warranties: {
            select: {
              claims: {
                where: { status: { not: "CANCELLED" } },
                select: { claimNo: true },
              },
            },
          },
        },
      },
      escrowExpense: { select: { id: true, expenseNo: true, status: true } },
    },
  });
  const draft = orderImport ? await buildShopeeSaleDraftFromOrderImport(orderImport) : null;
  const reviewDetail = orderImport ? getShopeeReturnReviewDetailFromOrderImport(orderImport) : null;
  const feeDraft = orderImport ? buildShopeeFeeExpenseDraftFromOrderImport(orderImport) : null;

  // Lot picker: hard blockers are everything except the "select lot" notice,
  // which the inline lot picker resolves instead of hard-blocking.
  const hardBlockers = draft ? draft.blockers.filter((blocker) => blocker !== LOT_BLOCKER) : [];
  let lotLines: LotLine[] = [];
  if (draft && canManage && !draft.alreadyImported && hardBlockers.length === 0) {
    const lotControlled = draft.lines.filter(
      (line): line is typeof line & { productId: string } =>
        line.isLotControl && typeof line.productId === "string",
    );
    lotLines = await Promise.all(
      lotControlled.map(async (line) => ({
        key: `${line.itemId}::${line.modelId}`,
        productName: line.productName,
        qty: line.qty,
        unitName: line.unitName,
        unitScale: line.unitScale,
        available: await getLotAvailability(db, line.productId),
      })),
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-200 bg-orange-50 text-orange-600 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-300">
            <ReceiptText size={22} />
          </span>
          <div>
            <h1 className="font-kanit text-xl font-bold text-slate-900 dark:text-slate-100">สร้างบิลจากออเดอร์ Shopee</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">ตรวจสอบรายการและราคา ก่อนยืนยันสร้างบิลขายจริง</p>
          </div>
        </div>
        <Link
          href="/admin/marketplace/shopee/orders"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
        >
          <ArrowLeft size={15} />
          กลับคิว
        </Link>
      </div>

      {!draft ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-6 text-sm text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-100">
          ไม่พบออเดอร์
        </div>
      ) : (
        <>
          {reviewDetail && reviewDetail.signal.kind !== "NONE" ? (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle size={18} />
                ต้อง review cancel/refund/return จาก Shopee
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="text-xs font-medium uppercase text-amber-700/80 dark:text-amber-200/80">Signal</p>
                  <p className="mt-1 font-mono">{reviewDetail.signal.kind}</p>
                  <p className="mt-1 text-xs">{reviewDetail.signal.reason ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase text-amber-700/80 dark:text-amber-200/80">Policy</p>
                  <p className="mt-1 font-mono">{reviewDetail.policy}</p>
                  <p className="mt-1 text-xs">ระบบไม่ยกเลิก Sale และไม่สร้าง CN อัตโนมัติ</p>
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-amber-200 bg-white/60 p-3 dark:border-amber-400/20 dark:bg-black/10">
                <p className="font-medium">Reference-chain protection</p>
                <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
                  {reviewDetail.referenceWarnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
                {reviewDetail.saleId ? (
                  <Link
                    href={`/admin/sales/${reviewDetail.saleId}`}
                    className="mt-3 inline-flex rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-300/30 dark:text-amber-100 dark:hover:bg-amber-400/20"
                  >
                    เปิด Sale {reviewDetail.saleNo}
                  </Link>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-slate-900 dark:text-slate-100">ออเดอร์ {draft.orderSn}</p>
              <p className="text-sm text-slate-500 dark:text-slate-400">ผู้ซื้อ: {draft.buyerUsername ?? "-"}</p>
            </div>

            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
              <table className="min-w-[640px] w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-white/5 dark:text-slate-400">
                  <tr>
                    <th className="px-3 py-2">สินค้า</th>
                    <th className="px-3 py-2 text-right">จำนวน</th>
                    <th className="px-3 py-2 text-right">ราคา/หน่วย</th>
                    <th className="px-3 py-2 text-right">รวม</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/10">
                  {draft.lines.map((line) => (
                    <tr key={`${line.itemId}-${line.modelId}`} className={line.error ? "bg-rose-50/60 dark:bg-rose-400/5" : ""}>
                      <td className="px-3 py-2">
                        <p className="font-medium text-slate-900 dark:text-slate-100">{line.productName}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {line.productCode ? `${line.productCode} · ` : ""}item {line.itemId}/{line.modelId}
                          {line.isLotControl ? " · คุม lot" : ""}
                        </p>
                        {line.error ? <p className="text-xs text-rose-600 dark:text-rose-300">{line.error}</p> : null}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">
                        {line.qty} {line.unitName}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-200">{fmt(line.unitPrice)}</td>
                      <td className="px-3 py-2 text-right font-medium text-slate-900 dark:text-slate-100">{fmt(line.lineTotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-slate-200 dark:border-white/10">
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-right text-sm font-medium text-slate-600 dark:text-slate-300">
                      ยอดรวม
                    </td>
                    <td className="px-3 py-2 text-right font-bold text-slate-900 dark:text-slate-100">{fmt(draft.totalAmount)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
              ราคาดึงจาก Shopee — โปรดตรวจสอบให้ตรงก่อนยืนยัน · บิลจะลงเป็น CASH_SALE เข้าบัญชี &quot;Shopee พักเงิน&quot; · ตัดสต็อกผ่านระบบเดิม
            </p>
            <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
              บิลจะลง <span className="font-medium text-slate-600 dark:text-slate-300">วันที่วันนี้</span> (วันออกเอกสาร) ·
              อ้างอิง: ลูกค้าสั่งเมื่อ {formatDateTimeThai(draft.docDate, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </p>
          </section>

          {feeDraft ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#0d1728]">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-orange-200 bg-orange-50 text-orange-600 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-300">
                    <Wallet size={19} />
                  </span>
                  <div>
                    <h2 className="font-kanit text-base font-semibold text-slate-900 dark:text-slate-100">ค่าใช้จ่าย Shopee จาก escrow</h2>
                    <p className="text-xs text-slate-500 dark:text-slate-400">สร้าง Expense จาก commission/service/voucher ที่อยู่ใน snapshot ที่ยืนยันได้</p>
                  </div>
                </div>
                {feeDraft.existingExpense ? (
                  <Link
                    href={`/admin/expenses/${feeDraft.existingExpense.id}`}
                    className="inline-flex rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200 dark:hover:bg-emerald-400/20"
                  >
                    Expense {feeDraft.existingExpense.expenseNo}
                  </Link>
                ) : null}
              </div>

              {feeDraft.lines.length > 0 ? (
                <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-white/10">
                  <table className="min-w-[560px] w-full text-sm">
                    <thead className="bg-slate-50 text-left text-xs text-slate-500 dark:bg-white/5 dark:text-slate-400">
                      <tr>
                        <th className="px-3 py-2">ประเภท</th>
                        <th className="px-3 py-2">Source key</th>
                        <th className="px-3 py-2 text-right">จำนวนเงิน</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/10">
                      {feeDraft.lines.map((line) => (
                        <tr key={`${line.kind}-${line.sourceKey}`}>
                          <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{line.label}</td>
                          <td className="px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{line.sourceKey}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900 dark:text-slate-100">{fmt(line.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t border-slate-200 dark:border-white/10">
                      <tr>
                        <td colSpan={2} className="px-3 py-2 text-right text-sm font-medium text-slate-600 dark:text-slate-300">รวม</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-900 dark:text-slate-100">{fmt(feeDraft.totalAmount)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ) : (
                <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100">
                  ยังไม่พบ escrow_detail ที่รองรับใน snapshot นี้
                </p>
              )}

              {feeDraft.blockers.length > 0 ? (
                <ul className="mt-3 list-inside list-disc space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
                  {feeDraft.blockers.map((blocker) => (
                    <li key={blocker}>{blocker}</li>
                  ))}
                </ul>
              ) : canManage && canCreateExpense ? (
                <div className="mt-4">
                  <CreateFeeExpenseButton orderImportId={feeDraft.orderImportId} />
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">คุณไม่มีสิทธิ์สร้าง Expense ค่า Shopee</p>
              )}

              {feeDraft.lastError ? (
                <p className="mt-3 text-xs text-rose-600 dark:text-rose-300">Last error: {feeDraft.lastError}</p>
              ) : null}
            </section>
          ) : null}

          {draft.alreadyImported ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100">
              <span className="flex items-center gap-2">
                <CheckCircle2 size={18} className="shrink-0" />
                ออเดอร์นี้สร้างบิลแล้ว{draft.saleNo ? ` (${draft.saleNo})` : ""}
              </span>
              {draft.saleId ? (
                <Link
                  href={`/admin/sales/${draft.saleId}`}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                >
                  <Printer size={14} /> เปิด / พิมพ์ใบกำกับ-ใบเสร็จ
                </Link>
              ) : null}
            </div>
          ) : hardBlockers.length > 0 ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle size={18} className="text-amber-600 dark:text-amber-300" />
                ยังสร้างบิลไม่ได้
              </div>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {hardBlockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          ) : canManage ? (
            <CreateSaleConfirm orderImportId={draft.orderImportId} lotLines={lotLines} />
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">คุณไม่มีสิทธิ์สร้างบิล</p>
          )}
        </>
      )}
    </div>
  );
};

export default ShopeeOrderPreviewPage;
