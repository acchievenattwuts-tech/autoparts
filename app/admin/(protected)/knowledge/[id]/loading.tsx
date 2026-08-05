import KnowledgeLoadingSkeleton from "../KnowledgeLoadingSkeleton";

export default function KnowledgeDetailLoading() {
  return (
    <KnowledgeLoadingSkeleton label="กำลังโหลดรายละเอียดความรู้" showTabs={false}>
      <div className="space-y-5">
        <div className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/80" />
        <div className="h-[32rem] animate-pulse rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/80" />
      </div>
    </KnowledgeLoadingSkeleton>
  );
}
