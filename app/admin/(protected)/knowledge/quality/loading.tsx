import KnowledgeLoadingSkeleton, {
  SkeletonStatCards,
  SkeletonTable,
} from "../KnowledgeLoadingSkeleton";

export default function KnowledgeQualityLoading() {
  return (
    <KnowledgeLoadingSkeleton label="กำลังโหลดคุณภาพคลังความรู้">
      <div className="space-y-5">
        <SkeletonStatCards count={3} />
        <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
          <SkeletonTable rows={8} />
          <SkeletonTable rows={8} />
        </div>
      </div>
    </KnowledgeLoadingSkeleton>
  );
}
