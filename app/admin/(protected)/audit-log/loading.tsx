const AuditLogLoading = () => (
  <div className="flex min-h-[60vh] items-center justify-center">
    <div
      role="status"
      aria-live="polite"
      className="flex min-w-[220px] flex-col items-center gap-4 rounded-2xl border border-gray-100 bg-white/95 px-6 py-7 text-center shadow-sm dark:border-white/10 dark:bg-slate-950/80"
    >
      <svg
        className="h-10 w-10 animate-spin text-[#1e3a5f] dark:text-sky-300"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <div className="space-y-1">
        <p className="text-sm font-medium text-gray-700 dark:text-slate-100">กำลังโหลด Audit Log...</p>
      </div>
      <span className="sr-only">กำลังโหลด...</span>
    </div>
  </div>
);

export default AuditLogLoading;
