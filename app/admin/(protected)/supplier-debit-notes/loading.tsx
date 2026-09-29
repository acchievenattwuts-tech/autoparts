const Loading = () => (
  <div role="status" className="flex min-h-[60vh] items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#1e3a5f]/20 border-t-[#1e3a5f] dark:border-sky-400/20 dark:border-t-sky-400" />
      <p className="text-sm text-gray-500 dark:text-slate-400">กำลังโหลดใบเพิ่มหนี้…</p>
    </div>
  </div>
);
export default Loading;
