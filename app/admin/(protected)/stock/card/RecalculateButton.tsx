"use client";

import { useState, useTransition } from "react";
import { RefreshCw, CheckCircle } from "lucide-react";
import { recalculateAllStockCards } from "./actions";

const RecalculateButton = () => {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ count?: number; error?: string } | null>(null);

  const handleClick = () => {
    setResult(null);
    startTransition(async () => {
      const res = await recalculateAllStockCards();
      setResult(res);
    });
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-sm font-medium rounded-lg transition-colors"
      >
        <RefreshCw size={15} className={isPending ? "animate-spin" : ""} />
        {isPending ? "กำลัง Re-calculate..." : "Re-calculate Stock ทั้งหมด"}
      </button>

      {result?.count !== undefined && (
        <span className="inline-flex items-center gap-1.5 text-sm text-green-600">
          <CheckCircle size={15} />
          Re-calculate สำเร็จ {result.count} สินค้า
        </span>
      )}
      {result?.error && (
        <span className="text-sm text-red-600">{result.error}</span>
      )}
    </div>
  );
};

export default RecalculateButton;
