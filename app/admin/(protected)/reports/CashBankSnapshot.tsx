import Link from "next/link";
import { db } from "@/lib/db";

type Props = {
  compact?: boolean;
};

function fmt(value: number) {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default async function CashBankSnapshot({ compact = false }: Props) {
  const accounts = await db.cashBankAccount.findMany({
    where: { isActive: true },
    orderBy: [{ type: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      bankName: true,
      accountNo: true,
      openingBalance: true,
      movements: {
        orderBy: [
          { txnDate: "desc" },
          { sorder: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
        take: 1,
        select: { balanceAfter: true },
      },
    },
  });

  const rows = accounts.map((account) => ({
    ...account,
    balance: Number(account.movements[0]?.balanceAfter ?? account.openingBalance),
  }));

  const totalBalance = rows.reduce((sum, row) => sum + row.balance, 0);
  const cashBalance = rows
    .filter((row) => row.type === "CASH")
    .reduce((sum, row) => sum + row.balance, 0);
  const bankBalance = rows
    .filter((row) => row.type === "BANK")
    .reduce((sum, row) => sum + row.balance, 0);

  return (
    <section className={compact ? "space-y-3" : "space-y-4"}>
      <div>
        <h2 className="font-kanit text-xl font-semibold text-gray-900">Cash / Bank Snapshot</h2>
        <p className="text-sm text-gray-500">
          ยอดคงเหลือล่าสุดจาก cash-bank ledger ของแต่ละบัญชี พร้อมกดดู ledger รายบัญชีได้
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
          <p className="text-xs text-slate-500">ยอดรวมทั้งหมด</p>
          <p className="mt-1 font-kanit text-2xl font-bold text-slate-900">{fmt(totalBalance)}</p>
        </div>
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-xs text-emerald-700">เงินสด</p>
          <p className="mt-1 font-kanit text-2xl font-bold text-emerald-700">{fmt(cashBalance)}</p>
        </div>
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-xs text-blue-700">ธนาคาร</p>
          <p className="mt-1 font-kanit text-2xl font-bold text-blue-700">{fmt(bankBalance)}</p>
        </div>
      </div>

      <div className={`grid gap-3 ${compact ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2 xl:grid-cols-4"}`}>
        {rows.map((row) => (
          <Link
            key={row.id}
            href={`/admin/reports/cash-bank-ledger?accountId=${row.id}`}
            className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm transition hover:border-[#1e3a5f]/20 hover:shadow-md"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-500">{row.code}</p>
                <h3 className="font-kanit text-lg font-semibold text-gray-900">{row.name}</h3>
              </div>
              <span
                className={`rounded-full px-2 py-1 text-xs font-medium ${
                  row.type === "BANK" ? "bg-sky-100 text-sky-700" : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {row.type}
              </span>
            </div>
            <p className="mt-2 text-xs text-gray-400">
              {[row.bankName, row.accountNo].filter(Boolean).join(" | ") || "บัญชีเงินสด / ไม่มีเลขที่บัญชี"}
            </p>
            <p className="mt-4 font-kanit text-2xl font-bold text-[#1e3a5f]">{fmt(row.balance)}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
