export const dynamic = "force-dynamic";

import { PieChart } from "lucide-react";

import NavLink from "@/components/shared/NavLink";
import type { SelectOption } from "@/components/shared/SearchableSelect";
import { db } from "@/lib/db";
import { buildDistributionPreview, listSelectablePeriods } from "@/lib/profit-distribution";
import { requirePermission } from "@/lib/require-auth";
import { formatDateOnlyForInput, getThailandDateKey } from "@/lib/th-date";

import DeclareForm from "../DeclareForm";

type PageProps = {
  searchParams: Promise<{ period?: string }>;
};

export default async function NewProfitDistributionPage({ searchParams }: PageProps) {
  await requirePermission("profit_distributions.create");

  const [params, periodOptions] = await Promise.all([searchParams, listSelectablePeriods()]);

  // Default to the newest closed month that has not been declared yet.
  const requested = periodOptions.find((option) => option.periodKey === params.period);
  const fallback = periodOptions.find((option) => !option.hasActiveDistribution);
  const selected = requested ?? fallback ?? periodOptions[0] ?? null;

  if (!selected) {
    return (
      <div className="space-y-4">
        <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
          ประกาศแบ่งกำไร
        </h1>
        <p className="rounded-2xl border border-gray-100 bg-white p-6 text-sm text-gray-500 shadow-sm dark:border-white/10 dark:bg-slate-900 dark:text-slate-400">
          ยังไม่มีเดือนที่จบแล้วให้ประกาศแบ่งกำไร
        </p>
      </div>
    );
  }

  const [preview, accounts] = await Promise.all([
    buildDistributionPreview(selected.year, selected.month),
    db.cashBankAccount.findMany({
      where: { isActive: true },
      orderBy: [{ type: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true },
    }),
  ]);

  const accountOptions: SelectOption[] = accounts.map((account) => ({
    id: account.id,
    label: `${account.code} ${account.name}`,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2">
        <NavLink
          href="/admin/profit-distributions"
          className="text-sm text-gray-500 hover:underline dark:text-slate-400"
        >
          ← กลับหน้าแบ่งกำไรผู้ร่วมทุน
        </NavLink>
        <div className="flex items-center gap-2">
          <PieChart size={22} className="text-[#1e3a5f] dark:text-sky-300" />
          <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
            ประกาศแบ่งกำไร
          </h1>
        </div>
      </div>

      {preview.pendingChannelFees.pendingSalesAmount > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-400/30 dark:bg-amber-500/10">
          <p className="font-medium text-amber-900 dark:text-amber-100">
            งวดนี้ยังมีค่าธรรมเนียมช่องทางขายที่ยังไม่รับรู้ ประมาณ{" "}
            {preview.pendingChannelFees.estimatedPendingFee.toLocaleString("th-TH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            บาท
          </p>
          <p className="mt-1 text-amber-800 dark:text-amber-200">
            มียอดขายออนไลน์{" "}
            {preview.pendingChannelFees.pendingSalesAmount.toLocaleString("th-TH", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}{" "}
            บาท ที่แพลตฟอร์มยังไม่โอน ค่าธรรมเนียมจะถูกบันทึกย้อนกลับมาที่วันขายเมื่อกระทบยอด
            ทำให้กำไรของงวดนี้ลดลงภายหลัง และส่วนต่างจะไปโผล่เป็นยอดยกมาของงวดถัดไป —
            แนะนำให้กระทบยอดรับเงินให้ครบก่อนประกาศแบ่งกำไร
          </p>
        </div>
      ) : null}

      <DeclareForm
        periodOptions={periodOptions.map((option) => ({
          periodKey: option.periodKey,
          label: option.label,
          hasActiveDistribution: option.hasActiveDistribution,
        }))}
        periodKey={selected.periodKey}
        periodLabel={preview.periodLabel}
        accountOptions={accountOptions}
        partners={preview.partners.map((partner) => ({
          partnerProfileId: partner.partnerProfileId,
          name: partner.name,
          bankLabel: partner.bankLabel,
          defaultSharePercent: partner.defaultSharePercent,
        }))}
        today={getThailandDateKey()}
        minPayDate={formatDateOnlyForInput(preview.periodStart)}
        netProfit={preview.summary.netProfitAmount}
        salesAmount={preview.summary.salesAmountExVat}
        costAmount={preview.summary.costAmount}
        expenseAmount={preview.summary.expenseAmount}
        carryForwardAmount={preview.carryForward.amount}
        carryForwardRows={preview.carryForward.rows.map((row) => ({
          label: row.label,
          kind: row.kind,
          amount: row.amount,
        }))}
        distributableBase={preview.distributableBase}
        cashBankBalance={preview.cashHealth.cashBankBalance}
        arOutstanding={preview.cashHealth.arOutstanding}
        stockValue={preview.cashHealth.stockValue}
        hasActiveDistribution={preview.hasActiveDistribution}
      />
    </div>
  );
}
