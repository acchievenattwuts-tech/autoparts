"use client";

import { useMemo, useState, useTransition } from "react";
import { calculateShopeeSettlement, SHOPEE_SETTLEMENT_FEE_OPTIONS } from "@/lib/shopee/manual";
import { cancelShopeeSettlement, createShopeeSettlement } from "./actions";

type SaleRow = { id: string; saleNo: string; orderNo: string; date: string; amount: number };
type Account = { id: string; label: string };
type SettlementRow = { id: string; no: string; ref: string; date: string; sales: number; fees: number; payout: number; status: string };
type FeeRow = { code: string; label: string; amount: number };

export default function SettlementManager({ sales, accounts, recent, today, canCancel }: { sales: SaleRow[]; accounts: Account[]; recent: SettlementRow[]; today: string; canCancel: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [fees, setFees] = useState<FeeRow[]>([{ code: "COMMISSION", label: "ค่าคอมมิชชัน", amount: 0 }]);
  const [payout, setPayout] = useState(0);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const salesAmount = useMemo(() => sales.filter((sale) => selected.includes(sale.id)).reduce((sum, sale) => sum + sale.amount, 0), [sales, selected]);
  const calculation = calculateShopeeSettlement(salesAmount, fees.filter((fee) => fee.amount > 0).map((fee) => fee.amount), payout);
  const money = (value: number) => value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return <div className="space-y-6">
    <form className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#101b2e]" onSubmit={(event) => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      startTransition(async () => {
        const result = await createShopeeSettlement({ settlementDate: data.get("settlementDate"), payoutRef: data.get("payoutRef"), destinationAccountId: data.get("destinationAccountId"), payoutAmount: payout, saleIds: selected, fees: fees.filter((fee) => fee.amount > 0), note: data.get("note") || undefined });
        setMessage(result.error ?? `บันทึกสำเร็จ ${result.settlementNo}`); if (result.success) { setSelected([]); setFees([{ code: "COMMISSION", label: "ค่าคอมมิชชัน", amount: 0 }]); setPayout(0); }
      });
    }}>
      <div><h2 className="font-kanit text-lg font-semibold text-slate-900 dark:text-slate-100">สร้างรอบรับเงิน</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">เลือกใบขายตามรายละเอียดการถอนเงินใน Shopee แล้วคีย์ค่าธรรมเนียมแยกประเภท ยอดต้องตรงก่อนบันทึก</p></div>
      <div className="max-h-80 overflow-auto rounded-lg border border-slate-200 dark:border-white/10">
        <table className="w-full min-w-[720px] text-sm"><thead className="sticky top-0 bg-slate-50 text-slate-500 dark:bg-slate-900 dark:text-slate-300"><tr><th className="p-3 text-center"><input type="checkbox" checked={sales.length > 0 && selected.length === sales.length} onChange={(e) => setSelected(e.target.checked ? sales.map((sale) => sale.id) : [])}/></th><th className="p-3 text-left">ใบขาย</th><th className="p-3 text-left">เลขออเดอร์ Shopee</th><th className="p-3 text-left">วันที่พร้อมจัดส่ง</th><th className="p-3 text-right">ยอดขาย</th></tr></thead>
          <tbody>{sales.length === 0 ? <tr><td colSpan={5} className="p-8 text-center text-slate-400">ไม่มีใบขายที่รอกระทบยอด</td></tr> : sales.map((sale) => <tr key={sale.id} className="border-t border-slate-100 dark:border-white/5"><td className="p-3 text-center"><input type="checkbox" checked={selected.includes(sale.id)} onChange={() => setSelected((current) => current.includes(sale.id) ? current.filter((id) => id !== sale.id) : [...current, sale.id])}/></td><td className="p-3 font-mono text-sky-700 dark:text-sky-300">{sale.saleNo}</td><td className="p-3">{sale.orderNo}</td><td className="p-3">{sale.date}</td><td className="p-3 text-right tabular-nums">{money(sale.amount)}</td></tr>)}</tbody>
        </table>
      </div>
      <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-medium text-slate-800 dark:text-slate-200">ค่าธรรมเนียม/รายการหัก</h3><button type="button" onClick={() => setFees((rows) => [...rows, { code: "OTHER", label: "รายการอื่น", amount: 0 }])} className="text-sm font-medium text-orange-600 hover:text-orange-700">+ เพิ่มรายการ</button></div>
        {fees.map((fee, index) => <div key={index} className="grid gap-2 md:grid-cols-[220px_1fr_160px_40px]">
          <select value={fee.code} onChange={(e) => { const option = SHOPEE_SETTLEMENT_FEE_OPTIONS.find((item) => item.code === e.target.value)!; setFees((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, code: option.code, label: option.label } : row)); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-slate-900">{SHOPEE_SETTLEMENT_FEE_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select>
          <input value={fee.label} onChange={(e) => setFees((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, label: e.target.value } : row))} maxLength={100} className="rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-white/20 dark:bg-slate-900" aria-label="ชื่อค่าธรรมเนียม"/>
          <input type="number" min="0" step="0.01" value={fee.amount || ""} onChange={(e) => setFees((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, amount: Number(e.target.value) } : row))} className="rounded-lg border border-slate-300 px-3 py-2 text-right text-sm dark:border-white/20 dark:bg-slate-900" placeholder="0.00"/>
          <button type="button" onClick={() => setFees((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} className="text-slate-400 hover:text-red-600" aria-label="ลบรายการ">×</button>
        </div>)}
      </div>
      <div className="grid gap-4 md:grid-cols-3"><label className="text-sm text-slate-700 dark:text-slate-300">วันที่เงินเข้า<input type="date" name="settlementDate" required defaultValue={today} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-white/20 dark:bg-slate-900"/></label><label className="text-sm text-slate-700 dark:text-slate-300">เลขอ้างอิงการรับเงิน<input name="payoutRef" required maxLength={100} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 dark:border-white/20 dark:bg-slate-900"/></label><label className="text-sm text-slate-700 dark:text-slate-300">บัญชีธนาคารปลายทาง<select name="destinationAccountId" required className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-white/20 dark:bg-slate-900"><option value="">เลือกบัญชี</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}</select></label></div>
      <label className="block text-sm text-slate-700 dark:text-slate-300">ยอดเงินเข้าจริง<input type="number" min="0.01" step="0.01" value={payout || ""} onChange={(e) => setPayout(Number(e.target.value))} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-right text-lg font-semibold dark:border-white/20 dark:bg-slate-900"/></label>
      <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm dark:bg-white/5 sm:grid-cols-4"><div>ยอดขาย<br/><strong>{money(calculation.salesAmount)}</strong></div><div>ค่าธรรมเนียม<br/><strong className="text-red-600">-{money(calculation.feeAmount)}</strong></div><div>ยอดที่ควรเข้า<br/><strong>{money(calculation.expectedPayout)}</strong></div><div>ผลต่าง<br/><strong className={Math.abs(calculation.difference) < 0.005 ? "text-emerald-600" : "text-red-600"}>{money(calculation.difference)}</strong></div></div>
      <input name="note" maxLength={500} placeholder="หมายเหตุ (ถ้ามี)" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-white/20 dark:bg-slate-900"/>
      {message && <p className="text-sm text-slate-700 dark:text-slate-200">{message}</p>}<button disabled={pending || selected.length === 0 || Math.abs(calculation.difference) >= 0.005} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">{pending ? "กำลังบันทึก..." : "ยืนยันรับเงินและบันทึกค่าธรรมเนียม"}</button>
    </form>
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#101b2e]"><h2 className="mb-4 font-kanit text-lg font-semibold dark:text-slate-100">ประวัติรอบรับเงิน</h2><div className="overflow-x-auto"><table className="w-full min-w-[860px] text-sm"><thead className="text-slate-500 dark:text-slate-300"><tr><th className="p-2 text-left">เลขที่</th><th className="p-2 text-left">อ้างอิง</th><th className="p-2 text-left">วันที่</th><th className="p-2 text-right">ยอดขาย</th><th className="p-2 text-right">ค่าธรรมเนียม</th><th className="p-2 text-right">รับจริง</th><th className="p-2 text-left">สถานะ</th><th/></tr></thead><tbody>{recent.map((row) => <tr key={row.id} className="border-t border-slate-100 dark:border-white/5"><td className="p-2 font-mono">{row.no}</td><td className="p-2">{row.ref}</td><td className="p-2">{row.date}</td><td className="p-2 text-right">{money(row.sales)}</td><td className="p-2 text-right">{money(row.fees)}</td><td className="p-2 text-right">{money(row.payout)}</td><td className="p-2">{row.status === "ACTIVE" ? "ใช้งาน" : "ยกเลิก"}</td><td className="p-2 text-right">{canCancel && row.status === "ACTIVE" ? <button type="button" className="text-red-600" onClick={() => { const reason = window.prompt("เหตุผลที่ยกเลิกการกระทบยอด"); if (!reason) return; startTransition(async () => { const result = await cancelShopeeSettlement(row.id, reason); setMessage(result.error ?? "ยกเลิกแล้ว"); }); }}>ยกเลิก</button> : null}</td></tr>)}</tbody></table></div></div>
  </div>;
}
