import Link from "next/link";
import LinkPendingIndicator from "@/components/shared/LinkPendingIndicator";

type Tab = {
  label: string;
  value: "PENDING" | "OUT_FOR_DELIVERY" | "DELIVERED" | undefined;
};

const TABS: Tab[] = [
  { label: "รอจัดส่ง + กำลังส่ง", value: undefined },
  { label: "รอจัดส่ง",            value: "PENDING" },
  { label: "กำลังส่ง",            value: "OUT_FOR_DELIVERY" },
  { label: "ส่งแล้ว",             value: "DELIVERED" },
];

const MobileStatusTabs = ({ current }: { current?: string }) => (
  <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
    {TABS.map((tab) => {
      const active = current === tab.value;
      const href = tab.value
        ? `/admin/delivery/update?status=${tab.value}`
        : "/admin/delivery/update";
      return (
        <Link
          key={tab.label}
          href={href}
          className={`relative inline-flex shrink-0 items-center rounded-full px-4 py-2 text-sm font-medium transition-colors ${
            active
              ? "bg-[#1e3a5f] text-white shadow-sm"
              : "border border-gray-200 bg-white text-gray-600 hover:border-[#1e3a5f] dark:border-white/10 dark:bg-slate-900 dark:text-slate-300"
          }`}
        >
          <LinkPendingIndicator
            variant="chip"
            label="กำลังกรอง"
            className="right-1 top-1/2 -translate-y-1/2 rounded-full px-1.5 py-0.5 text-[10px]"
          />
          {tab.label}
        </Link>
      );
    })}
  </div>
);

export default MobileStatusTabs;
