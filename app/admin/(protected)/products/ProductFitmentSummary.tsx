"use client";

import { useState } from "react";

const VISIBLE_LINE_COUNT = 2;

type Props = {
  lines: string[];
  hiddenCount: number;
};

export default function ProductFitmentSummary({ lines, hiddenCount }: Props) {
  const [expanded, setExpanded] = useState(false);

  if (lines.length === 0) {
    return <span className="text-xs text-gray-300 dark:text-slate-500">-</span>;
  }

  const hiddenLines = lines.slice(VISIBLE_LINE_COUNT);

  return (
    <div className="max-w-64 space-y-1">
      {lines.slice(0, VISIBLE_LINE_COUNT).map((line) => (
        <p key={line} className="line-clamp-1 text-xs leading-5 text-gray-600 dark:text-slate-300">
          {line}
        </p>
      ))}

      {expanded
        ? hiddenLines.map((line) => (
            <p key={line} className="line-clamp-1 text-xs leading-5 text-gray-600 dark:text-slate-300">
              {line}
            </p>
          ))
        : null}

      {hiddenCount > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex rounded-md bg-[#1e3a5f]/10 px-1.5 py-0.5 text-xs font-semibold text-[#17406b] transition hover:bg-[#1e3a5f]/15 hover:text-[#123252] dark:bg-transparent dark:px-0 dark:py-0 dark:text-sky-300 dark:hover:bg-transparent dark:hover:text-sky-200"
        >
          {expanded ? "ซ่อน" : <>+{hiddenCount} รุ่น</>}
        </button>
      ) : null}
    </div>
  );
}
