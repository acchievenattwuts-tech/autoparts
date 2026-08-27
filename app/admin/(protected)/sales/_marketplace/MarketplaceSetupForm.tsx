"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { saveMarketplaceChannelSetting } from "./actions";

type Option = { id: string; label: string };

const selectCls =
  "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-slate-900 dark:text-slate-100";

export default function MarketplaceSetupForm({
  channel,
  channelLabel,
  holdingAccountLabel,
  accounts,
  customers,
  initialAccountId = "",
  initialCustomerId = "",
}: {
  channel: string;
  channelLabel: string;
  holdingAccountLabel: string;
  accounts: Option[];
  customers: Option[];
  initialAccountId?: string;
  initialCustomerId?: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  return (
    <form
      className="space-y-4 rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-400/30 dark:bg-amber-500/10"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        formData.set("channel", channel);
        startTransition(async () => {
          const result = await saveMarketplaceChannelSetting(formData);
          setIsError(Boolean(result.error));
          setMessage(result.error ?? "บันทึกการตั้งค่าแล้ว");
          if (result.success) router.refresh();
        });
      }}
    >
      <div>
        <h2 className="font-kanit text-lg font-semibold text-amber-900 dark:text-amber-100">
          ตั้งค่า {channelLabel} แบบคีย์เองครั้งแรก
        </h2>
        <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
          {holdingAccountLabel} เป็นบัญชีเสมือนที่พักยอดขายไว้จนกว่า {channelLabel} จะโอนเงินจริง
          ยอดคงเหลือของบัญชีนี้จึงเท่ากับเงินที่แพลตฟอร์มยังค้างจ่ายเสมอ ส่วนลูกค้าเริ่มต้นใช้เป็นคู่บัญชีของใบขายทุกออเดอร์
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
          {holdingAccountLabel}
          <select
            name="settlementCashBankAccountId"
            required
            defaultValue={initialAccountId}
            className={selectCls}
          >
            <option value="">เลือกบัญชี</option>
            {accounts.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
          ลูกค้าเริ่มต้น {channelLabel}
          <select
            name="defaultCustomerId"
            required
            defaultValue={initialCustomerId}
            className={selectCls}
          >
            <option value="">เลือกลูกค้า</option>
            {customers.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {message ? (
        <p
          className={`text-sm ${isError ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-300"}`}
        >
          {message}
        </p>
      ) : null}
      <button
        disabled={pending}
        aria-busy={pending}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-wait disabled:opacity-60"
      >
        {pending ? (
          <>
            <LoaderCircle size={15} className="animate-spin" />
            กำลังบันทึก...
          </>
        ) : (
          "บันทึกการตั้งค่า"
        )}
      </button>
    </form>
  );
}
