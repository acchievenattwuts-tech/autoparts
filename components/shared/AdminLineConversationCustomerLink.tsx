"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Link2, Search, Unlink } from "lucide-react";

type CustomerHit = {
  id: string;
  code: string | null;
  name: string;
  phone: string | null;
};

type Props = {
  conversationId: string;
  isLinked: boolean;
};

export default function AdminLineConversationCustomerLink({ conversationId, isLinked }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/line-conversations/customers?q=${encodeURIComponent(query.trim())}`);
      if (!res.ok) throw new Error("SEARCH_FAILED");
      const data = (await res.json()) as { customers: CustomerHit[] };
      setResults(data.customers);
    } catch {
      setError("ค้นหาไม่สำเร็จ");
    } finally {
      setSearching(false);
    }
  };

  const setCustomer = async (customerId: string | null) => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/line-conversations/${conversationId}/link-customer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error ?? "REQUEST_FAILED");
      }
      setOpen(false);
      setQuery("");
      setResults([]);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "REQUEST_FAILED");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-3 border-t border-gray-100 pt-3 dark:border-white/10">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={pending}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 px-2.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/10"
        >
          <Link2 size={13} />
          {isLinked ? "เปลี่ยนลูกค้าที่ผูก" : "ผูกลูกค้าด้วยมือ"}
        </button>
        {isLinked ? (
          <button
            type="button"
            onClick={() => setCustomer(null)}
            disabled={pending}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 px-2.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-400/30 dark:text-red-200 dark:hover:bg-red-500/10"
          >
            <Unlink size={13} />
            ยกเลิกการผูก
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  search();
                }
              }}
              placeholder="ค้นหาด้วยชื่อ / รหัสลูกค้า / เบอร์โทร"
              className="h-9 flex-1 rounded-md border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-[#1e3a5f]/30 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100"
            />
            <button
              type="button"
              onClick={search}
              disabled={searching || !query.trim()}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#1e3a5f] px-3 text-sm font-medium text-white hover:bg-[#163055] disabled:opacity-60 dark:bg-sky-600 dark:hover:bg-sky-500"
            >
              <Search size={14} />
              {searching ? "..." : "ค้นหา"}
            </button>
          </div>

          {results.length > 0 ? (
            <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-white/10 dark:border-white/10">
              {results.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    onClick={() => setCustomer(customer.id)}
                    disabled={pending}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:opacity-60 dark:hover:bg-white/5"
                  >
                    <span className="min-w-0">
                      <span className="font-medium text-gray-900 dark:text-slate-100">{customer.name}</span>
                      {customer.code ? (
                        <span className="ml-2 font-mono text-xs text-gray-500 dark:text-slate-400">{customer.code}</span>
                      ) : null}
                    </span>
                    {customer.phone ? (
                      <span className="shrink-0 text-xs text-gray-500 dark:text-slate-400">{customer.phone}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-300">{error}</p> : null}
    </div>
  );
}
