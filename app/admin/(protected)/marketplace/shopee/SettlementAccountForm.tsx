"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";

import SearchableSelect, { type SelectOption } from "@/components/shared/SearchableSelect";

import { setSettlementAccountAction } from "./actions";

type Props = {
  shopRecordId: string;
  currentAccountId: string | null;
  accounts: { id: string; code: string; name: string }[];
};

const SettlementAccountForm = ({ shopRecordId, currentAccountId, accounts }: Props) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [accountId, setAccountId] = useState(currentAccountId ?? "");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const options: SelectOption[] = accounts.map((a) => ({ id: a.id, label: a.name, sublabel: a.code }));

  const handleSave = () => {
    setMessage(null);
    const fd = new FormData();
    fd.set("shopRecordId", shopRecordId);
    fd.set("accountId", accountId);
    startTransition(async () => {
      const res = await setSettlementAccountAction(fd);
      if (res.ok) {
        setMessage({ kind: "ok", text: "บันทึกบัญชีพักเงินแล้ว" });
        router.refresh();
      } else {
        setMessage({ kind: "error", text: res.error });
      }
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <SearchableSelect
            options={options}
            value={accountId}
            onChange={setAccountId}
            placeholder="เลือกบัญชี Shopee พักเงิน"
          />
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        >
          {isPending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          บันทึก
        </button>
      </div>
      {message ? (
        <p
          className={
            message.kind === "ok"
              ? "text-xs text-emerald-700 dark:text-emerald-300"
              : "text-xs text-rose-600 dark:text-rose-300"
          }
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
};

export default SettlementAccountForm;
