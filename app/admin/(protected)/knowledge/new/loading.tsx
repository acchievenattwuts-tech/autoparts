import KnowledgeLoadingSkeleton from "../KnowledgeLoadingSkeleton";

export default function NewKnowledgeLoading() {
  return (
    <KnowledgeLoadingSkeleton label="กำลังโหลดฟอร์มเพิ่มความรู้" showTabs={false}>
      <div className="h-[32rem] animate-pulse rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950/80" />
    </KnowledgeLoadingSkeleton>
  );
}
