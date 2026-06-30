import Link from "next/link";
import { ShieldAlert } from "lucide-react";

type DocumentMutationBlockedNoticeProps = {
  message: string;
  references?: Array<{
    href: string;
    label: string;
  }>;
  compact?: boolean;
};

const DocumentMutationBlockedNotice = ({
  message,
  references = [],
  compact = false,
}: DocumentMutationBlockedNoticeProps) => {
  return (
    <div
      className={`rounded-lg border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-300/30 dark:bg-amber-400/10 dark:text-amber-100 ${
        compact ? "px-3 py-2 text-xs" : "p-4 text-sm"
      }`}
    >
      <div className="flex items-start gap-2">
        <ShieldAlert size={compact ? 14 : 18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-200" />
        <div className="min-w-0">
          <p className="font-medium">{message}</p>
          {references.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {references.map((ref) => (
                <Link
                  key={`${ref.href}-${ref.label}`}
                  href={ref.href}
                  className="rounded-full border border-amber-300/70 bg-white px-2 py-0.5 font-mono text-[11px] text-amber-800 transition-colors hover:bg-amber-100 dark:border-amber-200/30 dark:bg-amber-300/10 dark:text-amber-100 dark:hover:bg-amber-300/20"
                >
                  {ref.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DocumentMutationBlockedNotice;
