export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/lib/db";
import { hasPermissionAccess } from "@/lib/access-control";
import { CashBankSourceType } from "@/lib/generated/prisma";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { getCashBankSourceHref, getCashBankSourceLabel } from "@/lib/cash-bank-links";
import CashBankAccountManager, { type CashBankAccountRow } from "./CashBankAccountManager";

type PageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

function parseDate(value: string | undefined, fallback: string): string {
  return value && !Number.isNaN(new Date(value).getTime()) ? value : fallback;
}

function formatDate(value: Date): string {
  return value.toLocaleDateString("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatCurrency(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function CashBankPage({ searchParams }: PageProps) {
  await requirePermission("cash_bank.view");
  const { role, permissions } = await getSessionPermissionContext();
  const params = await searchParams;

  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
  const fromInput = parseDate(params.from, firstOfMonth);
  const toInput = parseDate(params.to, today.toISOString().slice(0, 10));
  const accountId = params.accountId ?? "";
  const allowedSourceTypes = new Set<string>([
    CashBankSourceType.SALE,
    CashBankSourceType.RECEIPT,
    CashBankSourceType.PURCHASE,
    CashBankSourceType.EXPENSE,
    CashBankSourceType.CN_SALE,
    CashBankSourceType.CN_PURCHASE,
    CashBankSourceType.SUPPLIER_ADVANCE,
    CashBankSourceType.SUPPLIER_PAYMENT,
    CashBankSourceType.TRANSFER,
    CashBankSourceType.ADJUSTMENT,
  ]);
  const sourceType =
    params.sourceType && allowedSourceTypes.has(params.sourceType)
      ? (params.sourceType as CashBankSourceType)
      : "ALL";

  const from = new Date(fromInput);
  const to = new Date(toInput);
  to.setHours(23, 59, 59, 999);

  const accountsRaw = await db.cashBankAccount.findMany({
    orderBy: [{ type: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      bankName: true,
      accountNo: true,
      openingBalance: true,
      openingDate: true,
      isActive: true,
      movements: {
        orderBy: [{ txnDate: "desc" }, { sorder: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: 1,
        select: { balanceAfter: true },
      },
    },
  });

  const accounts: CashBankAccountRow[] = accountsRaw.map((account) => ({
    id: account.id,
    code: account.code,
    name: account.name,
    type: account.type,
    bankName: account.bankName,
    accountNo: account.accountNo,
    openingBalance: Number(account.openingBalance),
    openingDate: account.openingDate.toISOString().slice(0, 10),
    isActive: account.isActive,
  }));

  const summaryCards = accountsRaw.map((account) => ({
    ...account,
    currentBalance: Number(account.movements[0]?.balanceAfter ?? account.openingBalance),
  }));

  const movements = await db.cashBankMovement.findMany({
    where: {
      txnDate: { gte: from, lte: to },
      ...(accountId ? { accountId } : {}),
      ...(sourceType !== "ALL" ? { sourceType } : {}),
    },
    orderBy: [
      { txnDate: "asc" },
      { account: { code: "asc" } },
      { sorder: "asc" },
      { createdAt: "asc" },
      { id: "asc" },
    ],
    select: {
      id: true,
      txnDate: true,
      direction: true,
      amount: true,
      balanceAfter: true,
      sourceType: true,
      sourceId: true,
      referenceNo: true,
      note: true,
      account: { select: { id: true, code: true, name: true } },
    },
    take: 500,
  });

  let openingBalance: number | null = null;
  let endingBalance: number | null = null;

  if (accountId) {
    const account = accountsRaw.find((item) => item.id === accountId);
    if (account) {
      const previousMovement = await db.cashBankMovement.findFirst({
        where: { accountId, txnDate: { lt: from } },
        orderBy: [
          { txnDate: "desc" },
          { sorder: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
        select: { balanceAfter: true },
      });
      openingBalance = Number(previousMovement?.balanceAfter ?? account.openingBalance);
      const lastMovement = movements[movements.length - 1];
      endingBalance = Number(lastMovement?.balanceAfter ?? openingBalance);
    }
  }

  const totalIn = movements
    .filter((movement) => movement.direction === "IN")
    .reduce((sum, movement) => sum + Number(movement.amount), 0);
  const totalOut = movements
    .filter((movement) => movement.direction === "OUT")
    .reduce((sum, movement) => sum + Number(movement.amount), 0);

  const canManage = hasPermissionAccess(role, permissions, "cash_bank.manage");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900">Cash / Bank Dashboard</h1>
          <p className="text-sm text-gray-500">
            ติดตามเงินเข้า เงินออก และยอดคงเหลือรายบัญชีจาก ledger จริง พร้อมลิงก์ย้อนกลับไปยังเอกสารต้นทาง
          </p>
        </div>
        <div className="hidden">
          <Link href="/admin/cash-bank/ledger" className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
            ดู ledger เต็ม
          </Link>
          <Link href="/admin/cash-bank/transfers" className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#163055]">
            โอนเงิน
          </Link>
          <Link href="/admin/cash-bank/adjustments" className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
            ปรับยอดเงิน
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((account) => (
          <div key={account.id} className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500">{account.code}</p>
                <h2 className="font-kanit text-lg font-semibold text-gray-900">{account.name}</h2>
              </div>
              <span className={`rounded-full px-2 py-1 text-xs font-medium ${account.type === "BANK" ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700"}`}>
                {account.type}
              </span>
            </div>
            <p className="mt-3 text-xs text-gray-400">
              {[account.bankName, account.accountNo].filter(Boolean).join(" | ") || "เงินสด / ไม่มีรายละเอียดธนาคาร"}
            </p>
            <p className="mt-4 font-kanit text-2xl font-bold text-[#1e3a5f]">{formatCurrency(account.currentBalance)}</p>
            <p className="mt-1 text-xs text-gray-400">{account.isActive ? "บัญชีนี้เปิดใช้งานอยู่" : "บัญชีนี้ปิดใช้งานแล้ว"}</p>
          </div>
        ))}
      </div>

      <CashBankAccountManager accounts={accounts} canManage={canManage} />

      {false && (
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="font-kanit text-lg font-semibold text-gray-900">สมุดเคลื่อนไหวบัญชี</h2>
          <p className="text-sm text-gray-500">
            กรองตามบัญชี ช่วงวันที่ และ source เพื่อดูยอดยกมา รับเข้า จ่ายออก และ running balance
          </p>
        </div>

        <form method="GET" className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <label className="text-sm font-medium text-gray-700">
            บัญชี
            <select name="accountId" defaultValue={accountId} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="">ทุกบัญชี</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} - {account.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">
            ตั้งแต่วันที่
            <input type="date" name="from" defaultValue={fromInput} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm font-medium text-gray-700">
            ถึงวันที่
            <input type="date" name="to" defaultValue={toInput} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-sm font-medium text-gray-700">
            Source
            <select name="sourceType" defaultValue={sourceType} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
              <option value="ALL">ทั้งหมด</option>
              <option value="SALE">SALE</option>
              <option value="RECEIPT">RECEIPT</option>
              <option value="PURCHASE">PURCHASE</option>
              <option value="EXPENSE">EXPENSE</option>
              <option value="CN_SALE">CN_SALE</option>
              <option value="TRANSFER">TRANSFER</option>
              <option value="ADJUSTMENT">ADJUSTMENT</option>
            </select>
          </label>
          <div className="flex items-end gap-2">
            <button type="submit" className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#163055]">
              แสดงรายการ
            </button>
            <Link href="/admin/cash-bank" className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200">
              ล้าง
            </Link>
          </div>
        </form>

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-xs text-gray-500">ยอดยกมา</p>
            <p className="font-kanit text-xl font-bold text-gray-900">{formatCurrency(openingBalance ?? 0)}</p>
          </div>
          <div className="rounded-xl bg-emerald-50 p-3">
            <p className="text-xs text-emerald-700">รวมรับ</p>
            <p className="font-kanit text-xl font-bold text-emerald-700">{formatCurrency(totalIn)}</p>
          </div>
          <div className="rounded-xl bg-rose-50 p-3">
            <p className="text-xs text-rose-700">รวมจ่าย</p>
            <p className="font-kanit text-xl font-bold text-rose-700">{formatCurrency(totalOut)}</p>
          </div>
          <div className="rounded-xl bg-blue-50 p-3">
            <p className="text-xs text-blue-700">ยอดคงเหลือปลายงวด</p>
            <p className="font-kanit text-xl font-bold text-[#1e3a5f]">
              {formatCurrency(endingBalance ?? (openingBalance ?? 0) + totalIn - totalOut)}
            </p>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-3 py-2 text-left font-medium">วันที่</th>
                <th className="px-3 py-2 text-left font-medium">บัญชี</th>
                <th className="px-3 py-2 text-left font-medium">เลขอ้างอิง</th>
                <th className="px-3 py-2 text-left font-medium">Source</th>
                <th className="px-3 py-2 text-left font-medium">เอกสารต้นทาง</th>
                <th className="px-3 py-2 text-left font-medium">หมายเหตุ</th>
                <th className="px-3 py-2 text-right font-medium">รับเข้า</th>
                <th className="px-3 py-2 text-right font-medium">จ่ายออก</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-gray-400">ไม่พบ movement ตามเงื่อนไขที่เลือก</td>
                </tr>
              ) : (
                movements.map((movement) => {
                  const href = getCashBankSourceHref(movement.sourceType, movement.sourceId);
                  const amount = Number(movement.amount);
                  return (
                    <tr key={movement.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{formatDate(movement.txnDate)}</td>
                      <td className="px-3 py-2">
                        <p className="font-medium text-gray-900">{movement.account.name}</p>
                        <p className="text-xs text-gray-400">{movement.account.code}</p>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-[#1e3a5f]">{movement.referenceNo}</td>
                      <td className="px-3 py-2">
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                          {getCashBankSourceLabel(movement.sourceType)}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {href ? (
                          <Link href={href} className="text-sm font-medium text-[#1e3a5f] hover:underline">
                            เปิดเอกสาร
                          </Link>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-gray-500">{movement.note || "-"}</td>
                      <td className="px-3 py-2 text-right font-medium text-emerald-700">
                        {movement.direction === "IN" ? formatCurrency(amount) : "-"}
                      </td>
                      <td className="px-3 py-2 text-right font-medium text-rose-700">
                        {movement.direction === "OUT" ? formatCurrency(amount) : "-"}
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-gray-900">{formatCurrency(Number(movement.balanceAfter))}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        </div>
      )}

      <div className="rounded-2xl border border-amber-100 bg-amber-50 p-5 shadow-sm">
        <h2 className="font-kanit text-lg font-semibold text-gray-900">คู่มือการใช้งานสำหรับพนักงาน</h2>
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-sm font-semibold text-gray-900">1. ตั้งบัญชีให้พร้อมก่อนใช้งาน</p>
            <p className="text-sm text-gray-600">สร้างบัญชีเงินสดหน้าร้าน เงินสดย่อย และบัญชีธนาคารที่ใช้งานจริง พร้อมยอดยกมาและวันที่เริ่มต้น</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">2. เอกสารที่รับหรือจ่ายเงินจริงต้องเลือกบัญชี</p>
            <p className="text-sm text-gray-600">ขายสด รับชำระหนี้ ซื้อที่จ่ายแล้ว ค่าใช้จ่าย และเครดิตโน้ตคืนเงินสด ต้องผูกบัญชีเงินให้ถูกต้องทุกครั้ง</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">3. โอนเงินและปรับยอดให้ใช้เมนูเฉพาะ</p>
            <p className="text-sm text-gray-600">ห้ามใช้เอกสารอื่นแทนการโอนเงินหรือปรับยอด ถ้าต้องย้ายเงินระหว่างบัญชีให้ใช้เมนูโอนเงิน และถ้าเป็นเงินเกินขาดหรือค่าธรรมเนียมให้ใช้ปรับยอด</p>
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">4. ตรวจยอดจาก ledger ไม่ใช่จากการจำ</p>
            <p className="text-sm text-gray-600">ก่อนปิดวันให้ดูยอดคงเหลือจากหน้า ledger หรือ summary เสมอ และเปิดเอกสารต้นทางจากแต่ละ movement เมื่อต้องไล่หาสาเหตุ</p>
          </div>
        </div>
      </div>
    </div>
  );
}
